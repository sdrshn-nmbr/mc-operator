#!/usr/bin/env node

import * as path from 'path';
import * as dotenv from 'dotenv';
import { AgentRunner } from './agent/AgentRunner';
import { stdin as input, stdout as output } from 'process';
import * as readline from 'readline';

// Load environment variables
dotenv.config();

// Create readline interface for user input
const rl = readline.createInterface({ input, output });

/**
 * Prompts the user for input
 * @param question The question to ask
 * @returns The user's response
 */
function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

/**
 * Main command-line entry point
 */
async function main() {
  console.log('====================================');
  console.log('🤖 Autonomous Web Agent CLI');
  console.log('====================================\n');
  
  try {
    // Load the configuration
    const settingsPath = path.resolve('./config/settings.json');
    const config = await AgentRunner.loadConfig(settingsPath);
    
    if (!config.apiKey) {
      console.error('Error: ANTHROPIC_API_KEY is not set in environment variables');
      process.exit(1);
    }
    
    // Create and initialize the agent
    const agent = new AgentRunner(config);
    await agent.initialize();
    
    console.log('\nAgent is ready! Enter commands or type "exit" to quit.\n');
    
    while (true) {
      const command = await askQuestion('Command > ');
      
      if (command.toLowerCase() === 'exit') {
        break;
      }
      
      if (command.trim() === '') {
        continue;
      }
      
      console.log('\nExecuting command...\n');
      
      try {
        const result = await agent.executeCommand(command);
        
        console.log('\n--- Result ---');
        console.log(`Success: ${result.success}`);
        console.log(`Task Type: ${result.taskType}`);
        console.log(`Parameters: ${JSON.stringify(result.parameters, null, 2)}`);
        
        if (result.success) {
          console.log('\nTask completed successfully!');
        } else {
          console.log('\nTask failed:');
          console.log(result.result.error || 'Unknown error');
        }
      } catch (error) {
        console.error('\nError executing command:', error);
      }
      
      console.log('\n----------------------------\n');
    }
    
    console.log('\nThank you for using the Autonomous Web Agent. Goodbye!');
    rl.close();
  } catch (error) {
    console.error('Error initializing agent:', error);
    process.exit(1);
  }
}

// Start the CLI
main(); 