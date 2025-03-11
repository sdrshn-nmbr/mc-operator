#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import puppeteer, { Browser, Page } from "puppeteer";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import * as path from "path";
import express from "express";

// Define the Puppeteer tools available to the client
const TOOLS = [
  {
    name: "puppeteer_navigate",
    description: "Navigate to a specified URL",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "puppeteer_fill",
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
    name: "puppeteer_click",
    description: "Click an element on the page",
    inputSchema: {
      type: "object",
      properties: { selector: { type: "string" } },
      required: ["selector"],
    },
  },
  {
    name: "puppeteer_evaluate",
    description: "Execute JavaScript in the page context and return the result",
    inputSchema: {
      type: "object",
      properties: { script: { type: "string" } },
      required: ["script"],
    },
  },
  {
    name: "puppeteer_waitForSelector",
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
    name: "puppeteer_download_s3_file",
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
    name: "puppeteer_check_tabs_for_s3",
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
    name: "puppeteer_waitForSelector_with_polling",
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
    name: "puppeteer_click_without_target",
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
    name: "puppeteer_keyboard_press",
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
    name: "puppeteer_reliable_form_submit",
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
    name: "puppeteer_close_browser",
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
];

// Global browser variables
let browser: Browser | null = null;
let page: Page | null = null;
let debuggingUrl = '';

// Function to get Chrome/Chromium executable path based on OS
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

// Launch Chrome with remote debugging enabled
async function launchChromeWithRemoteDebugging(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const chromePath = getChromeExecutablePath();
    console.log(`Launching Chrome from: ${chromePath}`);
    
    // Launch Chrome with remote debugging enabled on port 9222
    const chromeProcess = exec(
      `"${chromePath}" --remote-debugging-port=9222 --no-first-run --no-default-browser-check --user-data-dir="${process.env.HOME || process.env.USERPROFILE}/puppeteer-chrome-profile"`,
      (error) => {
        if (error) {
          console.error('Failed to launch Chrome:', error);
          reject(error);
        }
      }
    );
    
    // Give Chrome time to start
    setTimeout(resolve, 2000);
  });
}

// Fetch the WebSocket debugging URL from Chrome
async function fetchDebuggingUrl(): Promise<string> {
  try {
    // Using fetch would require an extra dependency, so using node's http module
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
  } catch (error) {
    console.error('Error fetching debugging URL:', error);
    throw error;
  }
}

// Ensure a browser instance is available
async function ensureBrowser(): Promise<Page> {
  if (!browser || !browser.isConnected()) {
    console.log('Connecting to your existing Chrome browser...');
    
    try {
      // Try to fetch the debugging URL directly first
      debuggingUrl = await fetchDebuggingUrl();
      console.log('Found existing Chrome instance with debugging enabled');
    } catch (error) {
      // If that fails, launch Chrome with debugging enabled
      console.log('No existing Chrome instance found with debugging enabled. Launching a new one...');
      await launchChromeWithRemoteDebugging();
      debuggingUrl = await fetchDebuggingUrl();
    }
    
    // Connect to the browser instance
    console.log(`Connecting to browser at: ${debuggingUrl}`);
    browser = await puppeteer.connect({
      browserWSEndpoint: debuggingUrl,
      defaultViewport: null
    });
    
    // Get all pages and use the last one (usually the most recently opened)
    const pages = await browser.pages();
    
    if (pages.length > 0) {
      // Use the last page that's already open
      page = pages[pages.length - 1];
      console.log(`Connected to existing page: ${await page.title()}`);
    } else {
      // Create a new page if none exists
      page = await browser.newPage();
      console.log('Created a new page');
    }
    
    // Setup page
    await page.setViewport({ width: 1600, height: 900 });
  } else if (!page || (page && typeof page.isClosed === 'function' && page.isClosed())) {
    // If browser is connected but page is closed or null, create a new page
    try {
      page = await browser.newPage();
      console.log('Created a new page in existing browser');
      await page.setViewport({ width: 1600, height: 900 });
    } catch (error) {
      console.error('Error creating new page:', error);
      // If creating a new page fails, try reconnecting to the browser
      browser = null;
      return ensureBrowser();
    }
  }
  
  return page!;
}

// Add this function to handle S3 file downloads
async function downloadS3File(url: string, outputFilename: string = "941-form.pdf"): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log(`Downloading S3 file from: ${url.substring(0, 60)}...`);
    console.log(`Saving to: ${outputFilename}`);
    
    // Get the absolute path to the download script
    const scriptPath = path.resolve(__dirname, 'download-pdf.js');
    
    // Execute the download script as a child process
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

