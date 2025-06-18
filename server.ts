#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { chromium, Browser, Page, BrowserContext } from "playwright";
import { Browserbase } from "@browserbasehq/sdk";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import * as path from "path";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Configuration
const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY;
const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID;
const USE_BROWSERBASE = process.env.USE_BROWSERBASE === "true";

// Interface definitions
interface ZipEntry {
  entryName: string;
  header: {
    size: number;
  };
}

interface DownloadOptions {
  mode: string;
  downloadPath?: string;
  sessionId?: string;
  retrySeconds?: number;
}

interface S3Result {
  type: string;
  url: string;
  message: string;
  downloadResult?: string;
}

// Global state
let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let debuggingUrl = '';
let browserbaseSession: any = null;

// Define the Playwright tools available to the client
const TOOLS = [
  {
    name: "playwright_navigate",
    description: "Navigate to a specified URL",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "playwright_fill",
    description: "Fill a form field with a value",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        value: { type: "string" },
      },
      required: ["selector", "value"],
    },
  },
  {
    name: "playwright_click",
    description: "Click an element on the page",
    inputSchema: {
      type: "object",
      properties: { selector: { type: "string" } },
      required: ["selector"],
    },
  },
  {
    name: "playwright_evaluate",
    description: "Execute JavaScript in the page context and return the result",
    inputSchema: {
      type: "object",
      properties: { script: { type: "string" } },
      required: ["script"],
    },
  },
  {
    name: "playwright_waitForSelector",
    description: "Wait for an element to appear on the page",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        timeout: { type: "number", default: 30000 },
      },
      required: ["selector"],
    },
  },
  {
    name: "playwright_download",
    description: "Click a button or link to initiate a download and wait for it to complete",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "Button or link to click for download" },
        downloadPath: { type: "string", description: "Local directory to save the download" },
      },
      required: ["selector"],
    },
  },
  {
    name: "playwright_download_s3_file",
    description: "Download a file from an S3 URL",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        outputFilename: { type: "string" },
      },
      required: ["url"],
    },
  },
  {
    name: "playwright_check_tabs_for_s3",
    description: "Check all open tabs for an S3 URL and return it if found",
    inputSchema: {
      type: "object",
      properties: {
        timeout: { type: "number" },
        autoDownload: { type: "boolean" },
        outputFilename: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "playwright_waitForSelector_with_polling",
    description: "Wait for a selector to appear with polling, retrying multiple times",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        timeout: { type: "number" },
        pollingInterval: { type: "number" },
        maxAttempts: { type: "number" },
      },
      required: ["selector"],
    },
  },
  {
    name: "playwright_click_without_target",
    description: "Click a link or button after modifying it to not open in a new tab",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        waitForNavigation: { type: "boolean" },
        href: { type: "string" }
      },
      required: ["selector"]
    }
  },
  {
    name: "playwright_keyboard_press",
    description: "Press a keyboard key, useful for form submissions and navigation",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Key to press (e.g., 'Enter', 'Tab', 'ArrowDown')" },
        selector: { type: "string", description: "Optional: focus on this element before pressing key" },
        waitForNavigation: { type: "boolean", description: "Whether to wait for navigation after key press" }
      },
      required: ["key"]
    }
  },
  {
    name: "playwright_reliable_form_submit",
    description: "Submit a form using multiple methods for maximum reliability",
    inputSchema: {
      type: "object",
      properties: {
        inputSelector: { type: "string", description: "Selector for the input field" },
        submitButtonSelector: { type: "string", description: "Optional: selector for a submit button" },
        formSelector: { type: "string", description: "Optional: selector for the form element" },
        expectedResultSelector: { type: "string", description: "Selector to wait for after submission to verify success" },
        waitForNavigation: { type: "boolean", description: "Whether to wait for navigation after submission" }
      },
      required: ["inputSelector", "expectedResultSelector"]
    }
  },
  {
    name: "playwright_close_browser",
    description: "Close or disconnect from the browser instance",
    inputSchema: {
      type: "object",
      properties: {
        shouldDisconnectOnly: { 
          type: "boolean", 
          description: "If true, will disconnect from the browser without closing it" 
        }
      },
      required: [],
    },
  },
  {
    name: "playwright_browserbase_download",
    description: "Setup Browserbase download behavior and retrieve downloaded files",
    inputSchema: {
      type: "object",
      properties: {
        mode: { 
          type: "string", 
          description: "Mode: 'setup' to configure downloads, 'check' to check for downloads, 'get' to fetch downloads" 
        },
        downloadPath: { 
          type: "string", 
          description: "Local directory to save downloads to when using 'get' mode" 
        },
        sessionId: {
          type: "string",
          description: "Optional: Specific session ID to retrieve downloads from"
        },
        retrySeconds: {
          type: "number",
          description: "Optional: Number of seconds to retry downloading files (default: 20)"
        }
      },
      required: ["mode"],
    },
  },
  {
    name: "playwright_upload",
    description: "Upload a file to a website using a file input",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for the file input element" },
        filePath: { type: "string", description: "Local path to the file to upload" },
        useSessionUploads: { type: "boolean", description: "Use Browserbase Session Uploads API for large files (recommended for files >1MB)" },
        fileName: { type: "string", description: "Optional: Custom filename to use for the uploaded file" }
      },
      required: ["selector", "filePath"],
    },
  },
  {
    name: "input_prompt",
    description: "Display a prompt to the user and wait for their input, supporting multiline text",
    inputSchema: {
      type: "object",
      properties: { 
        message: { 
          type: "string", 
          description: "The message to display to the user" 
        },
        multiline: {
          type: "boolean",
          description: "Whether to accept multiline input (default: false)"
        }
      },
      required: ["message"],
    },
  },
  {
    name: "playwright_screenshot",
    description: "Take a screenshot of the current page for visual analysis",
    inputSchema: {
      type: "object",
      properties: {
        filename: { 
          type: "string", 
          description: "Optional filename to save screenshot to" 
        },
        fullPage: { 
          type: "boolean", 
          description: "Whether to capture full page (default: true)" 
        },
        element: { 
          type: "string", 
          description: "CSS selector to screenshot specific element" 
        },
        quality: { 
          type: "number", 
          description: "Image quality 1-100 for JPEG (default: 80)" 
        },
        format: { 
          type: "string", 
          description: "Image format: 'png' or 'jpeg' (default: 'jpeg')" 
        },
        returnBase64: { 
          type: "boolean", 
          description: "Return base64 data for immediate analysis (default: true)" 
        }
      },
      required: [],
    },
  },
  {
    name: "playwright_visual_analyze",
    description: "Take screenshot and analyze current page state using AI vision",
    inputSchema: {
      type: "object",
      properties: {
        question: { 
          type: "string", 
          description: "What to analyze about the page state" 
        },
        fullPage: { 
          type: "boolean", 
          description: "Whether to capture full page (default: true)" 
        },
        includeElements: { 
          type: "boolean", 
          description: "Identify clickable elements and suggest actions (default: false)" 
        },
        compareWith: { 
          type: "string", 
          description: "Compare with previous screenshot filename" 
        }
      },
      required: ["question"],
    },
  },
];

// Chrome/browser management functions
function getChromeExecutablePath(): string {
  const platform = process.platform;
  switch (platform) {
    case 'win32':
      return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    case 'darwin': // macOS
      return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    case 'linux':
      return '/usr/bin/google-chrome';
    default:
      return '';
  }
}

