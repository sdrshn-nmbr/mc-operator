/**
 * Context data for a task execution
 */
interface ContextData {
  [key: string]: any;
}

/**
 * Task-specific state information
 */
interface TaskState {
  taskType: string;
  parameters: Record<string, string>;
  startTime: Date;
  endTime?: Date;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
}

/**
 * Maintains state and context between operations
 */
export class AgentContext {
  private data: ContextData;
  private taskState: TaskState | null;
  private history: TaskState[];
  
  /**
   * Creates a new AgentContext
   * @param initialData Optional initial context data
   */
  constructor(initialData: ContextData = {}) {
    this.data = { ...initialData };
    this.taskState = null;
    this.history = [];
  }
  
  /**
   * Sets a value in the context
   * @param key The key to set
   * @param value The value to set
   */
  setValue(key: string, value: any): void {
    this.data[key] = value;
  }
  
  /**
   * Gets a value from the context
   * @param key The key to get
   * @returns The value or undefined if not found
   */
  getValue(key: string): any {
    return this.data[key];
  }
  
  /**
   * Checks if a key exists in the context
   * @param key The key to check
   * @returns True if the key exists
   */
  hasValue(key: string): boolean {
    return this.data.hasOwnProperty(key);
  }
  
  /**
   * Gets all context data
   * @returns Copy of the context data
   */
  getAllData(): ContextData {
    return { ...this.data };
  }
  
  /**
   * Clears all context data
   */
  clearData(): void {
    this.data = {};
  }
  
  /**
   * Starts a new task
   * @param taskType The type of task
   * @param parameters Parameters for the task
   */
  startTask(taskType: string, parameters: Record<string, string>): void {
    // If there's a running task, complete it first
    if (this.taskState && this.taskState.status === 'running') {
      this.completeTask({ status: 'failed', result: 'Task interrupted by new task' });
    }
    
    this.taskState = {
      taskType,
      parameters,
      startTime: new Date(),
      status: 'running'
    };
  }
  
  /**
   * Completes the current task
   * @param result Result information
   */
  completeTask(result: { status: 'completed' | 'failed', result: any }): void {
    if (!this.taskState) {
      throw new Error('No task is currently running');
    }
    
    this.taskState.endTime = new Date();
    this.taskState.status = result.status;
    this.taskState.result = result.result;
    
    // Add to history
    this.history.push({ ...this.taskState });
    
    // Clear current task
    this.taskState = null;
  }
  
  /**
   * Gets the current task state
   * @returns The current task state or null if no task is running
   */
  getCurrentTask(): TaskState | null {
    return this.taskState ? { ...this.taskState } : null;
  }
  
  /**
   * Gets the task execution history
   * @returns Array of historical task states
   */
  getTaskHistory(): TaskState[] {
    return [...this.history];
  }
} 