#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "child_process";
import { Anthropic } from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";
import * as readline from "readline";
import * as fs from "fs";

// Load environment variables
dotenv.config();
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error("Error: ANTHROPIC_API_KEY not found in .env file.");
  process.exit(1);
}

// Browserbase configuration
const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY || "MnHzDIVH9Ju5wxmY30KY_fseGQA";
const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID || "433bf829-83c1-4833-bd81-803633977f36";
const USE_BROWSERBASE = process.env.USE_BROWSERBASE === "true" || process.argv.includes("--browserbase");

if (USE_BROWSERBASE) {
  console.log("Using Browserbase for browser automation");
  if (!BROWSERBASE_API_KEY || !BROWSERBASE_PROJECT_ID) {
    console.error("Error: BROWSERBASE_API_KEY or BROWSERBASE_PROJECT_ID not configured.");
    process.exit(1);
  }
  
  // Set environment variables for the server process
  process.env.BROWSERBASE_API_KEY = BROWSERBASE_API_KEY;
  process.env.BROWSERBASE_PROJECT_ID = BROWSERBASE_PROJECT_ID;
  process.env.USE_BROWSERBASE = "true";
} else {
  console.log("Using local Chrome for browser automation");
}

// Agent mode configuration
const AGENT_MODE = process.env.AGENT_MODE || 'interactive';
const AGENT_INSTRUCTIONS_PATH = process.env.AGENT_INSTRUCTIONS_PATH;

// Add a proper system prompt 
const defaultUserPrompt = `
# Box.com Login and File Management

## Login Process
1. Navigate to https://app.box.com
2. Click on div.sign-in-with-google-text to sign in with Google
3. Fill the email field with: sudarshan@team.anon.com
4. For Next button, use this JavaScript:
   \`\`\`javascript
   Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Next')).click()
   \`\`\`

5. When seeing "Try another way", click it using XPath:
   \`\`\`javascript
   document.evaluate("//button[contains(., 'Try another way')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue.click()
   \`\`\`

6. After seeing password option, click "Enter your password" using XPath:
   \`\`\`javascript
   document.evaluate("//*[text()='Enter your password']", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue.click()
   \`\`\`

7. When the password field appears, fill it:
   \`\`\`javascript
   await playwright_fill({ selector: "input[type='password']", value: '#SudduAnanth15243' })
   \`\`\`

8. Click Next using XPath:
   \`\`\`javascript
   document.evaluate("//button[contains(., 'Next')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue.click()
   \`\`\`

9. On 2FA screen, first click "Try another way" using XPath:
   \`\`\`javascript
   document.evaluate("//button[contains(., 'Try another way')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue.click()
   \`\`\`

10. Select the "Tap Yes on your phone" option:
    \`\`\`javascript
    Array.from(document.querySelectorAll('li.aZvCDf')).find(li => li.innerText.includes('Tap Yes on your phone')).click()
    \`\`\`
    OR if above doesn't work, try:
    \`\`\`javascript
    document.querySelectorAll('li.aZvCDf')[3].click()
    \`\`\`

11. Ask the user to approve the authentication on their device and wait for confirmation
12. After login completes, wait for the Box.com interface to load:
    \`\`\`javascript
    await playwright_waitForSelector({ selector: '.more-options-btn', timeout: 60000 })
    \`\`\`

## Box.com File Operations
1. Click the more options button:
   \`\`\`javascript
   await playwright_click({ selector: '.more-options-btn' })
   \`\`\`

2. Open the Download menu item:
   \`\`\`javascript
   Array.from(document.querySelectorAll('li')).find(li => li.innerText.includes('Download')).click()
   \`\`\`

3. For File Upload, click Upload option and use the playwright_upload tool to upload a file
   - If there are download files available, first use playwright_browserbase_download to retrieve them

IMPORTANT NOTES:
- Standard CSS selectors often fail with Google login - prefer JavaScript DOM traversal
- XPath selectors work well for finding buttons by text content
- The 2FA process requires user interaction, prepare to wait for user confirmation
- Always verify page content with document.body.innerText before proceeding to next step
- When selectors fail, try to find alternative approaches using DOM traversal
`;

