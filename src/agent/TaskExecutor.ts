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
        { 
          mode: executionMode,
          timestamp: new Date().toISOString(),
          contextValues: context.getAllValues() 
        }
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
        AGENT_LOG_ID: logEntry.id, // Pass the log ID to the client script
      };
      
      // Execute the client.ts script
      return new Promise((resolve, reject) => {
        // Log the client process start
        this.logManager.logAction(
          logEntry,
          'client_process_started',
          true,
          undefined,
          { 
            clientScriptPath,
            tempInstructionsPath,
            env: { 
              AGENT_MODE: env.AGENT_MODE,
              AGENT_LOG_ID: env.AGENT_LOG_ID
            }
          }
        );
        
        const clientProcess = spawn('npx', ['ts-node', clientScriptPath], { 
          env,
          stdio: 'pipe'
        });
        
        let output = '';
        let rawOutput = '';
        
        clientProcess.stdout.on('data', (data) => {
          const dataStr = data.toString();
          output += dataStr;
          rawOutput += dataStr;
          
          // Parse action information from the output
          if (dataStr.includes('[AGENT_STEP]')) {
            try {
              const stepMatch = dataStr.match(/\[AGENT_STEP\] (.*)/);
              if (stepMatch && stepMatch[1]) {
                const stepData = JSON.parse(stepMatch[1]);
                result.executionDetails.steps.push(stepData);
                
                // Also log this step in our log entry with complete details
                this.logManager.logAction(
                  logEntry,
                  stepData.action,
                  stepData.success,
                  stepData.error,
                  {
                    ...stepData.result,
                    rawStepOutput: dataStr, // Include the raw output for this step
                    timestamp: new Date().toISOString()
                  }
                );
              }
            } catch (e) {
              console.error('Error parsing step data:', e);
              this.logManager.logAction(
                logEntry,
                'parse_step_data',
                false,
                e instanceof Error ? e.message : String(e),
                {
                  rawOutput: dataStr
                }
              );
            }
          } else {
            // Log regular output for better context
            this.logManager.logAction(
              logEntry,
              'agent_output',
              true,
              undefined,
              {
                output: dataStr.length > 1000 ? 
                  dataStr.substring(0, 1000) + '... (truncated)' : 
                  dataStr,
                timestamp: new Date().toISOString()
              }
            );
          }
          
          console.log(dataStr);
        });
        
        clientProcess.stderr.on('data', (data) => {
          const errorStr = data.toString();
          console.error(`Error: ${errorStr}`);
          output += errorStr;
          rawOutput += errorStr;
          
          // Log the error with more context
          this.logManager.logAction(
            logEntry,
            'client_process_error',
            false,
            errorStr,
            {
              timestamp: new Date().toISOString(),
              type: 'stderr',
              stackTrace: errorStr.includes('at ') ? errorStr : undefined
            }
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
              true,
              undefined,
              {
                tempFilePath: tempInstructionsPath,
                timestamp: new Date().toISOString()
              }
            );
          } catch (e) {
            console.error('Error cleaning up temp file:', e);
            this.logManager.logAction(
              logEntry,
              'temp_file_cleanup',
              false,
              e instanceof Error ? e.message : String(e),
              {
                tempFilePath: tempInstructionsPath,
                timestamp: new Date().toISOString()
              }
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
                true,
                undefined,
                {
                  timestamp: new Date().toISOString()
                }
              );
            } catch (killError) {
              console.error('Error terminating client process:', killError);
              this.logManager.logAction(
                logEntry,
                'client_process_termination',
                false,
                killError instanceof Error ? killError.message : String(killError),
                {
                  timestamp: new Date().toISOString()
                }
              );
            }
          }
          
          // Add the complete raw output to the log entry for future analysis
          this.logManager.logAction(
            logEntry,
            'complete_execution_output',
            true,
            undefined,
            {
              rawOutput,
              outputLength: rawOutput.length,
              timestamp: new Date().toISOString()
            }
          );
          
          if (code === 0) {
            result.success = true;
            
            // Try to parse the final result from the output
            try {
              const resultMatch = output.match(/\[AGENT_RESULT\] (.*)/);
              if (resultMatch && resultMatch[1]) {
                result.result = JSON.parse(resultMatch[1]);
                
                // Log the successful result with comprehensive details
                this.logManager.logAction(
                  logEntry,
                  'execution_result',
                  true,
                  undefined,
                  {
                    ...result.result,
                    executionSummary: {
                      totalSteps: result.executionDetails.steps.length,
                      successfulSteps: result.executionDetails.steps.filter(s => s.success).length,
                      failedSteps: result.executionDetails.steps.filter(s => !s.success).length
                    },
                    timestamp: new Date().toISOString()
                  }
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
                {
                  output,
                  timestamp: new Date().toISOString()
                }
              );
            }
            
            // Finalize the log with success and comprehensive metrics
            this.logManager.finalizeLog(
              logEntry, 
              'success', 
              undefined,
              {
                executionMetrics: {
                  totalSteps: result.executionDetails.steps.length,
                  successfulSteps: result.executionDetails.steps.filter(s => s.success).length,
                  failedSteps: result.executionDetails.steps.filter(s => !s.success).length,
                  duration: Date.now() - logEntry.timestamp,
                  outputSize: rawOutput.length
                }
              }
            );
            
            resolve(result);
          } else {
            result.success = false;
            result.result = { error: `Process exited with code ${code}`, output };
            
            // Log the failure with detailed information
            this.logManager.logAction(
              logEntry,
              'execution_result',
              false,
              `Process exited with code ${code}`,
              {
                output,
                errorCode: code,
                executionSummary: {
                  totalSteps: result.executionDetails.steps.length,
                  successfulSteps: result.executionDetails.steps.filter(s => s.success).length,
                  failedSteps: result.executionDetails.steps.filter(s => !s.success).length
                },
                timestamp: new Date().toISOString()
              }
            );
            
            // Finalize the log with failure and detailed diagnostics
            this.logManager.finalizeLog(
              logEntry, 
              'failure', 
              `Process exited with code ${code}`,
              {
                diagnostics: {
                  exitCode: code,
                  lastSuccessfulStep: result.executionDetails.steps.filter(s => s.success).pop(),
                  lastFailedStep: result.executionDetails.steps.filter(s => !s.success).pop(),
                  totalSteps: result.executionDetails.steps.length,
                  outputLength: rawOutput.length,
                  possibleErrors: this.extractPossibleErrors(rawOutput)
                }
              }
            );
            
            resolve(result);
          }
        });
        
        clientProcess.on('error', (error) => {
          // Extract error properties safely
          const errorDetails = {
            name: error.name,
            stack: error.stack,
            // Handle the code property if it exists
            errorCode: (error as any).code
          };
          
          // Log the error with comprehensive details
          this.logManager.logAction(
            logEntry,
            'client_process_launch',
            false,
            error.message,
            {
              errorName: error.name,
              errorStack: error.stack,
              timestamp: new Date().toISOString(),
              rawOutput
            }
          );
          
          // Finalize the log with failure and detailed error information
          this.logManager.finalizeLog(
            logEntry, 
            'failure', 
            error.message,
            {
              errorDetails
            }
          );
          
          reject(error);
        });
      });
    } catch (error) {
      console.error('Error executing instructions:', error);
      
      // Log the error with comprehensive details
      this.logManager.logAction(
        logEntry,
        'execute_instructions',
        false,
        error instanceof Error ? error.message : String(error),
        {
          errorType: error instanceof Error ? error.constructor.name : typeof error,
          stack: error instanceof Error ? error.stack : undefined,
          timestamp: new Date().toISOString()
        }
      );
      
      // Add to result details
      result.executionDetails.steps.push({
        action: 'execute_instructions',
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Finalize the log with failure and detailed error context
      this.logManager.finalizeLog(
        logEntry, 
        'failure', 
        error instanceof Error ? error.message : String(error),
        {
          errorContext: {
            type: error instanceof Error ? error.constructor.name : typeof error,
            stack: error instanceof Error ? error.stack : undefined,
            instruction: instructions.length > 200 ? 
              instructions.substring(0, 200) + '... (truncated)' : 
              instructions
          }
        }
      );
      
      return result;
    }
  }
  
  /**
   * Extract possible errors from raw output
   * @param output Raw output to analyze
   * @returns List of possible error messages
   */
  private extractPossibleErrors(output: string): string[] {
    const errorPatterns = [
      /Error:?\s*([^\n]+)/gi,
      /Exception:?\s*([^\n]+)/gi,
      /Failed to ([^\n]+)/gi,
      /Cannot ([^\n]+)/gi,
      /Timeout ([^\n]+)/gi
    ];
    
    const errors = [];
    
    for (const pattern of errorPatterns) {
      const matches = output.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) {
          errors.push(match[0]);
        }
      }
    }
    
    return errors.slice(0, 10); // Limit to top 10 errors
  }
} 