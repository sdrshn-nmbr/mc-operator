#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "child_process";
import { Anthropic } from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";
import * as readline from "readline";
import { exec } from 'child_process';
import * as path from 'path';

// Load environment variables
dotenv.config();
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error("Error: ANTHROPIC_API_KEY not found in .env file.");
  process.exit(1);
}

// Add support for autonomous agent mode
const AGENT_MODE = process.env.AGENT_MODE || 'interactive';
const AGENT_INSTRUCTIONS_PATH = process.env.AGENT_INSTRUCTIONS_PATH;

// Define the base userPrompt 
const defaultUserPrompt = `I need to log into Gusto at https://app.gusto.com and download all 941 forms and also download employee summary report from reports tab.

# Gusto Login and Navigation Instructions

Please help me log in to Gusto, download a 941 tax form, and an employee summary report. Follow these instructions carefully:

1. **Navigate to Login Page**
   - Go to https://app.gusto.com/login

2. **Login with Credentials**
   - Fill in the email field (input[name="email"]) with: daniel@elemetric.io
   - Fill in the password field (input[name="password"]) with: midas!1434
   - Click the submit button (button[type="submit"])

3. **Handle Two-Factor Authentication**
   - When the 2FA screen appears, look for input[name="code"]
   - Ask me for the verification code
   - Enter the code I provide
   - Click the submit button with id="submit-2fa-code" or button[type="submit"]

4. **Skip Device Remembering**
   - After 2FA verification, look for a button containing "Skip for now" text
   - Use this script to find and ID it:
     buttons = Array.from(document.querySelectorAll('button'));
     skipButton = buttons.find(btn => btn.textContent.includes('Skip for now'));
     if (skipButton) skipButton.id = 'skip-for-now-btn';
   - Click it using the assigned ID: #skip-for-now-btn

5. **Switch to Elemetric Inc Company Account**
   - Wait for button[aria-label="Account menu"] to appear and click it
   - In the dropdown, find and add ID to the "Switch company" option:
     switchOption = Array.from(document.querySelectorAll('a, button')).find(el => el.textContent.includes('Switch company'));
     if (switchOption) switchOption.id = 'switch-company-option';
   - Click #switch-company-option
   - Find the Elemetric Inc link:
     elemetricLink = Array.from(document.querySelectorAll('a')).find(link => link.href && link.href.includes('elemetric-inc/payroll_admin'));
     if (elemetricLink) elemetricLink.id = 'elemetric-link';
   - Click #elemetric-link

6. **Navigate to Tax Documents and Download 941 Form**
   - Navigate directly to: https://app.gusto.com/elemetric-inc/payroll_admin/taxes-and-compliance/tax-documents
   - Find the first 941 tax form view link:
     rows = Array.from(document.querySelectorAll('tr')).filter(row => row.textContent.startsWith('941') && !row.textContent.includes('Illinois'));
     if (rows.length > 0) {
       viewLink = rows[0].querySelector('a[href*="/forms/"]');
       if (viewLink) viewLink.id = 'view-941-link-0';
     }
   - Get the href from the link rather than clicking it:
     formUrl = document.querySelector('#view-941-link-0').getAttribute('href');
     formUrl;
   - Navigate directly to the form URL (to avoid opening a new tab):
     https://app.gusto.com + formUrl
   - Use puppeteer_check_tabs_for_s3 tool with:
     {
       timeout: 5000,
       autoDownload: true,
       filename: "941-form.pdf"
     }

7. **Navigate to Employee Summary Report**
   - Navigate back to Elemetric Inc dashboard: https://app.gusto.com/elemetric-inc/payroll_admin
   - Find and click on the Reports link in the sidebar:
     reportLink = Array.from(document.querySelectorAll('a')).find(el => el.textContent.includes('Reports'));
     if (reportLink) reportLink.id = 'reports-sidebar-link';
   - Click #reports-sidebar-link
   - Find and click on the Employee Summary report:
     employeeSummaryLink = Array.from(document.querySelectorAll('a')).find(el => el.textContent.includes('Employee summary'));
     if (employeeSummaryLink) employeeSummaryLink.id = 'employee-summary-link';
   - Click #employee-summary-link

8. **Generate and Download Employee Summary Report**
   - Find the Generate Report button:
     generateButton = Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('Generate report'));
     if (generateButton) {
       generateButton.id = 'generate-report-button';
       // Store the URL that the button would navigate to
       if (generateButton.getAttribute('data-url')) {
         // This is for buttons with data-url attributes
         generateButton.setAttribute('data-target-url', generateButton.getAttribute('data-url'));
       } else if (generateButton.onclick) {
         // Try to extract URL from onclick handler if possible
         const onclickString = generateButton.onclick.toString();
         const urlMatch = onclickString.match(/window\\.location\\.href\\s*=\\s*['"]([^'"]+)['"]/);
         if (urlMatch && urlMatch[1]) {
           generateButton.setAttribute('data-target-url', urlMatch[1]);
         }
       }
     }
   
   - IMPORTANT: Use the special click tool that prevents new tabs:
     Use puppeteer_click_without_target with selector #generate-report-button and waitForNavigation: true
   
   - After the report page loads, wait a moment for the Download CSV button to appear
   
   - First, look for any download buttons:
     const downloadElements = Array.from(document.querySelectorAll('button, a')).filter(el => 
       el.textContent.includes('Download') || 
       (el.querySelector('span') && el.querySelector('span').textContent.includes('Download')));
     
     if (downloadElements.length > 0) {
       downloadElements.forEach((el, i) => { 
         el.id = 'download-element-' + i; 
         console.log('Found download element:', el.textContent);
       });
     }
   
   - Check again after a delay to give buttons time to appear:
     setTimeout(() => {
       const downloadButtons = Array.from(document.querySelectorAll('button')).filter(btn => 
         btn.textContent.includes('Download CSV') || 
         (btn.querySelector('span') && btn.querySelector('span').textContent.includes('Download CSV')));
       
       if (downloadButtons.length > 0) {
         downloadButtons.forEach((btn, i) => { btn.id = 'download-csv-' + i; });
         console.log('Found CSV buttons:', downloadButtons.length);
       }
     }, 2000);
   
   - Use puppeteer_waitForSelector_with_polling to wait for any download button to appear:
     selector: '[id^="download-csv-"]', pollingInterval: 500, maxAttempts: 30
   
   - Click the download button when it appears:
     Use puppeteer_click_without_target with selector: '[id^="download-csv-"]'
   
   - Use puppeteer_check_tabs_for_s3 to find and download the CSV:
     {
       timeout: 5000,
       autoDownload: true,
       filename: "employee-summary.csv"
     }

### Important Notes
- For the 941 form, we navigate directly to the form URL instead of clicking to avoid opening a new tab
- For the employee summary, we use puppeteer_click_without_target to prevent new tab opening
- The puppeteer_check_tabs_for_s3 tool handles downloading files automatically
- S3 URLs expire quickly (around 30 seconds), so always get fresh URLs before downloading
- If a download fails with 403 Forbidden, it usually means the URL has expired - repeat the navigation step
`;

