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
async function automateWithLLM(client: Client) {
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

  const systemPrompt = `You are an AI assistant skilled in web automation using Puppeteer. Your goal is to help users navigate websites by executing precise browser interactions.

## Guidelines for Effective Web Automation:

1. **Selector Best Practices**
   - Use the most specific, reliable selectors available: IDs > names > stable attributes > text content
   - Prioritize selectors in this order: exact IDs/names > direct attribute selectors > CSS paths > complex queries
   - When selectors fail, use DOM manipulation to add IDs to elements via puppeteer_evaluate

2. **Error Handling**
   - Always verify elements exist before interacting with them
   - If a selector fails, try alternative approaches in this order:
     a) Use more general selectors
     b) Add ID attributes to elements with JavaScript
     c) Look for parent/sibling elements that are more easily identifiable

3. **JavaScript Evaluation Guidelines**
   - AVOID using 'return' statements in puppeteer_evaluate scripts
   - Instead, end your script with the expression to evaluate
   - Keep DOM manipulations simple and focused
   - For complex operations, break them into multiple smaller scripts

4. **Navigation Strategies**
   - When possible, navigate directly to URLs rather than clicking through multiple pages
   - Use waitForSelector to ensure page has loaded before interaction
   - For complex UIs, first explore the DOM structure before attempting interactions

5. **Common Pitfalls to Avoid**
   - NEVER use :contains() in selectors - it's not a valid CSS selector
   - Avoid overly complex DOM traversal in a single operation
   - Don't attempt to return complex objects from evaluate scripts - use simple strings

6. **Handling Downloads**
   - For PDFs and other downloads, prefer extracting the direct URL over clicking download buttons
   - To download files from extracted URLs:
     a) Use puppeteer_navigate to visit the direct file URL
     b) If that doesn't trigger download, create a script that uses programmatic download triggers
     c) Look for iframe, embed, or object elements that might contain the file source
   - When extracting URLs from links or iframes, always check for query parameters that might be necessary

7. **Amazon S3 URL Handling**
   - S3 URLs often contain temporary authentication tokens that expire quickly (X-Amz-Expires parameter)
   - When dealing with S3 URLs:
     a) Act quickly once you've found the URL - tokens typically expire in 30-300 seconds
     b) Use multiple download methods in sequence without long delays
     c) If a download fails due to token expiration, return to the source page to get a fresh URL
   - For S3 PDF downloads, try these approaches in order:
     1. Direct download using anchor with download attribute 
     2. Fetch API to get the blob and create an object URL
     3. Save the URL to a variable and try several download techniques
   - Use appropriate MIME types (application/pdf for PDFs) when setting up downloads

8. **Multi-Tab Operations**
   - When clicking links that open in new tabs (target="_blank"), use puppeteer_check_tabs_for_s3
   - This tool will automatically check all open tabs and find S3 URLs
   - It can also automatically download files by setting autoDownload: true
   - Parameters:
     - timeout: milliseconds to wait for tabs to load (default: 5000)
     - autoDownload: whether to download the file immediately (default: true)
     - filename: name for the downloaded file (default: "941-form.pdf")
   - The tool returns the S3 URL and download status in a single operation
   - This prevents token expiration issues that occur with two separate operations

You have access to several tools for browser automation, including navigate, click, fill, evaluate, screenshot, waitForSelector, and more. Use them strategically to accomplish the user's web automation goals.
`;

  const userPrompt = `# Gusto Login and Navigation Instructions

Please help me log in to Gusto and navigate to a specific tax form. Follow these steps exactly as written:

1. **Navigate to Login Page**
   - Go to https://app.gusto.com/login

2. **Login with Credentials**
   - Fill in the email field (input[name="email"]) with: daniel@elemetric.io
   - Fill in the password field (input[name="password"]) with: midas!1434
   - Click the submit button (button[type="submit"])

3. **Handle Two-Factor Authentication**
   - When the 2FA screen appears, look specifically for input[name="code"]
   - Ask me for the verification code
   - Enter the code I provide
   - Click the submit button with id="submit-2fa-code" or button[type="submit"]

4. **Skip Device Remembering**
   - After 2FA verification, look for a button containing "Skip for now" text
   - Use this exact script to find and ID it:
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
   - In the company selector dialog, look for and identify the Elemetric Inc link:
     elemetricLink = Array.from(document.querySelectorAll('a')).find(link => link.href && link.href.includes('elemetric-inc/payroll_admin'));
     if (elemetricLink) elemetricLink.id = 'elemetric-link';
   - Click #elemetric-link

6. **Navigate to Tax Documents**
   - Navigate directly to: https://app.gusto.com/elemetric-inc/payroll_admin/taxes-and-compliance/tax-documents

7. **Open the 941 Form and Download it Automatically**
   - Find and identify the first 941 tax form view link:
     rows = Array.from(document.querySelectorAll('tr')).filter(row => row.textContent.startsWith('941') && !row.textContent.includes('Illinois'));
     if (rows.length > 0) {
       viewLink = rows[0].querySelector('a[href*="/forms/"]');
       if (viewLink) viewLink.id = 'view-941-link-0';
     }
   - Click #view-941-link-0
   - IMPORTANT: This will open a new tab that redirects to the S3 URL
   - Use the puppeteer_check_tabs_for_s3 tool with these parameters:
     {
       timeout: 5000,
       autoDownload: true,
       filename: "941-form.pdf"
     }
   - This tool will automatically check all tabs, find the S3 URL, and download the file in one step
   - Report the result to the user

### Important Notes
- The form viewer page will automatically redirect to the S3 URL in a new tab
- The puppeteer_check_tabs_for_s3 tool handles everything including downloading
- S3 URLs have tokens that expire within 30 seconds, so the automatic download is crucial
- The file will be saved to the server's filesystem with the specified filename
`;

  let messages: any[] = [{ role: "user", content: userPrompt }];
  const MAX_ITERATIONS = 200;
  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    console.log(`Iteration ${iteration}: Processing with LLM...`);

    const response = await anthropic.messages.create({
      model: "claude-3-7-sonnet-latest",
      system: systemPrompt,
      max_tokens: 1000,
      messages,
      tools: anthropicTools,
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
  let serverProcess: any;
  let client: Client | undefined;

  try {
    console.log("Starting Puppeteer MCP server...");
    serverProcess = await startServer();
    console.log("Connecting MCP client...");
    client = await connectClient(serverProcess);
    console.log("Starting Gusto login automation...");
    await automateWithLLM(client);
  } catch (error) {
    console.error("Error during execution:", error);
  } finally {
    if (client) await client.close();
    if (serverProcess) serverProcess.kill();
    console.log("Shutdown complete.");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});