// System prompt for Claude
const systemPrompt = `
You are a web automation assistant that helps users automate tasks using playwright.

## Browser Automation Tools
You have access to several tools for browser automation, including navigate, click, fill, evaluate, screenshot, waitForSelector, and more. Use them strategically to accomplish the user's web automation goals.

## Selector Best Practices
1. For selectors, prefer specific patterns in this order:
   - IDs (#selector) - most reliable
   - CSS selectors with specific attributes (e.g., [data-testid="login"])
   - Classes (.class-name) - can be brittle if they change
   - XPath selectors as a last resort - most brittle

2. If a selector cannot be found:
   - Add an ID to the element using evaluate
   - Use a more general selector and refine with JavaScript
   - Search for the element by text content

3. For dynamic content:
   - Use waitForSelector
   - Use the playwright_waitForSelector_with_polling tool for content that loads slowly
   - Always verify elements exist before interacting with them

## Error Handling
- When clicking elements, ensure they exist first
- If a selector isn't found, try using DOM traversal to find similar elements
- When filling forms, verify the input field exists before attempting to fill it
- For conditional logic, use evaluate to check for element existence

## Form Submission
For reliable form submissions, use multiple approaches in sequence:

1. First try the playwright_reliable_form_submit tool, which combines multiple submission methods:
   - It will try clicking the submit button if provided
   - Then try form.submit() if a form selector is provided
   - Then try keyboard Enter press
   - Finally fallback to JavaScript event dispatch
   - It also verifies the submission was successful

2. If that fails, try these individual approaches in sequence:
   - Clicking a dedicated submit/search button
   - Using playwright_keyboard_press with key: "Enter" and appropriate selector
   - Using form.submit() via evaluate
   - JavaScript event dispatch

3. Always verify search submission success by checking for results

## Special Tool: playwright_click_without_target
For links or buttons that would open in a new tab (using target="_blank" or JavaScript):
- Use playwright_click_without_target instead of regular click
- This tool modifies the element to remove target attributes and override click handlers
- It keeps navigation in the same tab, preventing "lost context" issues
- It also supports waitForNavigation for synchronization

## Handling Downloads
1. For download links with direct file URLs:
   - Extract the href and navigate directly to it
   - Use playwright_download_s3_file for direct downloads

2. For download links that point to Amazon S3:
   - Use playwright_check_tabs_for_s3 to find and automatically download the file
   - This helps with one-time use S3 URLs that expire quickly
   - Parameters include timeout, autoDownload (default true), and filename

## Amazon S3 URL Handling
- S3 URLs contain temporary authorization tokens that expire quickly (often in 30 seconds)
- Always get a fresh URL before attempting to download
- If you receive a 403 Forbidden error, it means the URL has expired - you need to navigate back and get a fresh URL
- The playwright_check_tabs_for_s3 tool has retry logic for expired URLs

## JavaScript Evaluation Guidelines
- Avoid using 'return' statements in playwright_evaluate scripts
- End evaluate scripts with the expression to evaluate
- Keep DOM manipulations simple
- Use console.log statements within evaluate for debugging
- Don't return complex objects; prefer simple values or strings

## Multi-Tab Operations
- Avoid opening new tabs when possible
- Use playwright_click_without_target for links that would open in new tabs
- When new tabs are necessary, use playwright_check_tabs_for_s3 to work across all tabs
`;

// Type definitions
interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

interface ToolUseBlock {
  type: "tool_use";
  name: string;
  input: Record<string, any>;
  id: string;
}

interface ToolResult {
  content: Array<{type: string; text: string}>;
  isError?: boolean;
}

// Start the server as a subprocess
async function startServer() {
  const serverProcess = spawn("npx", ["ts-node", "server.ts"], {
    stdio: ["pipe", "pipe", "inherit"],
    env: process.env
  });
  
  return serverProcess;
}

// Connect the MCP client to the server
async function connectClient(serverProcess: any): Promise<Client> {
  const client = new Client({ name: "rippling-client", version: "1.0.0" }, {});
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["ts-node", "server.ts"],
    env: {
      ...process.env,
      BROWSERBASE_API_KEY,
      BROWSERBASE_PROJECT_ID,
      USE_BROWSERBASE: USE_BROWSERBASE ? "true" : "false"
    }
  });
  await client.connect(transport);
  return client;
}