// Modify the checkTabsForS3URL function to better handle expired URLs and retry
async function checkTabsForS3URL(timeout: number = 5000, autoDownload: boolean = true, outputFilename: string = "941-form.pdf"): Promise<{type: string, url: string, message: string, downloadResult?: string}> {
  console.log(`Checking all tabs for S3 URL with timeout: ${timeout}ms`);
  
  // Get all browser pages/tabs
  const pages = await browser!.pages();
  console.log(`Found ${pages.length} open tabs`);
  
  let s3Url = '';
  let resultType = 'not_found';
  let resultMessage = 'No S3 URL found in any tab';
  
  // First check for direct S3 URLs
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
    for (const page of pages) {
      try {
        // Skip S3 pages as we already checked them
        if (page.url().includes('amazonaws.com')) continue;
        
        // Check for various elements that might contain S3 URLs
        const s3EmbedUrl = await page.evaluate(() => {
          // First, check iframes and embed elements
          const iframeEl = document.querySelector('iframe[src*="amazonaws.com"]');
          const embedEl = document.querySelector('embed[src*="amazonaws.com"]');
          const objectEl = document.querySelector('object[data*="amazonaws.com"]');
          
          if (iframeEl && iframeEl.getAttribute('src')) return iframeEl.getAttribute('src');
          if (embedEl && embedEl.getAttribute('src')) return embedEl.getAttribute('src');
          if (objectEl && objectEl.getAttribute('data')) return objectEl.getAttribute('data');
          
          // Next, check for download links with S3 URLs
          const links = Array.from(document.querySelectorAll('a'));
          const s3Link = links.find(link => link.href && link.href.includes('amazonaws.com'));
          if (s3Link) return s3Link.href;
          
          // Check for data attributes that might contain S3 URLs
          const elementsWithDataAttributes = Array.from(document.querySelectorAll('[data-url], [data-download-url], [data-href], [data-src], [data-source]'));
          for (const el of elementsWithDataAttributes) {
            const url = el.getAttribute('data-url') || 
                       el.getAttribute('data-download-url') || 
                       el.getAttribute('data-href') || 
                       el.getAttribute('data-src') || 
                       el.getAttribute('data-source');
            if (url && url.includes('amazonaws.com')) return url;
          }
          
          // Check for JavaScript variables in the page that might contain S3 URLs - this approach can find URLs in more places
          const scripts = Array.from(document.querySelectorAll('script:not([src])'));
          let foundInScript: string | null = null;
          
          for (const script of scripts) {
            const matches = script.textContent?.match(/https:\/\/[^"']*amazonaws\.com[^"']*/g);
            if (matches && matches.length > 0) {
              foundInScript = matches[0];
              break;
            }
          }
          
          // Look for URLs in any element's innerHTML that might contain S3 URLs
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
          
          // Check global variables for S3 URLs (most aggressive approach)
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
          s3Url = s3EmbedUrl;
          resultType = 'embedded';
          resultMessage = 'Found embedded S3 URL in tab content';
          break;
        }

        // If still no URL found, check specifically for download buttons that might trigger a fetch
        if (!s3Url) {
          // Look for download buttons and wait a moment after clicking
          const downloadButtons = await page.$$('button, a');
          
          for (const button of downloadButtons) {
            try {
              const buttonText = await page.evaluate(el => el.textContent, button);
              if (buttonText && buttonText.toLowerCase().includes('download')) {
                console.log('Found download button:', buttonText);
                
                // Click the button and wait for potential network requests with S3 URLs
                await button.click();
                
                // Wait for any network requests that might happen
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Check again for S3 URLs that might have appeared
                const newS3Url = await page.evaluate(() => {
                  // Similar checks as before, but focused on new elements that might have appeared
                  const links = Array.from(document.querySelectorAll('a'));
                  const s3Link = links.find(link => 
                    link.href && link.href.includes('amazonaws.com')
                  );
                  return s3Link ? s3Link.href : null;
                });
                
                if (newS3Url) {
                  console.log(`Found S3 URL after clicking download button: ${newS3Url.substring(0, 60)}...`);
                  s3Url = newS3Url;
                  resultType = 'button_click';
                  resultMessage = 'Found S3 URL after clicking download button';
                  break;
                }
              }
            } catch (error) {
              console.error('Error checking download button:', error);
            }
          }
        }
      } catch (error) {
        console.error(`Error checking tab for S3 content: ${error}`);
      }
    }
  }
  
  // If URL found and autoDownload is enabled, download the file
  let downloadResult;
  let downloadAttempts = 0;
  const maxDownloadAttempts = 5;
  
  if (s3Url && autoDownload) {
    while (downloadAttempts < maxDownloadAttempts) {
      try {
        console.log(`Download attempt ${downloadAttempts + 1}/${maxDownloadAttempts}`);
        downloadResult = await downloadS3File(s3Url, outputFilename);
        resultMessage += `. File downloaded successfully to ${outputFilename}`;
        break;
      } catch (error: any) {
        downloadAttempts++;
        
        // Check if this is an expired token (403 Forbidden)
        if (error.message && error.message.includes('403')) {
          console.log('S3 URL expired. Attempting to refresh the URL...');
          
          if (downloadAttempts >= maxDownloadAttempts) {
            downloadResult = `Error downloading file: ${error.message}. S3 URL expired - please try again.`;
            resultMessage += `. ${downloadResult}`;
          }
        } else {
          downloadResult = `Error downloading file: ${error.message}`;
          resultMessage += `. ${downloadResult}`;
          break;
        }
      }
    }
  }
  
  return {
    type: resultType,
    url: s3Url,
    message: resultMessage,
    downloadResult
  };
}

// Add this function to wait for selectors with polling
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
      // Try to find the element with a short timeout
      await page.waitForSelector(selector, { timeout: pollingInterval });
      console.log(`Selector "${selector}" found on attempt ${attempts}`);
      return `Selector "${selector}" found after ${attempts} attempts`;
    } catch (error) {
      // If we've reached max attempts, throw the error
      if (attempts >= maxAttempts) {
        throw new Error(`Failed to find selector "${selector}" after ${maxAttempts} attempts`);
      }
      
      // Otherwise, log and continue
      console.log(`Selector not found, polling again...`);
      
      // Optionally, you could execute JavaScript to check or modify the DOM here
      try {
        await page.evaluate((sel) => {
          // Look for close matches that might have dynamic IDs or classes
          const elements = document.querySelectorAll('*');
          // Convert NodeListOf to Array before iterating
          Array.from(elements).forEach(el => {
            if (el.textContent?.includes(sel.replace(/[^\w\s]/g, ''))) {
              console.log('Found element with similar text:', el.textContent);
              // Optionally add an ID to help future selections
              el.id = 'polled-element-' + Date.now();
            }
          });
        }, selector);
      } catch (evalError) {
        console.error('Error during evaluation:', evalError);
      }
      
      // Wait for the polling interval before trying again
      await new Promise(resolve => setTimeout(resolve, pollingInterval));
    }
  }
  
  throw new Error(`Timed out waiting for selector "${selector}" after ${timeout}ms`);
}