async function launchChromeWithRemoteDebugging(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const chromePath = getChromeExecutablePath();
    console.log(`Launching Chrome from: ${chromePath}`);
    
    exec(
      `"${chromePath}" --remote-debugging-port=9222 --no-first-run --no-default-browser-check --user-data-dir="${process.env.HOME || process.env.USERPROFILE}/playwright-chrome-profile"`,
      (error) => {
        if (error) {
          console.error('Failed to launch Chrome:', error);
          reject(error);
        }
      }
    );
    
    setTimeout(resolve, 2000);
  });
}

async function fetchDebuggingUrl(): Promise<string> {
  return new Promise((resolve, reject) => {
    const http = require('http');
    
    const req = http.get('http://localhost:9222/json/version', (res: any) => {
      let data = '';
      
      res.on('data', (chunk: any) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve(jsonData.webSocketDebuggerUrl);
        } catch (e) {
          reject(new Error(`Failed to parse debugging URL: ${e}`));
        }
      });
    });
    
    req.on('error', (error: any) => {
      reject(new Error(`Failed to fetch debugging URL: ${error.message}`));
    });
  });
}

async function createBrowserbaseSession(): Promise<{browser: Browser, context: BrowserContext, page: Page}> {
  console.log('Creating Browserbase session...');
  
  if (!BROWSERBASE_API_KEY || !BROWSERBASE_PROJECT_ID) {
    throw new Error('Browserbase API key or project ID not found in environment variables');
  }

  console.log('BROWSERBASE_API_KEY exists:', !!BROWSERBASE_API_KEY);
  console.log('BROWSERBASE_PROJECT_ID:', BROWSERBASE_PROJECT_ID);
  console.log('USE_BROWSERBASE:', USE_BROWSERBASE);
  
  const bb = new Browserbase({ apiKey: BROWSERBASE_API_KEY });
  
  console.log('About to create Browserbase session...');
  browserbaseSession = await bb.createSession({
    projectId: BROWSERBASE_PROJECT_ID,
    browserSettings: {
      fingerprint: {
        browsers: ["chrome"],
        devices: ["desktop"],
        locales: ["en-US"],
        operatingSystems: ["windows"]
      }
    }
  });
  
  console.log('Browserbase session created successfully!');
  console.log('Session ID:', browserbaseSession.id);
  console.log('Session status:', browserbaseSession.status);
  
  // Wait for session to be ready and have connectUrl
  let retries = 0;
  const maxRetries = 10; // 10 seconds max wait
  
  while (!browserbaseSession.connectUrl && retries < maxRetries) {
    console.log(`Waiting for session connectUrl to be available... (attempt ${retries + 1}/${maxRetries})`);
    console.log('Current status:', browserbaseSession.status);
    console.log('ConnectUrl available:', !!browserbaseSession.connectUrl);
    
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    
    // Try to fetch the session status directly via API
    try {
      const response = await fetch(`https://api.browserbase.com/v1/sessions/${browserbaseSession.id}`, {
        headers: {
          'X-BB-API-Key': BROWSERBASE_API_KEY,
        },
      });
      
      if (response.ok) {
        const updatedSession = await response.json();
        console.log('Fetched updated session via API');
        console.log('Updated status:', updatedSession.status);
        console.log('Updated connectUrl available:', !!updatedSession.connectUrl);
        
        if (updatedSession.connectUrl) {
          browserbaseSession = updatedSession;
          console.log('✅ ConnectUrl now available!');
          break;
        }
      } else {
        console.log('Failed to fetch session status:', response.status, response.statusText);
      }
    } catch (error) {
      console.log('Error fetching session update via API:', error);
    }
    
    retries++;
  }
  
  if (!browserbaseSession.connectUrl) {
    console.error('CRITICAL: connectUrl is still missing after waiting!');
    console.log('Final session object keys:', Object.keys(browserbaseSession));
    console.log('Final session status:', browserbaseSession.status);
    
    // Try to safely stringify the session object
    try {
      console.log('Full session object:', JSON.stringify(browserbaseSession, null, 2));
    } catch (stringifyError) {
      const error = stringifyError as Error;
      console.log('Cannot stringify session object:', error.message);
      console.log('Session object type:', typeof browserbaseSession);
      console.log('Session object constructor:', browserbaseSession.constructor.name);
    }
    
    throw new Error('Browserbase session was created but connectUrl is missing');
  }

  if (browserbaseSession.status !== 'RUNNING') {
    console.warn('Session is not in RUNNING status, but connectUrl is available. Proceeding...');
    console.log('Session status:', browserbaseSession.status);
  }

  console.log('✅ Session ready! ConnectUrl:', browserbaseSession.connectUrl);
  console.log('Connecting to Browserbase session...');
  
  const newBrowser = await chromium.connectOverCDP(browserbaseSession.connectUrl);
  console.log('Connected to browser successfully');
  
  const context = newBrowser.contexts()[0];
  const page = context.pages()[0];
  
  console.log('Browser context and page ready');
  
  return { browser: newBrowser, context, page };
}

async function ensureBrowser(): Promise<Page> {
  if (USE_BROWSERBASE) {
    return ensureBrowserbaseSession();
  } else {
    return ensureLocalChromeBrowser();
  }
}

async function ensureBrowserbaseSession(): Promise<Page> {
  if (!browser || !context) {
    try {
      const { browser: newBrowser, context: newContext, page: newPage } = await createBrowserbaseSession();
      browser = newBrowser;
      context = newContext;
      page = newPage;
    } catch (error) {
      console.error('Error creating Browserbase session:', error);
      throw error;
    }
  } else if (!page || page.isClosed()) {
    try {
      page = await context.newPage();
      console.log('Created a new page in existing Browserbase context');
    } catch (error) {
      console.error('Error creating new page in Browserbase:', error);
      await resetBrowserState();
      return ensureBrowser();
    }
  }
  
  return page!;
}

async function ensureLocalChromeBrowser(): Promise<Page> {
  if (!browser || !context) {
    console.log('Connecting to your existing Chrome browser...');
    
    try {
      debuggingUrl = await fetchDebuggingUrl();
      console.log('Found existing Chrome instance with debugging enabled');
    } catch (error) {
      console.log('No existing Chrome instance found with debugging enabled. Launching a new one...');
      await launchChromeWithRemoteDebugging();
      debuggingUrl = await fetchDebuggingUrl();
    }
    
    try {
      browser = await chromium.connectOverCDP(debuggingUrl);
      context = await browser.newContext({
        viewport: { width: 1600, height: 900 }
      });
      page = await context.newPage();
      console.log('Created a new page');
    } catch (error) {
      console.error('Error connecting to browser:', error);
      browser = null;
      context = null;
      page = null;
      throw error;
    }
  } else if (!page || page.isClosed()) {
    try {
      page = await context.newPage();
      console.log('Created a new page in existing browser');
    } catch (error) {
      console.error('Error creating new page:', error);
      await resetBrowserState();
      return ensureBrowser();
    }
  }
  
  return page!;
}

async function resetBrowserState(): Promise<void> {
  if (browser) {
    try {
      await browser.close();
    } catch (e) {
      console.error('Error closing browser during reset:', e);
    }
  }
  browser = null;
  context = null;
  page = null;
}

async function closeBrowser(shouldDisconnectOnly: boolean = false): Promise<void> {
  if (browser) {
    try {
      if (shouldDisconnectOnly) {
        if (context) {
          await context.close();
          context = null;
        }
        browser.close();
        browser = null;
        page = null;
        console.log('Disconnected from browser (browser instance still running)');
      } else {
        await browser.close();
        browser = null;
        context = null;
        page = null;
        
        if (USE_BROWSERBASE && browserbaseSession) {
          console.log(`Browserbase session closed: ${browserbaseSession.id}`);
          browserbaseSession = null;
        } else {
          console.log('Local browser instance closed successfully');
        }
      }
    } catch (error) {
      console.error('Error closing browser:', error);
    }
  }
}

