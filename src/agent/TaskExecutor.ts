import * as path from 'path';
import { spawn } from 'child_process';
import { AgentContext } from './AgentContext';
import { LogManager, TaskLogEntry } from '../logging/LogManager';
import { SettingsManager } from '../config/SettingsManager';

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
  logId?: string; // ID of the log entry for this execution
}

/**
 * Executes automation tasks using Puppeteer
 */
export class TaskExecutor {
  private logManager: LogManager;
  private settingsManager: SettingsManager;
  
  /**
   * Creates a new TaskExecutor
   * @param logManager The log manager
   * @param settingsManager The settings manager
   */
  constructor(
    logManager: LogManager = new LogManager(),
    settingsManager: SettingsManager = new SettingsManager()
  ) {
    this.logManager = logManager;
    this.settingsManager = settingsManager;
  }
  
  /**
   * Executes detailed instructions for a task
   * @param instructions The detailed instructions to execute
   * @param context The agent context with state information
   * @returns The execution result
   */
  async execute(instructions: string, context: AgentContext): Promise<ExecutionResult> {
    console.log('Executing instructions with Puppeteer...');
    
    // Get the current execution mode
    const executionMode = this.settingsManager.getExecutionMode();
    console.log(`Execution mode: ${executionMode}`);
    
    // Create an empty result object
    const result: ExecutionResult = {
      success: false,
      result: null,
      executionDetails: {
        steps: []
      }
    };
    
    // Create a log entry for this execution
    const command = context.getValue('command') as string || 'Unknown command';
    const logEntry = this.logManager.createLogEntry(
      command,
      instructions,
      executionMode
    );
    
    // Store the log ID in the result
    result.logId = logEntry.id;
    
    try {
      // Log the start of execution
      this.logManager.logAction(
        logEntry,
        'execution_started',
        true,
        undefined,
        { mode: executionMode }
      );
      
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
        // Log the client process start
        this.logManager.logAction(
          logEntry,
          'client_process_started',
          true,
          undefined,
          { clientScriptPath }
        );
        
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
                
                // Also log this step in our log entry
                this.logManager.logAction(
                  logEntry,
                  stepData.action,
                  stepData.success,
                  stepData.error,
                  stepData.result
                );
              }
            } catch (e) {
              console.error('Error parsing step data:', e);
              this.logManager.logAction(
                logEntry,
                'parse_step_data',
                false,
                e instanceof Error ? e.message : String(e)
              );
            }
          }
          
          console.log(dataStr);
        });
        
        clientProcess.stderr.on('data', (data) => {
          const errorStr = data.toString();
          console.error(`Error: ${errorStr}`);
          output += errorStr;
          
          // Log the error
          this.logManager.logAction(
            logEntry,
            'client_process_error',
            false,
            errorStr
          );
        });
        
        clientProcess.on('close', (code) => {
          try {
            // Clean up temporary files
            fs.unlinkSync(tempInstructionsPath);
            
            // Log cleanup
            this.logManager.logAction(
              logEntry,
              'temp_file_cleanup',
              true
            );
          } catch (e) {
            console.error('Error cleaning up temp file:', e);
            this.logManager.logAction(
              logEntry,
              'temp_file_cleanup',
              false,
              e instanceof Error ? e.message : String(e)
            );
          }
          
          // Ensure the process is terminated if in agent mode
          // In interactive mode, the process will already be terminated at this point
          // But we don't want to force termination of any lingering Chrome instances
          if (env.AGENT_MODE === 'execute' && clientProcess && !clientProcess.killed) {
            try {
              clientProcess.kill();
              console.log('Client process terminated in agent mode');
              this.logManager.logAction(
                logEntry,
                'client_process_terminated',
                true
              );
            } catch (killError) {
              console.error('Error terminating client process:', killError);
              this.logManager.logAction(
                logEntry,
                'client_process_termination',
                false,
                killError instanceof Error ? killError.message : String(killError)
              );
            }
          }
          
          if (code === 0) {
            result.success = true;
            
            // Try to parse the final result from the output
            try {
              const resultMatch = output.match(/\[AGENT_RESULT\] (.*)/);
              if (resultMatch && resultMatch[1]) {
                result.result = JSON.parse(resultMatch[1]);
                
                // Log the successful result
                this.logManager.logAction(
                  logEntry,
                  'execution_result',
                  true,
                  undefined,
                  result.result
                );
              }
            } catch (e) {
              console.error('Error parsing result data:', e);
              result.result = { output };
              
              this.logManager.logAction(
                logEntry,
                'parse_result_data',
                false,
                e instanceof Error ? e.message : String(e),
                { output }
              );
            }
            
            // Finalize the log with success
            this.logManager.finalizeLog(logEntry, 'success');
            
            resolve(result);
          } else {
            result.success = false;
            result.result = { error: `Process exited with code ${code}`, output };
            
            // Log the failure
            this.logManager.logAction(
              logEntry,
              'execution_result',
              false,
              `Process exited with code ${code}`,
              { output }
            );
            
            // Finalize the log with failure
            this.logManager.finalizeLog(
              logEntry, 
              'failure', 
              `Process exited with code ${code}`
            );
            
            resolve(result);
          }
        });
        
        clientProcess.on('error', (error) => {
          // Log the error
          this.logManager.logAction(
            logEntry,
            'client_process_launch',
            false,
            error.message
          );
          
          // Finalize the log with failure
          this.logManager.finalizeLog(logEntry, 'failure', error.message);
          
          reject(error);
        });
      });
    } catch (error) {
      console.error('Error executing instructions:', error);
      
      // Log the error
      this.logManager.logAction(
        logEntry,
        'execute_instructions',
        false,
        error instanceof Error ? error.message : String(error)
      );
      
      // Add to result details
      result.executionDetails.steps.push({
        action: 'execute_instructions',
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Finalize the log with failure
      this.logManager.finalizeLog(
        logEntry, 
        'failure', 
        error instanceof Error ? error.message : String(error)
      );
      
      return result;
    }
  }
} 