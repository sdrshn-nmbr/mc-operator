#!/usr/bin/env node

import * as path from 'path';
import * as readline from 'readline';
import { AgentRunner } from './agent/AgentRunner';
import { SettingsManager } from './config/SettingsManager';
import { LogManager } from './logging/LogManager';
import { LogAnalyzer } from './logging/LogAnalyzer';
import { LLMClient } from './utils/LLMClient';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Check for API key
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is required.');
  process.exit(1);
}

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Prompt for user input
function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

// Display mode information
function displayModeInfo(mode: 'speed' | 'accuracy'): void {
  console.log('\n=== Mode Information ===');
  
  if (mode === 'speed') {
    console.log('SPEED MODE:');
    console.log('- Uses pre-defined templates for faster execution');
    console.log('- Minimal runtime checks and validation');
    console.log('- Best for well-tested tasks or when speed is critical');
  } else {
    console.log('ACCURACY MODE:');
    console.log('- Analyzes previous logs to improve prompts');
    console.log('- Adds extra checks and validation steps');
    console.log('- Better error handling and recovery strategies');
    console.log('- Slower but more reliable for complex tasks');
  }
  
  console.log('========================\n');
}

// Display command help
function displayHelp(): void {
  console.log('\n=== Available Commands ===');
  console.log('/mode [speed|accuracy] - Switch execution mode');
  console.log('/logs - View summary of recent logs');
  console.log('/analyze - Analyze logs for patterns');
  console.log('/help - Display this help message');
  console.log('/exit - Exit the application');
  console.log('===========================\n');
}

// Display a summary of recent logs
async function displayLogSummary(logManager: LogManager): Promise<void> {
  console.log('\n=== Recent Logs ===');
  
  const logs = await logManager.getLogs();
  
  if (logs.length === 0) {
    console.log('No logs found.');
    return;
  }
  
  // Sort logs by timestamp (newest first)
  const sortedLogs = logs.sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);
  
  for (const log of sortedLogs) {
    const date = new Date(log.timestamp).toLocaleString();
    const duration = log.duration ? `${(log.duration / 1000).toFixed(2)}s` : 'N/A';
    const successCount = log.actions.filter(a => a.success).length;
    const failureCount = log.actions.filter(a => !a.success).length;
    
    console.log(`- ID: ${log.id.substring(0, 12)}...`);
    console.log(`  Command: ${log.command.substring(0, 50)}${log.command.length > 50 ? '...' : ''}`);
    console.log(`  Timestamp: ${date}`);
    console.log(`  Mode: ${log.executionMode}`);
    console.log(`  Outcome: ${log.outcome} (${duration})`);
    console.log(`  Actions: ${log.actions.length} (${successCount} success, ${failureCount} failure)`);
    
    if (log.error) {
      console.log(`  Error: ${log.error.substring(0, 100)}${log.error.length > 100 ? '...' : ''}`);
    }
    
    console.log('');
  }
}

// Analyze logs and display findings
async function analyzeAndDisplayLogFindings(logManager: LogManager, llmClient: LLMClient): Promise<void> {
  console.log('\n=== Analyzing Logs ===');
  
  const logs = await logManager.getLogs();
  
  if (logs.length === 0) {
    console.log('No logs available for analysis.');
    return;
  }
  
  const logAnalyzer = new LogAnalyzer(llmClient);
  const analysis = await logAnalyzer.analyzeLogs(logs);
  
  console.log('\n=== Analysis Results ===');
  
  if (analysis.suggestions.length === 0) {
    console.log('No improvement suggestions found.');
  } else {
    console.log('Improvement Suggestions:');
    analysis.suggestions.forEach((suggestion, index) => {
      console.log(`${index + 1}. ${suggestion}`);
    });
  }
  
  if (analysis.failurePatterns && analysis.failurePatterns.length > 0) {
    console.log('\nFailure Patterns:');
    analysis.failurePatterns.forEach((pattern, index) => {
      console.log(`${index + 1}. ${pattern.type} (${pattern.frequency} occurrences)`);
      console.log(`   ${pattern.description}`);
    });
  }
  
  console.log('======================\n');
}