// Download handling functions
async function downloadS3File(url: string, outputFilename: string = "941-form.pdf"): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log(`Downloading S3 file from: ${url.substring(0, 60)}...`);
    console.log(`Saving to: ${outputFilename}`);
    
    const scriptPath = path.resolve(__dirname, 'download-pdf.js');
    
    exec(`node "${scriptPath}" "${url}" "${outputFilename}"`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing download script: ${error.message}`);
        return reject(error);
      }
      
      if (stderr) {
        console.error(`Download script stderr: ${stderr}`);
      }
      
      console.log(`Download script output: ${stdout}`);
      resolve(`File successfully downloaded to ${outputFilename}`);
    });
  });
}

async function checkTabsForS3URL(
  timeout: number = 5000, 
  autoDownload: boolean = true, 
  outputFilename: string = "941-form.pdf"
): Promise<S3Result> {
  console.log(`Checking all tabs for S3 URL with timeout: ${timeout}ms`);
  
  if (!context) {
    throw new Error("No browser context available");
  }
  
  const pages = context.pages();
  console.log(`Found ${pages.length} open tabs`);
  
  let s3Url = '';
  let resultType = 'not_found';
  let resultMessage = 'No S3 URL found in any tab';
  
  // Check for direct S3 URLs in page URLs
  for (const page of pages) {
    const url = page.url();
    if (url.includes('amazonaws.com')) {
      console.log(`Found direct S3 URL in tab: ${url.substring(0, 60)}...`);
      s3Url = url;
      resultType = 'direct';
      resultMessage = 'Found direct S3 URL in tab';
      break;
    }
  }
  
  // If no direct S3 URL found, check for embedded content
  if (!s3Url) {
    s3Url = await findEmbeddedS3Url(pages);
    if (s3Url) {
      resultType = 'embedded';
      resultMessage = 'Found embedded S3 URL in tab content';
    }
  }
  
  // If URL found and autoDownload is enabled, download the file
  let downloadResult;
  
  if (s3Url && autoDownload) {
    downloadResult = await tryS3Download(s3Url, outputFilename);
    if (downloadResult.success) {
      resultMessage += `. File downloaded successfully to ${outputFilename}`;
    } else {
      resultMessage += `. ${downloadResult.message}`;
    }
  }
  
  return {
    type: resultType,
    url: s3Url,
    message: resultMessage,
    downloadResult: downloadResult?.message
  };
}

async function findEmbeddedS3Url(pages: Page[]): Promise<string> {
  for (const page of pages) {
    try {
      // Skip S3 pages as we already checked them
      if (page.url().includes('amazonaws.com')) continue;
      
      // Check for various elements that might contain S3 URLs
      const s3EmbedUrl = await page.evaluate(() => {
        // Check for iframes/embeds
        const iframeEl = document.querySelector('iframe[src*="amazonaws.com"]');
        const embedEl = document.querySelector('embed[src*="amazonaws.com"]');
        const objectEl = document.querySelector('object[data*="amazonaws.com"]');
        
        if (iframeEl && iframeEl.getAttribute('src')) return iframeEl.getAttribute('src');
        if (embedEl && embedEl.getAttribute('src')) return embedEl.getAttribute('src');
        if (objectEl && objectEl.getAttribute('data')) return objectEl.getAttribute('data');
        
        // Check for links
        const links = Array.from(document.querySelectorAll('a'));
        const s3Link = links.find(link => link.href && link.href.includes('amazonaws.com'));
        if (s3Link) return s3Link.href;
        
        // Check for data attributes
        const elementsWithDataAttributes = Array.from(document.querySelectorAll(
          '[data-url], [data-download-url], [data-href], [data-src], [data-source]'
        ));
        
        for (const el of elementsWithDataAttributes) {
          const url = el.getAttribute('data-url') || 
                     el.getAttribute('data-download-url') || 
                     el.getAttribute('data-href') || 
                     el.getAttribute('data-src') || 
                     el.getAttribute('data-source');
          if (url && url.includes('amazonaws.com')) return url;
        }
        
        // Check for S3 URLs in scripts
        const scripts = Array.from(document.querySelectorAll('script:not([src])'));
        let foundInScript: string | null = null;
        
        for (const script of scripts) {
          const matches = script.textContent?.match(/https:\/\/[^"']*amazonaws\.com[^"']*/g);
          if (matches && matches.length > 0) {
            foundInScript = matches[0];
            break;
          }
        }
        
        // Check in HTML content
        if (!foundInScript) {
          const allElements = Array.from(document.querySelectorAll('*'));
          for (const el of allElements) {
            if (el.innerHTML) {
              const matches = el.innerHTML.match(/https:\/\/[^"']*amazonaws\.com[^"']*/g);
              if (matches && matches.length > 0) {
                foundInScript = matches[0];
                break;
              }
            }
          }
        }
        
        // Check global variables
        if (!foundInScript) {
          try {
            const allProps = Object.getOwnPropertyNames(window);
            for (const prop of allProps) {
              try {
                const value = (window as any)[prop];
                if (typeof value === 'string' && value.includes('amazonaws.com')) {
                  foundInScript = value;
                  break;
                } else if (typeof value === 'object' && value !== null) {
                  const stringified = JSON.stringify(value);
                  if (stringified.includes('amazonaws.com')) {
                    const matches = stringified.match(/https:\/\/[^"']*amazonaws\.com[^"']*/g);
                    if (matches && matches.length > 0) {
                      foundInScript = matches[0];
                      break;
                    }
                  }
                }
              } catch (e) {
                // Ignore errors from accessing properties
              }
            }
          } catch (e) {
            // Ignore errors from Object.getOwnPropertyNames
          }
        }
        
        return foundInScript;
      });
      
      if (s3EmbedUrl) {
        console.log(`Found embedded S3 URL in tab: ${s3EmbedUrl.substring(0, 60)}...`);
        return s3EmbedUrl;
      }

      // Try checking for download buttons
      const s3ButtonUrl = await findS3UrlFromButtons(page);
      if (s3ButtonUrl) {
        return s3ButtonUrl;
      }
    } catch (error) {
      console.error(`Error checking tab for S3 content: ${error}`);
    }
  }
  
  return '';
}

async function findS3UrlFromButtons(page: Page): Promise<string> {
  // Look for download buttons
  const downloadButtons = await page.locator('button, a').all();
  
  for (const button of downloadButtons) {
    try {
      const buttonText = await button.textContent();
      if (buttonText && buttonText.toLowerCase().includes('download')) {
        console.log('Found download button:', buttonText);
        
        // Click and check if it triggers an S3 URL
        await button.click();
        await page.waitForTimeout(2000);
        
        const newS3Url = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a'));
          const s3Link = links.find(link => link.href && link.href.includes('amazonaws.com'));
          return s3Link ? s3Link.href : null;
        });
        
        if (newS3Url) {
          console.log(`Found S3 URL after clicking download button: ${newS3Url.substring(0, 60)}...`);
          return newS3Url;
        }
      }
    } catch (error) {
      console.error('Error checking download button:', error);
    }
  }
  
  return '';
}

async function tryS3Download(
  url: string, 
  outputFilename: string
): Promise<{success: boolean, message: string}> {
  const maxDownloadAttempts = 5;
  let downloadAttempts = 0;
  
  while (downloadAttempts < maxDownloadAttempts) {
    try {
      console.log(`Download attempt ${downloadAttempts + 1}/${maxDownloadAttempts}`);
      await downloadS3File(url, outputFilename);
      return {
        success: true,
        message: `File downloaded successfully to ${outputFilename}`
      };
    } catch (error: any) {
      downloadAttempts++;
      
      // Check if this is an expired token (403 Forbidden)
      if (error.message && error.message.includes('403')) {
        console.log('S3 URL expired. Attempting to refresh the URL...');
        
        if (downloadAttempts >= maxDownloadAttempts) {
          return {
            success: false,
            message: `Error downloading file: ${error.message}. S3 URL expired - please try again.`
          };
        }
      } else {
        return {
          success: false,
          message: `Error downloading file: ${error.message}`
        };
      }
    }
  }
  
  return {
    success: false,
    message: "Max download attempts reached"
  };
}

// UI interaction functions
async function waitForSelectorWithPolling(
  selector: string, 
  timeout: number = 10000, 
  pollingInterval: number = 500,
  maxAttempts: number = 10
): Promise<string> {
  const page = await ensureBrowser();
  console.log(`Waiting for selector "${selector}" with polling...`);
  
  let attempts = 0;
  while (attempts < maxAttempts) {
    attempts++;
    console.log(`Attempt ${attempts}/${maxAttempts} for selector: ${selector}`);
    
    try {
      await page.waitForSelector(selector, { timeout: pollingInterval });
      console.log(`Selector "${selector}" found on attempt ${attempts}`);
      return `Selector "${selector}" found after ${attempts} attempts`;
    } catch (error) {
      if (attempts >= maxAttempts) {
        throw new Error(`Failed to find selector "${selector}" after ${maxAttempts} attempts`);
      }
      
      console.log(`Selector not found, polling again...`);
      
      // Try to identify similar elements
      try {
        await page.evaluate((sel: string) => {
          const elements = document.querySelectorAll('*');
          Array.from(elements).forEach(el => {
            if (el.textContent?.includes(sel.replace(/[^\w\s]/g, ''))) {
              console.log('Found element with similar text:', el.textContent);
              el.id = 'polled-element-' + Date.now();
            }
          });
        }, selector);
      } catch (evalError) {
        console.error('Error during evaluation:', evalError);
      }
      
      await page.waitForTimeout(pollingInterval);
    }
  }
  
  throw new Error(`Timed out waiting for selector "${selector}" after ${timeout}ms`);
}

async function handleCloseBrowser(args: { shouldDisconnectOnly?: boolean } = {}) {
  if (!browser) {
    return { 
      content: [{ type: "text", text: "No active browser instance to close" }],
      isError: false 
    };
  }
  
  try {
    await closeBrowser(args.shouldDisconnectOnly);
    
    const message = args.shouldDisconnectOnly ? 
      "Disconnected from browser (Chrome instance still running)" : 
      "Browser closed successfully";
      
    return { 
      content: [{ type: "text", text: message }],
      isError: false 
    };
  } catch (error: any) {
    return { 
      content: [{ type: "text", text: `Error with browser: ${error.message}` }],
      isError: true 
    };
  }
}

// Tool handler functions
async function handleNavigate(page: Page, url: string) {
  try {
    await page.goto(url, { 
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    
    await page.waitForTimeout(2000);
    
    return { 
      content: [{ type: "text", text: `Navigated to ${url}` }], 
      isError: false 
    };
  } catch (navError: any) {
    const currentUrl = await page.evaluate(() => window.location.href).catch(() => "unknown");
    return { 
      content: [{ type: "text", text: `Navigation error: ${navError.message}. Current URL: ${currentUrl}` }],
      isError: true 
    };
  }
}

async function handleFill(page: Page, selector: string, value: string) {
  try {
    await page.waitForSelector(selector, { timeout: 10000 });
    await page.fill(selector, "");
    await page.fill(selector, value);
    return { 
      content: [{ type: "text", text: `Filled ${selector} with ${value}` }], 
      isError: false 
    };
  } catch (fillError: any) {
    return { 
      content: [{ type: "text", text: `Error filling ${selector}: ${fillError.message}` }],
      isError: true 
    };
  }
}

async function handleClick(page: Page, selector: string) {
  try {
    await page.waitForSelector(selector, { timeout: 10000, state: 'visible' });
    
    await page.evaluate((selector) => {
      const element = document.querySelector(selector);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, selector);
    
    await page.waitForTimeout(500);
    await page.click(selector);
    await page.waitForTimeout(500);
    
    return { 
      content: [{ type: "text", text: `Clicked ${selector}` }], 
      isError: false 
    };
  } catch (clickError: any) {
    return { 
      content: [{ type: "text", text: `Error clicking ${selector}: ${clickError.message}` }],
      isError: true 
    };
  }
}

async function handleEvaluate(page: Page, script: string) {
  try {
    const evalResult = await page.evaluate(script);
    
    let resultText = "Script executed successfully";
    
    if (evalResult !== undefined && evalResult !== null) {
      if (typeof evalResult === 'object') {
        try {
          resultText = JSON.stringify(evalResult);
        } catch (jsonError) {
          resultText = "Executed script successfully (result was object that couldn't be serialized)";
        }
      } else {
        resultText = String(evalResult);
      }
    }
    
    return { 
      content: [{ type: "text", text: resultText }], 
      isError: false 
    };
  } catch (evalError: any) {
    let errorMessage = evalError.message || "Unknown evaluate error";
    
    if (errorMessage.includes("Illegal return statement")) {
      errorMessage = "Error: Illegal return statement. Avoid using 'return' in your script, just end with the expression to evaluate.";
    } else if (errorMessage.includes("Cannot read property") || errorMessage.includes("is not defined")) {
      errorMessage = `Error: ${errorMessage}. Make sure all variables and properties exist before accessing them.`;
    }
    
    return { 
      content: [{ type: "text", text: errorMessage }], 
      isError: true 
    };
  }
}

async function handleClickWithoutTarget(page: Page, args: {
  selector: string;
  waitForNavigation?: boolean;
  href?: string;
}) {
  const selector = args.selector;
  const waitForNavigation = args.waitForNavigation === true;
  const href = args.href || '';
  
  try {
    await page.evaluate(({ selector, href }: { selector: string, href: string }) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Element not found: ${selector}`);
      
      element.removeAttribute('target');
      
      if (element instanceof HTMLElement) {
        (element as any).onclick = function(e: Event) {
          e.preventDefault();
          e.stopPropagation();
          
          if (href) {
            if (element instanceof HTMLAnchorElement) {
              element.href = href;
            } else {
              element.setAttribute('href', href);
            }
          }
          
          if (element instanceof HTMLAnchorElement) {
            window.location.href = element.href || '';
          } else {
            window.location.href = element.getAttribute('href') || '';
          }
          return false;
        };
        
        const originalClick = element.click;
        (element as any).click = function() {
          try {
            originalClick.call(this);
          } catch (e) {
            console.error('Error during click:', e);
          }
          return false;
        };
      }
    }, { selector, href });
    
    if (waitForNavigation) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }),
        page.click(selector)
      ]);
    } else {
      await page.click(selector);
    }
    
    return { 
      content: [{ type: "text", text: `Clicked ${selector} in same tab` }],
      isError: false
    };
  } catch (error: any) {
    console.error(`Error clicking without target: ${error}`);
    return { 
      content: [{ type: "text", text: `Error clicking ${selector}: ${error.message}` }],
      isError: true 
    };
  }
}