// Add a function to disconnect from the browser without closing it
async function disconnectFromBrowser() {
  if (browser) {
    try {
      await browser.disconnect();
      page = null;
      browser = null;
      console.log('Disconnected from Chrome browser (browser instance still running)');
    } catch (error) {
      console.error('Error disconnecting from browser:', error);
    }
  }
}

// Update the closeBrowser function and add shouldDisconnectOnly parameter
async function closeBrowser(shouldDisconnectOnly: boolean = false) {
  if (browser) {
    try {
      if (shouldDisconnectOnly) {
        await disconnectFromBrowser();
      } else {
        await browser.close();
        browser = null;
        page = null;
        console.log('Browser instance closed successfully');
      }
    } catch (error) {
      console.error('Error closing browser:', error);
    }
  }
}

// Update the handleCloseBrowser function
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

// Main handler for tool calls
async function handleToolCall(toolName: string, args: any) {
  if (toolName === "puppeteer_close_browser") {
    return handleCloseBrowser(args);
  }
  
  // For all other tools, ensure the browser is initialized
  try {
    const page = await ensureBrowser();
    
    switch (toolName) {
      case "puppeteer_navigate":
        await page.goto(args.url, { waitUntil: "domcontentloaded" });
        return { content: [{ type: "text", text: `Navigated to ${args.url}` }], isError: false };
      case "puppeteer_fill":
        await page.type(args.selector, args.value);
        return { content: [{ type: "text", text: `Filled ${args.selector} with ${args.value}` }], isError: false };
      case "puppeteer_click":
        await page.click(args.selector);
        return { content: [{ type: "text", text: `Clicked ${args.selector}` }], isError: false };
      case "puppeteer_evaluate":
        try {
          // Add try/catch specific to evaluate to provide better error messages
          const evalResult = await page.evaluate(args.script);
          
          // Handle different result types to ensure we always return valid text
          let resultText = "Script executed successfully";
          
          if (evalResult !== undefined && evalResult !== null) {
            // Convert different types to string safely
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
          
          return { content: [{ type: "text", text: resultText }], isError: false };
        } catch (evalError: any) {
          // Handle specific evaluation errors more gracefully
          let errorMessage = evalError.message || "Unknown evaluate error";
          
          // Provide more helpful info for common errors
          if (errorMessage.includes("Illegal return statement")) {
            errorMessage = "Error: Illegal return statement. Avoid using 'return' in your script, just end with the expression to evaluate.";
          } else if (errorMessage.includes("Cannot read property") || errorMessage.includes("is not defined")) {
            errorMessage = `Error: ${errorMessage}. Make sure all variables and properties exist before accessing them.`;
          }
          
          return { content: [{ type: "text", text: errorMessage }], isError: true };
        }
      case "puppeteer_waitForSelector":
        await page.waitForSelector(args.selector, { timeout: args.timeout || 30000 });
        return { content: [{ type: "text", text: `Waited for ${args.selector}` }], isError: false };
      case "puppeteer_download_s3_file":
        const { url, outputFilename = "941-form.pdf" } = args;
        try {
          const result = await downloadS3File(url, outputFilename);
          return { content: [{ type: "text", text: result }], isError: false };
        } catch (error: any) {
          return { 
            content: [{ type: "text", text: `Error downloading file: ${error.message}` }],
            isError: true 
          };
        }
      case "puppeteer_check_tabs_for_s3":
        const { timeout = 5000, autoDownload = true, filename = "941-form.pdf" } = args;
        const s3Result = await checkTabsForS3URL(timeout, autoDownload, filename);
        return { 
          content: [{ type: "text", text: JSON.stringify(s3Result) }],
          isError: s3Result.type === 'not_found'
        };
      case "puppeteer_waitForSelector_with_polling":
        const { selector: pollingSelector, timeout: pollingTimeout = 10000, pollingInterval = 500, maxAttempts = 10 } = args;
        try {
          const result = await waitForSelectorWithPolling(pollingSelector, pollingTimeout, pollingInterval, maxAttempts);
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
      case "puppeteer_click_without_target": {
        const selector = args.selector;
        const waitForNavigation = args.waitForNavigation === true;
        const href = args.href;
        
        try {
          // First, modify the element to prevent new tab opening
          await page.evaluate((selector, href) => {
            const element = document.querySelector(selector);
            if (!element) throw new Error(`Element not found: ${selector}`);
            
            // Remove target="_blank" or any other target
            element.removeAttribute('target');
            
            // Override click behavior
            element.onclick = function(e: MouseEvent) {
              e.preventDefault();
              e.stopPropagation();
              
              // If href was provided, update the element's href
              if (href) {
                element.setAttribute('href', href);
              }
              
              // Navigate in the same tab
              window.location.href = element.getAttribute('href') || '';
              return false;
            };
            
            // Also, if it's a button, prevent any event listeners that might open a new tab
            const originalClick = element.click;
            element.click = function() {
              try {
                originalClick.call(this);
              } catch (e) {
                console.error('Error during click:', e);
              }
              return false;
            };
          }, selector, href);
          
          // Now click the element
          if (waitForNavigation) {
            await Promise.all([
              page.waitForNavigation({ waitUntil: 'networkidle0' }),
              page.click(selector)
            ]);
          } else {
            await page.click(selector);
          }
          
          return { content: [{ type: "text", text: `Clicked ${selector} in same tab` }] };
        } catch (error: any) {
          console.error(`Error clicking without target: ${error}`);
          return { 
            content: [{ type: "text", text: `Error clicking ${selector}: ${error.message}` }],
            isError: true 
          };
        }
      }
      case "puppeteer_keyboard_press": {
        const { key, selector, waitForNavigation } = args;
        try {
          if (selector) {
            await page.focus(selector);
          }
          
          if (waitForNavigation) {
            await Promise.all([
              page.waitForNavigation({ waitUntil: 'networkidle0' }),
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
      case "puppeteer_reliable_form_submit": {
        const { inputSelector, submitButtonSelector, formSelector, expectedResultSelector, waitForNavigation } = args;
        try {
          // 1. Focus on the input element
          await page.focus(inputSelector);
          console.log(`Focused on input field: ${inputSelector}`);
          
          // 2. Try multiple approaches for submission in sequence
          let submissionSuccessful = false;
          let errorMessages: string[] = [];
          
          // Method 1: Try clicking the submit button if provided
          if (submitButtonSelector) {
            try {
              // Check if button exists
              const submitButtonExists = await page.evaluate(
                (selector) => !!document.querySelector(selector),
                submitButtonSelector
              );
              
              if (submitButtonExists) {
                if (waitForNavigation) {
                  await Promise.all([
                    page.waitForNavigation({ waitUntil: 'networkidle0' }),
                    page.click(submitButtonSelector)
                  ]);
                } else {
                  await page.click(submitButtonSelector);
                }
                console.log(`Clicked submit button: ${submitButtonSelector}`);
                
                // Check if expected result appears
                try {
                  await page.waitForSelector(expectedResultSelector, { timeout: 5000 });
                  submissionSuccessful = true;
                  console.log(`Form submission successful via submit button`);
                } catch (resultError: any) {
                  errorMessages.push(`Button click didn't produce expected results: ${resultError.message}`);
                }
              }
            } catch (buttonError: any) {
              errorMessages.push(`Error clicking submit button: ${buttonError.message}`);
            }
          }
          
          // Method 2: Try submitting the form directly
          if (!submissionSuccessful && formSelector) {
            try {
              const formSubmitResult = await page.evaluate((formSel) => {
                const form = document.querySelector(formSel);
                if (!form) return false;
                form.submit();
                return true;
              }, formSelector);
              
              if (formSubmitResult) {
                if (waitForNavigation) {
                  await page.waitForNavigation({ waitUntil: 'networkidle0' });
                }
                
                // Check if expected result appears
                try {
                  await page.waitForSelector(expectedResultSelector, { timeout: 5000 });
                  submissionSuccessful = true;
                  console.log(`Form submission successful via form.submit()`);
                } catch (resultError: any) {
                  errorMessages.push(`Form submission didn't produce expected results: ${resultError.message}`);
                }
              }
            } catch (formError: any) {
              errorMessages.push(`Error submitting form: ${formError.message}`);
            }
          }
          
          // Method 3: Try using keyboard Enter press
          if (!submissionSuccessful) {
            try {
              if (waitForNavigation) {
                await Promise.all([
                  page.waitForNavigation({ waitUntil: 'networkidle0' }),
                  page.keyboard.press('Enter')
                ]);
              } else {
                await page.keyboard.press('Enter');
              }
              
              // Check if expected result appears
              try {
                await page.waitForSelector(expectedResultSelector, { timeout: 5000 });
                submissionSuccessful = true;
                console.log(`Form submission successful via Enter key`);
              } catch (resultError: any) {
                errorMessages.push(`Enter key didn't produce expected results: ${resultError.message}`);
              }
            } catch (keyError: any) {
              errorMessages.push(`Error pressing Enter key: ${keyError.message}`);
            }
          }
          
          // Method 4: Try JavaScript event dispatch as a last resort
          if (!submissionSuccessful) {
            try {
              const jsSubmitResult = await page.evaluate((inputSel) => {
                const input = document.querySelector(inputSel);
                if (!input) return false;
                
                // Try keypress
                const keypressEvent = new KeyboardEvent('keypress', {
                  key: 'Enter',
                  code: 'Enter',
                  keyCode: 13,
                  which: 13,
                  bubbles: true
                });
                input.dispatchEvent(keypressEvent);
                
                // Also try keydown
                const keydownEvent = new KeyboardEvent('keydown', {
                  key: 'Enter',
                  code: 'Enter',
                  keyCode: 13,
                  which: 13,
                  bubbles: true
                });
                input.dispatchEvent(keydownEvent);
                
                // Find parent form if any and submit it
                let parentForm = input.closest('form');
                if (parentForm) {
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
                  await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 5000 }).catch(() => {});
                }
                
                // Check if expected result appears
                try {
                  await page.waitForSelector(expectedResultSelector, { timeout: 5000 });
                  submissionSuccessful = true;
                  console.log(`Form submission successful via JavaScript events`);
                } catch (resultError: any) {
                  errorMessages.push(`JavaScript events didn't produce expected results: ${resultError.message}`);
                }
              }
            } catch (jsError: any) {
              errorMessages.push(`Error with JavaScript event submission: ${jsError.message}`);
            }
          }
          
          // Final result
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
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${toolName}` }], isError: true };
    }
  } catch (error) {
    return { content: [{ type: "text", text: `Error: ${(error as Error).message}` }], isError: true };
  }
}

// Set up the MCP server
const server = new Server(
  { name: "puppeteer-server", version: "1.0.0" },
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
  console.log("Puppeteer MCP server running on stdio");

  // Add a signal handler to properly close the browser on server termination
  process.on('SIGINT', async () => {
    console.log('Received SIGINT. Closing browser and terminating...');
    await closeBrowser(false); // Close completely, not just disconnect
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM. Closing browser and terminating...');
    await closeBrowser(false); // Close completely, not just disconnect
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Server failed to start:", error);
  process.exit(1);
});