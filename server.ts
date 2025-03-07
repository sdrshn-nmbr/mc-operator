#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import puppeteer, { Browser, Page } from "puppeteer";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import * as path from "path";

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
];

// Global browser and page instances
let browser: Browser | undefined;
let page: Page | undefined;

// Ensure a browser instance is available
async function ensureBrowser(): Promise<Page> {
  if (!browser || !browser.isConnected()) {
    // Launch browser with specific arguments to maximize window
    browser = await puppeteer.launch({ 
      headless: false,
      defaultViewport: null, // Important - disables the default viewport
      args: [
        '--start-maximized', // Starts the browser maximized
        '--window-size=1920,1080', // Fallback size if maximizing fails
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });
    
    page = await browser.newPage();
    
    // Maximize using multiple approaches to ensure it works across platforms
    
    // Approach 1: Set viewport to a large size
    await page.setViewport({
      width: 1920,
      height: 1080
    });
    
    // Approach 2: Use Chrome DevTools Protocol session for true maximize
    try {
      const session = await page.target().createCDPSession();
      const {windowId} = await session.send('Browser.getWindowForTarget');
      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: {windowState: 'maximized'}
      });
    } catch (error) {
      console.log("Could not maximize using CDP, falling back to viewport approach");
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

// Modify the checkTabsForS3URL function to automatically download the file
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
        
        // Check for iframe/embed elements with S3 URLs
        const s3EmbedUrl = await page.evaluate(() => {
          const iframeEl = document.querySelector('iframe[src*="amazonaws.com"]');
          const embedEl = document.querySelector('embed[src*="amazonaws.com"]');
          const objectEl = document.querySelector('object[data*="amazonaws.com"]');
          
          if (iframeEl && iframeEl.getAttribute('src')) return iframeEl.getAttribute('src');
          if (embedEl && embedEl.getAttribute('src')) return embedEl.getAttribute('src');
          if (objectEl && objectEl.getAttribute('data')) return objectEl.getAttribute('data');
          
          // Check for download links with S3 URLs
          const links = Array.from(document.querySelectorAll('a'));
          const s3Link = links.find(link => link.href && link.href.includes('amazonaws.com'));
          if (s3Link) return s3Link.href;
          
          return null;
        });
        
        if (s3EmbedUrl) {
          console.log(`Found embedded S3 URL in tab: ${s3EmbedUrl.substring(0, 60)}...`);
          s3Url = s3EmbedUrl;
          resultType = 'embedded';
          resultMessage = 'Found embedded S3 URL in tab content';
          break;
        }
      } catch (error) {
        console.error(`Error checking tab for S3 content: ${error}`);
      }
    }
  }
  
  // If URL found and autoDownload is enabled, download the file
  let downloadResult;
  if (s3Url && autoDownload) {
    try {
      downloadResult = await downloadS3File(s3Url, outputFilename);
      resultMessage += `. File downloaded successfully to ${outputFilename}`;
    } catch (error: any) {
      downloadResult = `Error downloading file: ${error.message}`;
      resultMessage += `. ${downloadResult}`;
    }
  }
  
  return {
    type: resultType,
    url: s3Url,
    message: resultMessage,
    downloadResult
  };
}

// Handle tool calls from the client
async function handleToolCall(name: string, args: any) {
  const page = await ensureBrowser();
  try {
    switch (name) {
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
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
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

  // Cleanup on process exit
  process.on("SIGINT", async () => {
    if (browser) {
      await browser.close();
    }
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Server failed to start:", error);
  process.exit(1);
});