// Add a proper system prompt 
const systemPrompt = `
You are a web automation assistant that helps users automate tasks using Puppeteer.

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
   - Use the puppeteer_waitForSelector_with_polling tool for content that loads slowly
   - Always verify elements exist before interacting with them

## Error Handling
- When clicking elements, ensure they exist first
- If a selector isn't found, try using DOM traversal to find similar elements
- When filling forms, verify the input field exists before attempting to fill it
- For conditional logic, use evaluate to check for element existence

## Form Submission
For reliable form submissions, especially search forms, use multiple approaches:

1. First try the puppeteer_reliable_form_submit tool, which combines multiple submission methods:
   - It will try clicking the submit button if provided
   - Then try form.submit() if a form selector is provided
   - Then try keyboard Enter press
   - Finally fallback to JavaScript event dispatch
   - It also verifies the submission was successful

2. If that fails, try these individual approaches in sequence:
   - Clicking a dedicated submit/search button
   - Using puppeteer_keyboard_press with key: "Enter" and appropriate selector
   - Using form.submit() via evaluate
   - JavaScript event dispatch

3. Always verify search submission success by checking for results

## Special Tool: puppeteer_click_without_target
For links or buttons that would open in a new tab (using target="_blank" or JavaScript):
- Use puppeteer_click_without_target instead of regular click
- This tool modifies the element to remove target attributes and override click handlers
- It keeps navigation in the same tab, preventing "lost context" issues
- It also supports waitForNavigation for synchronization

## Handling Downloads
1. For download links with direct file URLs:
   - Extract the href and navigate directly to it
   - Use puppeteer_download_s3_file for direct downloads

2. For download links that point to Amazon S3:
   - Use puppeteer_check_tabs_for_s3 to find and automatically download the file
   - This helps with one-time use S3 URLs that expire quickly
   - Parameters include timeout, autoDownload (default true), and filename

## Amazon S3 URL Handling
- S3 URLs contain temporary authorization tokens that expire quickly (often in 30 seconds)
- Always get a fresh URL before attempting to download
- If you receive a 403 Forbidden error, it means the URL has expired - you need to navigate back and get a fresh URL
- The puppeteer_check_tabs_for_s3 tool has retry logic for expired URLs

## JavaScript Evaluation Guidelines
- Avoid using 'return' statements in puppeteer_evaluate scripts
- End evaluate scripts with the expression to evaluate
- Keep DOM manipulations simple
- Use console.log statements within evaluate for debugging
- Don't return complex objects; prefer simple values or strings

## Multi-Tab Operations
- Avoid opening new tabs when possible
- Use puppeteer_click_without_target for links that would open in new tabs
- When new tabs are necessary, use puppeteer_check_tabs_for_s3 to work across all tabs
`;