async function handleKeyboardPress(page: Page, args: {
  key: string;
  selector?: string;
  waitForNavigation?: boolean;
}) {
  const { key, selector, waitForNavigation } = args;
  
  try {
    if (selector) {
      await page.focus(selector);
    }
    
    if (waitForNavigation) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }),
        page.keyboard.press(key)
      ]);
    } else {
      await page.keyboard.press(key);
    }
    
    return { 
      content: [{ type: "text", text: `Pressed ${key} key${selector ? ` on ${selector}` : ''}` }],
      isError: false 
    };
  } catch (error: any) {
    return { 
      content: [{ type: "text", text: `Error pressing ${key} key: ${error.message}` }],
      isError: true 
    };
  }
}

async function handleReliableFormSubmit(page: Page, args: {
  inputSelector: string;
  submitButtonSelector?: string;
  formSelector?: string;
  expectedResultSelector: string;
  waitForNavigation?: boolean;
}) {
  const { 
    inputSelector, 
    submitButtonSelector, 
    formSelector, 
    expectedResultSelector, 
    waitForNavigation 
  } = args;
  
  try {
    await page.focus(inputSelector);
    console.log(`Focused on input field: ${inputSelector}`);
    
    let submissionSuccessful = false;
    let errorMessages: string[] = [];
    
    // Method 1: Try clicking the submit button
    if (submitButtonSelector && !submissionSuccessful) {
      submissionSuccessful = await trySubmitWithButton(
        page, 
        submitButtonSelector, 
        expectedResultSelector, 
        waitForNavigation, 
        errorMessages
      );
    }
    
    // Method 2: Try submitting the form directly
    if (!submissionSuccessful && formSelector) {
      submissionSuccessful = await tryFormSubmit(
        page, 
        formSelector, 
        expectedResultSelector, 
        waitForNavigation, 
        errorMessages
      );
    }
    
    // Method 3: Try JavaScript event dispatch
    if (!submissionSuccessful) {
      submissionSuccessful = await tryJavaScriptSubmit(
        page, 
        inputSelector, 
        expectedResultSelector, 
        waitForNavigation, 
        errorMessages
      );
    }
    
    if (submissionSuccessful) {
      return { 
        content: [{ 
          type: "text", 
          text: `Successfully submitted form with input ${inputSelector}` 
        }],
        isError: false 
      };
    } else {
      return { 
        content: [{ 
          type: "text", 
          text: `Failed to submit form despite multiple attempts. Errors: ${errorMessages.join('; ')}` 
        }],
        isError: true 
      };
    }
  } catch (error: any) {
    return { 
      content: [{ type: "text", text: `Error with reliable form submit: ${error.message}` }],
      isError: true 
    };
  }
}

