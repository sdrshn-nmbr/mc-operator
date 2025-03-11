import * as path from 'path';
import { spawn } from 'child_process';
import { AgentContext } from './AgentContext';

/**
 * Result of executing a task
 */
interface ExecutionResult {
  success: boolean;
  result: any;
  executionDetails: {
    steps: Array<{
      action: string;
      success: boolean;
      result?: any;
      error?: string;
    }>;
  };
}

/**
 * Executes automation tasks using Puppeteer
 */
export class TaskExecutor {
  /**
   * Executes detailed instructions for a task
   * @param instructions The detailed instructions to execute
   * @param context The agent context with state information
   * @returns The execution result
   */
  async execute(instructions: string, context: AgentContext): Promise<ExecutionResult> {
    console.log('Executing instructions with Puppeteer...');
    
    // Create an empty result object
    const result: ExecutionResult = {
      success: false,
      result: null,
      executionDetails: {
        steps: []
      }
    };
    
    try {
      // Pass the instructions to the client.ts script
      // This is where we integrate with our existing Puppeteer implementation
      const clientScriptPath = path.resolve(process.cwd(), 'client.ts');
      
      // Create a temporary file to store the instructions
      const tempInstructionsPath = path.resolve(process.cwd(), 'temp_instructions.txt');
      const fs = require('fs');
      await fs.promises.writeFile(tempInstructionsPath, instructions);
      
      // Pass the instructions to the client script via environment variable
      const env = {
        ...process.env,
        AGENT_INSTRUCTIONS_PATH: tempInstructionsPath,
        AGENT_MODE: 'execute', // Tell client.ts to run in execution mode
      };
      
      // Execute the client.ts script
      return new Promise((resolve, reject) => {
        const clientProcess = spawn('npx', ['ts-node', clientScriptPath], { 
          env,
          stdio: 'pipe'
        });
        
        let output = '';
        
        clientProcess.stdout.on('data', (data) => {
          const dataStr = data.toString();
          output += dataStr;
          
          // Parse action information from the output
          if (dataStr.includes('[AGENT_STEP]')) {
            try {
              const stepMatch = dataStr.match(/\[AGENT_STEP\] (.*)/);
              if (stepMatch && stepMatch[1]) {
                const stepData = JSON.parse(stepMatch[1]);
                result.executionDetails.steps.push(stepData);
              }
            } catch (e) {
              console.error('Error parsing step data:', e);
            }
          }
          
          console.log(dataStr);
        });
        
        clientProcess.stderr.on('data', (data) => {
          console.error(`Error: ${data}`);
          output += data.toString();
        });
        
        clientProcess.on('close', (code) => {
          try {
            // Clean up temporary files
            fs.unlinkSync(tempInstructionsPath);
          } catch (e) {
            console.error('Error cleaning up temp file:', e);
          }
          
          // Ensure the process is terminated if in agent mode
          // In interactive mode, the process will already be terminated at this point
          // But we don't want to force termination of any lingering Chrome instances
          if (env.AGENT_MODE === 'execute' && clientProcess && !clientProcess.killed) {
            try {
              clientProcess.kill();
              console.log('Client process terminated in agent mode');
            } catch (killError) {
              console.error('Error terminating client process:', killError);
            }
          }
          
          if (code === 0) {
            result.success = true;
            
            // Try to parse the final result from the output
            try {
              const resultMatch = output.match(/\[AGENT_RESULT\] (.*)/);
              if (resultMatch && resultMatch[1]) {
                result.result = JSON.parse(resultMatch[1]);
              }
            } catch (e) {
              console.error('Error parsing result data:', e);
              result.result = { output };
            }
            
            resolve(result);
          } else {
            result.success = false;
            result.result = { error: `Process exited with code ${code}`, output };
            resolve(result);
          }
        });
        
        clientProcess.on('error', (error) => {
          reject(error);
        });
      });
    } catch (error) {
      console.error('Error executing instructions:', error);
      result.executionDetails.steps.push({
        action: 'execute_instructions',
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
      return result;
    }
  }
} 