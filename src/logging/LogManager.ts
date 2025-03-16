import * as fs from 'fs';
import * as path from 'path';

/**
 * Log entry structure for task execution
 */
export interface TaskLogEntry {
  id: string;
  timestamp: number;
  command: string;
  prompt: string;
  actions: Array<{
    action: string;
    success: boolean;
    timestamp: number;
    error?: string;
    details?: any;
  }>;
  outcome: 'success' | 'failure' | 'pending';
  duration?: number;
  executionMode: 'speed' | 'accuracy';
  error?: string;
}

/**
 * Manages logging for the agent system
 */
export class LogManager {
  private logDirectory: string;
  
  /**
   * Creates a new LogManager instance
   * @param logDirectory Directory to store logs
   */
  constructor(logDirectory: string = 'logs') {
    this.logDirectory = logDirectory;
    this.ensureLogDirectory();
  }
  
  /**
   * Creates a new task log entry
   * @param command The user command
   * @param prompt The generated prompt/instructions
   * @param executionMode The execution mode used
   * @returns A new log entry
   */
  createLogEntry(command: string, prompt: string, executionMode: 'speed' | 'accuracy'): TaskLogEntry {
    return {
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      command,
      prompt,
      actions: [],
      outcome: 'pending',
      executionMode
    };
  }
  
  /**
   * Adds an action to an existing log entry
   * @param logEntry The log entry to update
   * @param action The action description
   * @param success Whether the action succeeded
   * @param error Optional error message
   * @param details Optional additional details
   */
  logAction(
    logEntry: TaskLogEntry, 
    action: string, 
    success: boolean, 
    error?: string, 
    details?: any
  ): void {
    logEntry.actions.push({
      action,
      success,
      timestamp: Date.now(),
      error,
      details
    });
  }
  
  /**
   * Finalizes a log entry with outcome and saves it
   * @param logEntry The log entry to finalize
   * @param outcome The final outcome (success/failure)
   * @param error Optional error message
   */
  finalizeLog(
    logEntry: TaskLogEntry, 
    outcome: 'success' | 'failure', 
    error?: string
  ): void {
    logEntry.outcome = outcome;
    logEntry.duration = Date.now() - logEntry.timestamp;
    
    if (error) {
      logEntry.error = error;
    }
    
    this.saveLog(logEntry);
  }
  
  /**
   * Saves a log entry to disk
   * @param logEntry The log entry to save
   */
  private saveLog(logEntry: TaskLogEntry): void {
    const logPath = path.join(this.logDirectory, `${logEntry.id}.json`);
    fs.writeFileSync(logPath, JSON.stringify(logEntry, null, 2));
    console.log(`Log saved to ${logPath}`);
  }
  
  /**
   * Retrieves logs from the log directory
   * @param filter Optional filter function
   * @returns Array of log entries
   */
  async getLogs(filter?: (log: TaskLogEntry) => boolean): Promise<TaskLogEntry[]> {
    const files = await fs.promises.readdir(this.logDirectory);
    const logFiles = files.filter(file => file.endsWith('.json'));
    
    const logs = await Promise.all(
      logFiles.map(async (file) => {
        const content = await fs.promises.readFile(
          path.join(this.logDirectory, file), 
          'utf-8'
        );
        try {
          return JSON.parse(content) as TaskLogEntry;
        } catch (e) {
          console.error(`Error parsing log file ${file}:`, e);
          return null;
        }
      })
    );
    
    // Remove any null entries and apply filter if provided
    const validLogs = logs.filter(log => log !== null) as TaskLogEntry[];
    return filter ? validLogs.filter(filter) : validLogs;
  }
  
  /**
   * Ensures the log directory exists
   */
  private ensureLogDirectory(): void {
    if (!fs.existsSync(this.logDirectory)) {
      fs.mkdirSync(this.logDirectory, { recursive: true });
      console.log(`Created log directory: ${this.logDirectory}`);
    }
  }
} 