async function trySubmitWithButton(
  page: Page,
  submitButtonSelector: string,
  expectedResultSelector: string,
  waitForNavigation?: boolean,
  errorMessages: string[] = []
): Promise<boolean> {
  try {
    const submitButtonExists = await page.evaluate((selector: string) => {
      return !!document.querySelector(selector);
    }, submitButtonSelector);
    
    if (submitButtonExists) {
      if (waitForNavigation) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle' }),
          page.click(submitButtonSelector)
        ]);
      } else {
        await page.click(submitButtonSelector);
      }
      
      console.log(`Clicked submit button: ${submitButtonSelector}`);
      
      try {
        await page.waitForSelector(expectedResultSelector, { timeout: 5000 });
        console.log(`Form submission successful via submit button`);
        return true;
      } catch (resultError: any) {
        errorMessages.push(`Button click didn't produce expected results: ${resultError.message}`);
        return false;
      }
    }
  } catch (buttonError: any) {
    errorMessages.push(`Error clicking submit button: ${buttonError.message}`);
  }
  
  return false;
}

async function tryFormSubmit(
  page: Page,
  formSelector: string,
  expectedResultSelector: string,
  waitForNavigation?: boolean,
  errorMessages: string[] = []
): Promise<boolean> {
  try {
    const formSubmitResult = await page.evaluate((formSel: string) => {
      const form = document.querySelector(formSel);
      if (!form) return false;
      if (form instanceof HTMLFormElement) {
        form.submit();
        return true;
      }
      return false;
    }, formSelector);
    
    if (formSubmitResult) {
      if (waitForNavigation) {
        await page.waitForNavigation({ waitUntil: 'networkidle' });
      }
      
      try {
        await page.waitForSelector(expectedResultSelector, { timeout: 5000 });
        console.log(`Form submission successful via form.submit()`);
        return true;
      } catch (resultError: any) {
        errorMessages.push(`Form submission didn't produce expected results: ${resultError.message}`);
        return false;
      }
    }
  } catch (formError: any) {
    errorMessages.push(`Error submitting form: ${formError.message}`);
  }
  
  return false;
}

async function tryJavaScriptSubmit(
  page: Page,
  inputSelector: string,
  expectedResultSelector: string,
  waitForNavigation?: boolean,
  errorMessages: string[] = []
): Promise<boolean> {
  try {
    const jsSubmitResult = await page.evaluate((inputSel: string) => {
      const input = document.querySelector(inputSel);
      if (!input) return false;
      
      // Dispatch keypress and keydown events
      const keypressEvent = new KeyboardEvent('keypress', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        bubbles: true
      });
      input.dispatchEvent(keypressEvent);
      
      const keydownEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        bubbles: true
      });
      input.dispatchEvent(keydownEvent);
      
      // Try to find and submit parent form
      const parentForm = input.closest('form');
      if (parentForm && parentForm instanceof HTMLFormElement) {
        try {
          parentForm.submit();
          return true;
        } catch (e) {
          // Form submit might fail silently
        }
      }
      
      return true;
    }, inputSelector);
    
    if (jsSubmitResult) {
      if (waitForNavigation) {
        await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 5000 }).catch(() => {});
      }
      
      try {
        await page.waitForSelector(expectedResultSelector, { timeout: 5000 });
        console.log(`Form submission successful via JavaScript events`);
        return true;
      } catch (resultError: any) {
        errorMessages.push(`JavaScript events didn't produce expected results: ${resultError.message}`);
        return false;
      }
    }
  } catch (jsError: any) {
    errorMessages.push(`Error with JavaScript event submission: ${jsError.message}`);
  }
  
  return false;
}

async function handleDownload(page: Page, args: {
  selector: string;
  downloadPath?: string;
}) {
  try {
    const { selector, downloadPath = "downloads" } = args;
    
    // Create downloads directory if it doesn't exist
    const fs = require('fs');
    if (!fs.existsSync(downloadPath)) {
      fs.mkdirSync(downloadPath, { recursive: true });
    }
    
    if (!context) {
      return { 
        content: [{ type: "text", text: "Error: No active browser context for download" }],
        isError: true 
      };
    }
    
    // Configure CDP for downloads
    const client = await context.newCDPSession(page);
    await client.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: downloadPath,
      eventsEnabled: true,
    });
    
    try {
      // Wait for download event and click simultaneously
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        page.click(selector)
      ]);
      
      console.log(`Download started: ${download.suggestedFilename()}`);
      
      // Check for download errors
      const downloadError = await download.failure();
      if (downloadError !== null) {
        console.error("Error happened on download:", downloadError);
        return { 
          content: [{ type: "text", text: `Error with download: ${downloadError}` }],
          isError: true 
        };
      }
      
      // Store the session ID for later retrieval
      console.log(`Download completed. Session ID: ${browserbaseSession?.id}`);
      
      return { 
        content: [{ 
          type: "text", 
          text: `Download completed successfully. To retrieve the file, use playwright_browserbase_download with mode='get'` 
        }],
        isError: false 
      };
    } catch (downloadError) {
      return { 
        content: [{ type: "text", text: `Error with download: ${(downloadError as Error).message}` }],
        isError: true 
      };
    }
  } catch (error) {
    return { 
      content: [{ type: "text", text: `Error with download operation: ${(error as Error).message}` }],
      isError: true 
    };
  }
}