// Main application function
async function main() {
  try {
    console.log('=== Web Automation Agent ===');
    console.log('Loading configuration...');
    
    // Load configuration
    const settingsPath = path.resolve('./config/settings.json');
    const config = await AgentRunner.loadConfig(settingsPath);
    
    // Create managers and clients
    const settingsManager = new SettingsManager(settingsPath);
    const logManager = new LogManager();
    const llmClient = new LLMClient();
    
    // Get initial mode selection
    console.log('\nSelect execution mode:');
    console.log('1. Speed Mode (faster, uses templates)');
    console.log('2. Accuracy Mode (slower, analyzes logs, more reliable)');
    
    let modeInput = await askQuestion('Enter mode (1/2): ');
    let mode: 'speed' | 'accuracy' = modeInput === '2' ? 'accuracy' : 'speed';
    
    // Update settings
    settingsManager.setExecutionMode(mode);
    
    // Ensure config has the expected structure
    if (!config.settings) {
      config.settings = {
        llm: {
          model: 'claude-sonnet-4-20250514',
          temperature: 0.5,
          maxTokens: 8192
        },
        templatePaths: {
          base: path.join(process.cwd(), 'templates'),
          tasks: path.join(process.cwd(), 'templates', 'tasks')
        },
        execution: {
          mode,
          maxIterations: 200,
          retryAttempts: 3
        }
      };
    } else {
      // Ensure execution settings exist
      if (!config.settings.execution) {
        config.settings.execution = {
          mode,
          maxIterations: 200,
          retryAttempts: 3
        };
      } else {
        config.settings.execution.mode = mode;
      }
      
      // Ensure LLM settings exist
      if (!config.settings.llm) {
        config.settings.llm = {
          model: 'claude-sonnet-4-20250514',
          temperature: 0.5,
          maxTokens: 8192
        };
      }
      
      // Ensure template paths exist
      if (!config.settings.templatePaths) {
        config.settings.templatePaths = {
          base: path.join(process.cwd(), 'templates'),
          tasks: path.join(process.cwd(), 'templates', 'tasks')
        };
      }
    }
    
    // Initialize the agent
    console.log(`\nInitializing agent in ${mode.toUpperCase()} mode...`);
    const agent = new AgentRunner(config);
    await agent.initialize();
    
    // Display mode information
    displayModeInfo(mode);
    
    // Display help
    displayHelp();
    
    // Main command loop
    let running = true;
    while (running) {
      const input = await askQuestion('\nEnter command (or /help): ');
      
      // Process commands with / prefix
      if (input.startsWith('/')) {
        const command = input.toLowerCase();
        
        if (command === '/exit') {
          running = false;
          console.log('Exiting...');
        } else if (command === '/help') {
          displayHelp();
        } else if (command.startsWith('/mode')) {
          const modeArg = command.split(' ')[1];
          if (modeArg === 'speed' || modeArg === 'accuracy') {
            mode = modeArg;
            agent.setExecutionMode(mode);
            console.log(`Switched to ${mode.toUpperCase()} mode.`);
            displayModeInfo(mode);
          } else {
            console.log('Invalid mode. Use /mode speed or /mode accuracy');
          }
        } else if (command === '/logs') {
          await displayLogSummary(logManager);
        } else if (command === '/analyze') {
          await analyzeAndDisplayLogFindings(logManager, llmClient);
        } else {
          console.log('Unknown command. Use /help to see available commands.');
        }
      } else if (input.trim() !== '') {
        // Execute a regular command
        console.log(`\nExecuting in ${mode.toUpperCase()} mode: ${input}`);
        
        const startTime = Date.now();
        const result = await agent.executeCommand(input);
        const duration = Date.now() - startTime;
        
        console.log(`\n=== Execution Result (${(duration / 1000).toFixed(2)}s) ===`);
        console.log(`Success: ${result.success}`);
        
        if (result.source) {
          console.log(`Prompt Source: ${result.source}`);
        }
        
        if (result.logId) {
          console.log(`Log ID: ${result.logId}`);
        }
        
        if (result.success) {
          console.log('Output:');
          console.log(result.output);
        } else if (result.error) {
          console.log('Error:');
          console.log(result.error);
        }
        
        console.log('=====================================');
      }
    }
    
    // Clean up
    rl.close();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run the main function
main(); 