// Define Anthropic tool type
interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

// Define ToolUseBlock type
interface ToolUseBlock {
  type: "tool_use";
  name: string;
  input: Record<string, any>;
  id: string;
}

// Start the server as a subprocess
async function startServer() {
  const serverProcess = spawn("npx", ["ts-node", "server.ts"], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  return serverProcess;
}

// Connect the MCP client to the server
async function connectClient(serverProcess: any): Promise<Client> {
  const client = new Client({ name: "gusto-client", version: "1.0.0" }, {});
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["ts-node", "server.ts"]
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

// Automate the Gusto login process with LLM
async function automateWithLLM(client: Client, customUserPrompt?: string) {
  // Use the provided prompt or default
  const userPromptToUse = customUserPrompt || defaultUserPrompt;
  
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

  let messages: any[] = [{ role: "user", content: userPromptToUse }];
  const MAX_ITERATIONS = 200;
  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    console.log(`Iteration ${iteration}: Processing with LLM...`);

    const response = await anthropic.beta.messages.create({
      model: "claude-3-7-sonnet-latest",
      system: systemPrompt,
      max_tokens: 1024,
      messages,
      tools: anthropicTools,
      betas: ["token-efficient-tools-2025-02-19"]
    });

    if (response.stop_reason === "end_turn") {
      const finalText = response.content.find((c) => c.type === "text")?.text || "Task completed.";
      console.log("Task completed:", finalText);
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
    console.log("Maximum iterations reached. Task may not be complete.");
  }
}

// Add this function near the automateWithLLM function
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

// Main execution function
async function main() {
  // Start the server process
  const serverProcess = await startServer();
  
  try {
    // Connect to the server
    const client = await connectClient(serverProcess);
    
    // Use the appropriate prompt based on mode
    let userPrompt = defaultUserPrompt;
    
    // Check if we're in agent mode or interactive mode
    if (AGENT_MODE === 'execute' && AGENT_INSTRUCTIONS_PATH) {
      // Agent mode - use instructions from file
      console.log('Running in agent mode with instructions from:', AGENT_INSTRUCTIONS_PATH);
      
      try {
        // Read the instructions from the file
        const fs = require('fs');
        userPrompt = fs.readFileSync(AGENT_INSTRUCTIONS_PATH, 'utf-8');
        
        // Execute the automation with the instructions
        await automateWithLLM(client, userPrompt);
        
        // Report success
        console.log('[AGENT_RESULT]', JSON.stringify({ 
          status: 'success',
          message: 'Execution completed successfully'
        }));
        
        // Exit with success
        process.exit(0);
      } catch (error) {
        console.error('Error in agent mode:', error);
        
        // Report failure
        console.log('[AGENT_RESULT]', JSON.stringify({ 
          status: 'error',
          message: error instanceof Error ? error.message : String(error)
        }));
        
        // Exit with error
        process.exit(1);
      }
    } else {
      // Interactive mode - use normal flow
      await automateWithLLM(client, userPrompt);
    }
  } catch (error) {
    console.error('Error in main process:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});