async function handleBrowserbaseDownloads(args: DownloadOptions): Promise<{ content: any[]; isError: boolean }> {
  try {
    const currentSessionId = args.sessionId || (browserbaseSession?.id || '');
    
    if (!currentSessionId) {
      return {
        content: [{ 
          type: "text", 
          text: "Error: No active Browserbase session found. Start a session first." 
        }],
        isError: true
      };
    }
    
    if (args.mode === 'setup') {
      return setupBrowserbaseDownloads(args);
    } else if (args.mode === 'check') {
      return checkBrowserbaseDownloads(currentSessionId);
    } else if (args.mode === 'get') {
      return getBrowserbaseDownloads(currentSessionId, args);
    } else {
      return {
        content: [{ 
          type: "text", 
          text: `Invalid mode: '${args.mode}'. Use 'setup', 'check', or 'get'.` 
        }],
        isError: true
      };
    }
  } catch (error) {
    console.error("Error in handleBrowserbaseDownloads:", error);
    return {
      content: [{ 
        type: "text", 
        text: `Error with Browserbase downloads: ${(error as Error).message}` 
      }],
      isError: true
    };
  }
}

async function setupBrowserbaseDownloads(args: DownloadOptions): Promise<{ content: any[]; isError: boolean }> {
  if (!page || !context) {
    return {
      content: [{ type: "text", text: "Error: No active page or context found" }],
      isError: true
    };
  }
  
  try {
    // Use CDP to configure downloads
    const client = await context.newCDPSession(page);
    await client.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: args.downloadPath || "downloads",
      eventsEnabled: true,
    });
    
    return {
      content: [{ 
        type: "text", 
        text: `Download behavior configured for Browserbase session. Files will be stored on Browserbase servers.` 
      }],
      isError: false
    };
  } catch (error) {
    console.error("Error setting up download behavior:", error);
    return {
      content: [{ type: "text", text: `Error setting up download: ${(error as Error).message}` }],
      isError: true
    };
  }
}

async function checkBrowserbaseDownloads(sessionId: string): Promise<{ content: any[]; isError: boolean }> {
  if (!BROWSERBASE_API_KEY) {
    return {
      content: [{ type: "text", text: "Error: Browserbase API key not configured" }],
      isError: true
    };
  }
  
  try {
    const response = await fetch(`https://api.browserbase.com/v1/sessions/${sessionId}/downloads`, {
      method: 'GET',
      headers: {
        'X-BB-API-Key': BROWSERBASE_API_KEY
      }
    });
    
    const downloadBuffer = await response.arrayBuffer();
    const hasDownloads = downloadBuffer.byteLength > 0;
    
    return {
      content: [{ 
        type: "text", 
        text: hasDownloads ? 
          `Downloads available for session ${sessionId}. Use mode='get' to download the files.` : 
          `No downloads found for session ${sessionId}.`
      }],
      isError: false
    };
  } catch (error) {
    console.error("Error checking Browserbase downloads:", error);
    return {
      content: [{ type: "text", text: `Error checking downloads: ${(error as Error).message}` }],
      isError: true
    };
  }
}

async function getBrowserbaseDownloads(
  sessionId: string,
  args: DownloadOptions
): Promise<{ content: any[]; isError: boolean }> {
  if (!BROWSERBASE_API_KEY) {
    return {
      content: [{ type: "text", text: "Error: Browserbase API key not configured" }],
      isError: true
    };
  }
  
  // Set defaults
  const downloadPath = args.downloadPath || 'downloads';
  const retrySeconds = args.retrySeconds || 20;
  
  try {
    // Create download directory if needed
    const fs = require('fs');
    if (!fs.existsSync(downloadPath)) {
      fs.mkdirSync(downloadPath, { recursive: true });
      console.log(`Created download directory: ${downloadPath}`);
    }
    
    // Download and extract files
    const result = await pollForBrowserbaseDownloads(sessionId, downloadPath, retrySeconds);
    
    if (result.success) {
      return {
        content: [{ 
          type: "text", 
          text: `Successfully downloaded files to ${downloadPath}` 
        }],
        isError: false
      };
    } else {
      return {
        content: [{ 
          type: "text", 
          text: result.message || "No downloads found or couldn't retrieve downloads"
        }],
        isError: true
      };
    }
  } catch (error) {
    console.error("Error fetching Browserbase downloads:", error);
    return {
      content: [{ 
        type: "text", 
        text: `Error retrieving downloads: ${(error as Error).message}` 
      }],
      isError: true
    };
  }
}

async function pollForBrowserbaseDownloads(
  sessionId: string,
  downloadPath: string, 
  retrySeconds: number
): Promise<{success: boolean, message?: string}> {
  let pooler: any;
  let downloadSuccess = false;
  let errorMessage = '';
  
  await new Promise<void>((resolve, reject) => {
    // Set timeout to stop polling after retrySeconds
    const timeout = setTimeout(() => {
      if (pooler) {
        clearInterval(pooler);
      }
      if (!downloadSuccess) {
        errorMessage = `Timed out after ${retrySeconds} seconds waiting for downloads`;
      }
      resolve();
    }, retrySeconds * 1000);
    
    // Define the fetch downloads function
    async function fetchDownloads() {
      try {
        const response = await fetch(`https://api.browserbase.com/v1/sessions/${sessionId}/downloads`, {
          method: 'GET',
          headers: {
            'X-BB-API-Key': BROWSERBASE_API_KEY || ''
          }
        });
        
        const downloadBuffer = await response.arrayBuffer();
        
        if (downloadBuffer.byteLength > 0) {
          // Write the zip file to disk
          const fs = require('fs');
          const zipPath = `${downloadPath}/downloads.zip`;
          fs.writeFileSync(zipPath, Buffer.from(downloadBuffer));
          
          // Extract the contents
          const AdmZip = require('adm-zip');
          const zip = new AdmZip(zipPath);
          zip.extractAllTo(downloadPath, true);
          
          // Get the list of extracted files
          const zipEntries = zip.getEntries();
          const extractedFiles = zipEntries.map((entry: ZipEntry) => ({
            filename: entry.entryName,
            size: entry.header.size
          }));
          
          console.log(`Downloaded ${extractedFiles.length} files to ${downloadPath}`);
          downloadSuccess = true;
          clearInterval(pooler);
          clearTimeout(timeout);
          resolve();
        }
      } catch (e) {
        errorMessage = `Error fetching downloads: ${(e as Error).message}`;
        clearInterval(pooler);
        clearTimeout(timeout);
        reject(e);
      }
    }
    
    // Start polling every 2 seconds
    pooler = setInterval(fetchDownloads, 2000);
    
    // Do an initial check immediately
    fetchDownloads().catch((e) => {
      console.error("Initial download check failed:", e);
    });
  }).catch((error) => {
    console.error("Error in download polling:", error);
  });
  
  return {
    success: downloadSuccess,
    message: errorMessage
  };
}