// Ask the user for input (e.g., 2FA code)
async function askForInput(message: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message + " ", (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// Automate the Rippling login process with LLM
async function automateWithLLM(client: Client, prompt: string, description: string = ""): Promise<boolean> {
  console.log(`Starting ${description || "automation"} step...`);
  
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const serverTools = (await client.listTools()).tools;
  const askUserTool = {
    name: "ask_user",
    description: "Ask the user for input, such as a 2FA code",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
    },
  };
  const allTools = [...serverTools, askUserTool];

  const anthropicTools: AnthropicTool[] = allTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as { type: "object"; properties: Record<string, any>; required?: string[] },
  }));

  let messages: any[] = [{ role: "user", content: prompt }];
  const MAX_ITERATIONS = 1000; // Reduced for each stage
  let iteration = 0;
  let success = false;

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    console.log(`Iteration ${iteration}: Processing ${description || "task"}...`);

    const response = await anthropic.beta.messages.create({
      model: "claude-sonnet-4-20250514",
      system: systemPrompt,
      max_tokens: 64000,
      messages,
      tools: anthropicTools,
      betas: ["token-efficient-tools-2025-02-19", "output-128k-2025-02-19"]
    });

    if (response.stop_reason === "end_turn") {
      const finalText = response.content.find((c) => c.type === "text")?.text || "Task completed.";
      console.log(`${description || "Task"} completed:`, finalText);
      success = true;
      break;
    } else if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });
      const toolCalls = response.content.filter((c: any) => c.type === "tool_use");

      for (const toolCall of toolCalls) {
        if (toolCall.type === "tool_use") {
          const { name, input, id } = toolCall as ToolUseBlock;
          console.log(`Executing tool: ${name} with input:`, input);

          if (name === "ask_user") {
            const userInput = await askForInput(input.message);
            messages.push({
              role: "user",
              content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text: userInput }] }],
            });
          } else {
            const toolParams = {
              name,
              arguments: input
            };
            const result = await client.callTool(toolParams);
            messages.push({
              role: "user",
              content: [{ type: "tool_result", tool_use_id: id, content: result.content }],
            });
            console.log(`Tool result:`, result.content);
          }
        }
      }
    } else {
      console.log("Unexpected stop reason:", response.stop_reason);
      break;
    }
  }

  if (iteration >= MAX_ITERATIONS) {
    console.log(`Maximum iterations reached. ${description || "Task"} may not be complete.`);
    success = false;
  }
  
  return success;
}

// Multi-stage automation function
async function runMultiStageAutomation(client: Client): Promise<boolean> {
  console.log("Starting multi-stage automation process...");
  
  // Stage 1: Login
  console.log("=== STAGE 1: LOGIN ===");
  const loginSuccess = await automateWithLLM(client, defaultUserPrompt, "login");
  
  if (!loginSuccess) {
    console.log("Login failed. Stopping automation.");
    return false;
  }
  
  console.log("Login successful!");
  console.log("Pausing for 3 seconds before starting extraction...");
  
  // Deterministic pause between stages
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Example of deterministic actions between stages
  try {
    // Take a screenshot using CDP for better performance as recommended by Browserbase
    console.log("Taking screenshot using CDP for better performance...");
    const screenshotResult = await client.callTool({
      name: "playwright_evaluate",
      arguments: {
        script: `
          // Create a CDP session
          const client = await context.newCDPSession(page);
          
          // Capture screenshot using CDP
          const { data } = await client.send("Page.captureScreenshot", {
            format: "jpeg",
            quality: 80,
            fullpage: true
          });
          
          // Return the base64 data
          data;
        `
      }
    });
    
    // Cast the content to the appropriate type and safely access properties
    const screenshotContent = screenshotResult.content as Array<{type: string, text: string}>;
    const base64Data = screenshotContent[0]?.text;
    
    // Save the screenshot if we got valid data
    if (base64Data) {
      const fs = require('fs');
      const screenshotDir = 'screenshots';
      
      // Create directory if it doesn't exist
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }
      
      // Save the screenshot
      const buffer = Buffer.from(base64Data, 'base64');
      const screenshotPath = `${screenshotDir}/dashboard_${Date.now()}.jpeg`;
      fs.writeFileSync(screenshotPath, buffer);
      console.log(`Screenshot saved to ${screenshotPath}`);
    } else {
      console.log("Failed to capture screenshot using CDP");
    }
    
    // // Check if we're actually on the dashboard
    // const dashboardCheck = await client.callTool({
    //   name: "playwright_evaluate",
    //   arguments: {
    //     script: `document.querySelector('div[data-testid="company-name"]') !== null`
    //   }
    // });
    
    // Handle type safely
    // const dashboardContent = dashboardCheck.content as Array<{type: string, text: string}>;
    // const dashboardResult = dashboardContent[0]?.text || "false";
    // console.log("Dashboard verification:", dashboardResult);
    
    // if (dashboardResult !== "true") {
    //   console.log("WARNING: Dashboard verification failed. Continuing anyway...");
    // }
  } catch (error) {
    console.error("Error during inter-stage operations:", error);
    // Continue anyway
  }
  
  // Stage 2: Data Extraction
  // console.log("=== STAGE 2: DATA EXTRACTION ===");
  // const extractionSuccess = await automateWithLLM(client, extractionPrompt, "extraction");
  
  // return extractionSuccess;
  
  // Return true since login succeeded and no other stages are currently enabled
  return true;
}