async function handleUpload(page: Page, args: {
  selector: string;
  filePath: string;
  useSessionUploads?: boolean;
  fileName?: string;
}): Promise<{ content: any[]; isError: boolean }> {
  try {
    const { selector, filePath, useSessionUploads = false } = args;
    const fileName = args.fileName || path.basename(filePath);
    
    // Verify the file exists
    const fs = require('fs');
    if (!fs.existsSync(filePath)) {
      return {
        content: [{ 
          type: "text", 
          text: `Error: File not found at path: ${filePath}` 
        }],
        isError: true
      };
    }
    
    // Wait for the file input to be available
    await page.waitForSelector(selector, { timeout: 10000 });
    
    // Handle upload based on approach
    if (useSessionUploads && USE_BROWSERBASE && browserbaseSession) {
      // For large files, use Session Uploads API
      console.log(`Using Session Uploads API for large file: ${fileName}`);
      
      try {
        // Initialize Browserbase client
        const bb = new Browserbase({ apiKey: BROWSERBASE_API_KEY || '' });
        
        // Upload file via the Uploads API
        console.log(`Uploading file: ${filePath}`);
        const fileStream = fs.createReadStream(filePath);
        
        // Use fetch to upload the file to the Browserbase API
        const FormData = require('form-data');
        const form = new FormData();
        form.append('file', fileStream);
        
        const response = await fetch(`https://api.browserbase.com/v1/sessions/${browserbaseSession.id}/uploads`, {
          method: 'POST',
          headers: {
            'X-BB-API-Key': BROWSERBASE_API_KEY || ''
          },
          body: form
        });
        
        if (!response.ok) {
          throw new Error(`Upload failed with status ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log(`Upload successful: ${JSON.stringify(result)}`);
        
        // Create CDP session for file input manipulation
        if (!context) {
          throw new Error("No browser context available");
        }
        
        const cdpSession = await context.newCDPSession(page);
        const root = await cdpSession.send("DOM.getDocument");
        
        // Find the file input element
        const inputNode = await cdpSession.send("DOM.querySelector", {
          nodeId: root.root.nodeId,
          selector: selector,
        });
        
        // Use DOM.setFileInputFiles CDP command to use the uploaded file
        const remoteFilePath = `/tmp/.uploads/${fileName}`;
        await cdpSession.send("DOM.setFileInputFiles", {
          files: [remoteFilePath],
          nodeId: inputNode.nodeId,
        });
        
        return {
          content: [{ 
            type: "text", 
            text: `File ${fileName} uploaded successfully via Session Uploads API` 
          }],
          isError: false
        };
      } catch (error: any) {
        return {
          content: [{ 
            type: "text", 
            text: `Error using Session Uploads API: ${error.message}` 
          }],
          isError: true
        };
      }
    } else {
      // For direct upload (simpler approach)
      console.log(`Using direct upload for file: ${filePath}`);
      
      try {
        // Set the file to the input element
        const fileInput = page.locator(selector);
        await fileInput.setInputFiles(filePath);
        
        return {
          content: [{ 
            type: "text", 
            text: `File ${fileName} uploaded successfully via direct upload` 
          }],
          isError: false
        };
      } catch (uploadError: any) {
        return {
          content: [{ 
            type: "text", 
            text: `Error with direct file upload: ${uploadError.message}` 
          }],
          isError: true
        };
      }
    }
  } catch (error: any) {
    return {
      content: [{ 
        type: "text", 
        text: `Error handling file upload: ${error.message}` 
      }],
      isError: true
    };
  }
}

// Main handler for tool calls
async function handleToolCall(toolName: string, args: any) {
  // Special handlers that don't require a browser page
  if (toolName === "playwright_close_browser") {
    return handleCloseBrowser(args);
  }
  
  if (toolName === "playwright_browserbase_download") {
    return handleBrowserbaseDownloads(args);
  }
  
  if (toolName === "input_prompt") {
    return handleInputPrompt(args);
  }
  
  // For all other tools, ensure the browser is initialized
  try {
    const page = await ensureBrowser();
    
    switch (toolName) {
      case "playwright_navigate":
        return handleNavigate(page, args.url);
        
      case "playwright_fill":
        return handleFill(page, args.selector, args.value);
        
      case "playwright_click":
        return handleClick(page, args.selector);
        
      case "playwright_evaluate":
        return handleEvaluate(page, args.script);
        
      case "playwright_waitForSelector":
        await page.waitForSelector(args.selector, { timeout: args.timeout || 30000 });
        return { 
          content: [{ type: "text", text: `Waited for ${args.selector}` }], 
          isError: false 
        };
        
      case "playwright_download_s3_file":
        try {
          const result = await downloadS3File(args.url, args.outputFilename);
          return { 
            content: [{ type: "text", text: result }], 
            isError: false 
          };
        } catch (error: any) {
          return { 
            content: [{ type: "text", text: `Error downloading file: ${error.message}` }],
            isError: true 
          };
        }
        
      case "playwright_check_tabs_for_s3":
        const s3Result = await checkTabsForS3URL(
          args.timeout || 5000, 
          args.autoDownload !== false, 
          args.outputFilename || "941-form.pdf"
        );
        return { 
          content: [{ type: "text", text: JSON.stringify(s3Result) }],
          isError: s3Result.type === 'not_found'
        };
        
      case "playwright_waitForSelector_with_polling":
        try {
          const result = await waitForSelectorWithPolling(
            args.selector,
            args.timeout,
            args.pollingInterval,
            args.maxAttempts
          );
          return { 
            content: [{ type: "text", text: result }],
            isError: false
          };
        } catch (error: any) {
          return { 
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true
          };
        }
        
      case "playwright_click_without_target":
        return handleClickWithoutTarget(page, args);
        
      case "playwright_keyboard_press":
        return handleKeyboardPress(page, args);
        
      case "playwright_reliable_form_submit":
        return handleReliableFormSubmit(page, args);
        
      case "playwright_download":
        return handleDownload(page, args);
        
      case "playwright_upload":
        return handleUpload(page, args);

      case "playwright_screenshot":
        return handleScreenshot(page, args);

      case "playwright_visual_analyze":
        return handleVisualAnalyze(page, args);
        
      default:
        return { 
          content: [{ type: "text", text: `Unknown tool: ${toolName}` }], 
          isError: true 
        };
    }
  } catch (error) {
    return { 
      content: [{ type: "text", text: `Error: ${(error as Error).message}` }], 
      isError: true 
    };
  }
}

// Set up the MCP server
const server = new Server(
  { name: "playwright-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Register request handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  return handleToolCall(request.params.name, request.params.arguments);
});

// Main function to start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("Playwright MCP server running on stdio");

  // Add signal handlers for clean shutdown
  process.on('SIGINT', async () => {
    console.log('Received SIGINT. Closing browser and terminating...');
    await closeBrowser(false);
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM. Closing browser and terminating...');
    await closeBrowser(false);
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Server failed to start:", error);
  process.exit(1);
});

async function handleScreenshot(page: Page, args: {
  filename?: string;
  fullPage?: boolean;
  element?: string;
  quality?: number;
  format?: 'png' | 'jpeg';
  returnBase64?: boolean;
}): Promise<{ content: any[]; isError: boolean }> {
  try {
    const {
      filename,
      fullPage = true,
      element,
      quality = 80,
      format = 'jpeg',
      returnBase64 = true
    } = args;

    let screenshotData: string;

    if (!context) {
      return {
        content: [{ type: "text", text: "Error: No browser context available for screenshot" }],
        isError: true
      };
    }

    // Use CDP for better performance as recommended by Browserbase
    const client = await context.newCDPSession(page);

    if (element) {
      // Element-specific screenshot
      try {
        await page.waitForSelector(element, { timeout: 5000 });
        const elementHandle = await page.$(element);
        if (!elementHandle) {
          return {
            content: [{ type: "text", text: `Error: Element not found: ${element}` }],
            isError: true
          };
        }
        
        // Get element bounds for targeted screenshot
        const boundingBox = await elementHandle.boundingBox();
        if (boundingBox) {
          const { data } = await client.send("Page.captureScreenshot", {
            format,
            quality: format === 'jpeg' ? quality : undefined,
            clip: {
              x: boundingBox.x,
              y: boundingBox.y,
              width: boundingBox.width,
              height: boundingBox.height,
              scale: 1
            }
          });
          screenshotData = data;
        } else {
          return {
            content: [{ type: "text", text: `Error: Could not get bounds for element: ${element}` }],
            isError: true
          };
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error taking element screenshot: ${(error as Error).message}` }],
          isError: true
        };
      }
    } else {
      // Full page screenshot
      const { data } = await client.send("Page.captureScreenshot", {
        format,
        quality: format === 'jpeg' ? quality : undefined,
        captureBeyondViewport: fullPage
      });
      screenshotData = data;
    }

    const results: any[] = [];

    // Save to file if filename provided
    if (filename) {
      try {
        const fs = require('fs');
        const screenshotDir = 'screenshots';
        
        // Create directory if it doesn't exist
        if (!fs.existsSync(screenshotDir)) {
          fs.mkdirSync(screenshotDir, { recursive: true });
        }
        
        // Save the screenshot
        const buffer = Buffer.from(screenshotData, 'base64');
        const extension = format === 'jpeg' ? 'jpg' : 'png';
        const finalFilename = filename.endsWith(`.${extension}`) ? filename : `${filename}.${extension}`;
        const screenshotPath = `${screenshotDir}/${finalFilename}`;
        fs.writeFileSync(screenshotPath, buffer);
        
        results.push({ 
          type: "text", 
          text: `Screenshot saved to ${screenshotPath}` 
        });
      } catch (error) {
        results.push({ 
          type: "text", 
          text: `Warning: Could not save screenshot file: ${(error as Error).message}` 
        });
      }
    }

    // Return base64 data if requested
    if (returnBase64) {
      results.push({
        type: "text",
        text: `Screenshot captured successfully. Base64 data: ${screenshotData.substring(0, 100)}...`
      });
      
      // Store the base64 data for potential visual analysis
      // We'll add this to a global store for the visual analyzer to access
      (global as any).lastScreenshotData = {
        data: screenshotData,
        format,
        timestamp: Date.now(),
        url: page.url(),
        element: element || 'full-page'
      };
    }

    return {
      content: results,
      isError: false
    };

  } catch (error) {
    console.error('Error taking screenshot:', error);
    return {
      content: [{ type: "text", text: `Error taking screenshot: ${(error as Error).message}` }],
      isError: true
    };
  }
}

async function handleVisualAnalyze(page: Page, args: {
  question: string;
  fullPage?: boolean;
  includeElements?: boolean;
  compareWith?: string;
}): Promise<{ content: any[]; isError: boolean }> {
  try {
    const { LLMClient } = require('./src/utils/LLMClient');
    const llmClient = new LLMClient();
    
    const {
      question,
      fullPage = true,
      includeElements = false,
      compareWith
    } = args;

    // First, take a screenshot
    const screenshotResult = await handleScreenshot(page, {
      fullPage,
      returnBase64: true,
      format: 'jpeg',
      quality: 80
    });

    if (screenshotResult.isError) {
      return screenshotResult;
    }

    // Get the screenshot data from global storage
    const screenshotData = (global as any).lastScreenshotData;
    if (!screenshotData) {
      return {
        content: [{ type: "text", text: "Error: No screenshot data available for analysis" }],
        isError: true
      };
    }

    // Prepare enhanced question with element detection if requested
    let enhancedQuestion = question;
    if (includeElements) {
      enhancedQuestion += `

      Additionally, please identify and describe:
      1. Any clickable elements (buttons, links, forms)
      2. Interactive UI components
      3. Suggested next actions based on what you see
      4. Any error messages or important notifications`;
    }

    // Add comparison context if requested
    if (compareWith) {
      try {
        const fs = require('fs');
        const compareImagePath = `screenshots/${compareWith}`;
        if (fs.existsSync(compareImagePath)) {
          const compareImageData = fs.readFileSync(compareImagePath, 'base64');
          
          // For comparison, we'll add the instruction to the question
          enhancedQuestion += `

          COMPARISON REQUEST: I have provided a previous screenshot. Please compare the current state with the previous state and highlight what has changed.`;
          
          // TODO: Implement multi-image comparison by modifying the LLMClient call
          // For now, we'll note that comparison was requested
        }
      } catch (error) {
        console.log(`Warning: Could not load comparison image: ${compareWith}`);
      }
    }

    // Analyze the screenshot
    const analysisResult = await llmClient.analyzeScreenshot(
      screenshotData.data,
      enhancedQuestion,
      {
        url: screenshotData.url,
        taskObjective: question
      }
    );

    // Format the response
    const results = [
      {
        type: "text",
        text: `🔍 **Visual Analysis Results**

**Page URL:** ${screenshotData.url}
**Screenshot Element:** ${screenshotData.element}
**Analysis Question:** ${question}

**AI Analysis:**
${analysisResult.text}

**Token Usage:** ${analysisResult.tokenUsage?.total || 'unknown'} tokens
**Cost Estimate:** ~$${((analysisResult.tokenUsage?.total || 0) * 0.000003).toFixed(4)}`
      }
    ];

    return {
      content: results,
      isError: false
    };

  } catch (error) {
    console.error('Error in visual analysis:', error);
    return {
      content: [{ type: "text", text: `Error during visual analysis: ${(error as Error).message}` }],
      isError: true
    };
  }
}

async function handleInputPrompt(args: {
  message: string;
  multiline?: boolean;
}): Promise<{ content: any[]; isError: boolean }> {
  const message = args.message;
  const multiline = args.multiline || false;
  
  console.log("\n" + "=".repeat(80));
  console.log("USER INPUT REQUESTED:");
  console.log(message);
  console.log("=".repeat(80));
  
  if (multiline) {
    console.log("\nType your response below. You can use multiple lines.");
    console.log("When finished, type a line with just 'END' or press Ctrl+D");
    console.log("-".repeat(80));
  }
  
  try {
    const readline = require('readline');
    
    if (!multiline) {
      // Simple single-line input
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise<string>((resolve) => {
        rl.question("> ", (input: string) => {
          rl.close();
          resolve(input);
        });
      });
      
      return {
        content: [{ type: "text", text: answer }],
        isError: false
      };
    } else {
      // Multi-line input handling
      const lines: string[] = [];
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: "> "
      });
      
      rl.prompt();
      
      const input = await new Promise<string>((resolve) => {
        rl.on('line', (line: string) => {
          if (line.trim() === 'END') {
            rl.close();
            return;
          }
          
          lines.push(line);
          rl.prompt();
        });
        
        rl.on('close', () => {
          console.log('\n' + '-'.repeat(80));
          console.log('Input received. Continuing...');
          resolve(lines.join('\n'));
        });
      });
      
      return {
        content: [{ type: "text", text: input }],
        isError: false
      };
    }
  } catch (error: any) {
    console.error("Error getting user input:", error);
    return {
      content: [{ type: "text", text: `Error getting user input: ${error.message}` }],
      isError: true
    };
  }
}