// Properly clean up resources
async function cleanupResources(client: Client, serverProcess: any, shouldCloseCompletely: boolean = false): Promise<void> {
  if (shouldCloseCompletely) {
    try {
      console.log('Closing browser...');
      await client.callTool({
        name: "playwright_close_browser",
        arguments: {
          shouldDisconnectOnly: false
        }
      });
      console.log('Browser closed successfully');
    } catch (error) {
      console.error('Error closing browser:', error);
    }
  } else {
    console.log('Keeping browser instance alive for next command...');
  }
  
  if (AGENT_MODE === 'execute' || shouldCloseCompletely) {
    try {
      await client.close();
      console.log('Disconnected from MCP server');
    } catch (error) {
      console.error('Error disconnecting client:', error);
    }
    
    try {
      if (serverProcess && !serverProcess.killed) {
        serverProcess.kill();
        console.log('Terminated server process');
      }
    } catch (error) {
      console.error('Error terminating server process:', error);
    }
  } else {
    process.exit(0);
  }
}

// Main execution function
async function main() {
  console.log(`Starting ${USE_BROWSERBASE ? 'Browserbase' : 'local Chrome'} automation...`);
  
  const serverProcess = await startServer();
  
  try {
    const client = await connectClient(serverProcess);
    
    if (AGENT_MODE === 'execute' && AGENT_INSTRUCTIONS_PATH) {
      console.log('Running in agent mode with instructions from:', AGENT_INSTRUCTIONS_PATH);
      
      try {
        const customPrompt = fs.readFileSync(AGENT_INSTRUCTIONS_PATH, 'utf-8');
        // For custom instructions, use the monolithic approach
        const success = await automateWithLLM(client, customPrompt);
        
        console.log('[AGENT_RESULT]', JSON.stringify({ 
          status: success ? 'success' : 'error',
          message: success ? 'Execution completed successfully' : 'Execution failed'
        }));
        
        await cleanupResources(client, serverProcess, true);
        
        if (AGENT_MODE === 'execute') {
          process.exit(success ? 0 : 1);
        }
      } catch (error) {
        console.error('Error in agent mode:', error);
        
        console.log('[AGENT_RESULT]', JSON.stringify({ 
          status: 'error',
          message: error instanceof Error ? error.message : String(error)
        }));
        
        await cleanupResources(client, serverProcess, true);
        
        if (AGENT_MODE === 'execute') {
          process.exit(1);
        }
      }
    } else {
      // Use multi-stage approach for interactive mode
      const success = await runMultiStageAutomation(client);
      
      console.log("Multi-stage automation completed with result:", success ? "SUCCESS" : "FAILURE");
      
      await cleanupResources(client, serverProcess, false);
    }
  } catch (error) {
    console.error('Error in main process:', error);
    
    if (serverProcess) {
      try {
        serverProcess.kill();
      } catch (e) {
        console.error('Error terminating server process:', e);
      }
    }
    
    if (AGENT_MODE === 'execute') {
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});