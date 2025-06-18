import * as fs from 'fs';
import * as path from 'path';
import { AgentContext } from './AgentContext';
import { TaskExecutor } from './TaskExecutor';
import { PromptGenerator } from '../prompt/PromptGenerator';
import { LLMClient } from '../utils/LLMClient';
import { SettingsManager } from '../config/SettingsManager';
import { LogManager } from '../logging/LogManager';

/**
 * Configuration for the agent
 */
interface AgentConfig {
  settings: {
    llm: {
      apiKey?: string;
      model: string;
      temperature: number;
      maxTokens: number;
    };
    templatePaths: {
      base: string;
      tasks: string;
    };
    execution: {
      mode: 'speed' | 'accuracy';
      maxIterations: number;
      retryAttempts: number;
    };
  };
}

/**
 * Result of executing a command
 */
interface CommandResult {
  success: boolean;
  output: any;
  logId?: string;
  error?: string;
  source?: 'template' | 'analysis' | 'enhanced';
}

/**
 * Runs the agent to execute commands
 */
export class AgentRunner {
  private config: AgentConfig;
  private llmClient: LLMClient;
  private promptGenerator: PromptGenerator;
  private taskExecutor: TaskExecutor;
  private context: AgentContext;
  private settingsManager: SettingsManager;
  private logManager: LogManager;
  
  /**
   * Creates a new AgentRunner
   * @param config Configuration for the agent
   */
  constructor(config: AgentConfig) {
    this.config = config;
    this.context = new AgentContext();
    this.settingsManager = new SettingsManager();
    this.logManager = new LogManager();
    
    // Ensure config has the expected structure
    if (!config.settings) {
      config.settings = {} as any;
    }
    
    if (!config.settings.execution) {
      config.settings.execution = {
        mode: 'speed',
        maxIterations: 200,
        retryAttempts: 3
      };
    }
    
    if (!config.settings.llm) {
      config.settings.llm = {
        model: 'claude-sonnet-4-20250514',
        temperature: 0.5,
        maxTokens: 8192
      };
    }
    
    if (!config.settings.templatePaths) {
      config.settings.templatePaths = {
        base: path.join(process.cwd(), 'templates'),
        tasks: path.join(process.cwd(), 'templates', 'tasks')
      };
    }
    
    // Initialize execution mode from config
    if (config.settings.execution.mode) {
      this.settingsManager.setExecutionMode(config.settings.execution.mode);
    }
    
    // Create the LLM client
    this.llmClient = new LLMClient({
      apiKey: config.settings.llm.apiKey,
      defaultModel: config.settings.llm.model,
      defaultTemperature: config.settings.llm.temperature,
      defaultMaxTokens: config.settings.llm.maxTokens
    });
    
    // Create the prompt generator
    this.promptGenerator = new PromptGenerator(
      this.llmClient,
      this.logManager,
      this.settingsManager,
      config.settings.templatePaths.base
    );
    
    // Create the task executor
    this.taskExecutor = new TaskExecutor(
      this.logManager,
      this.settingsManager
    );
  }
  
  /**
   * Initializes the agent
   */
  async initialize(): Promise<void> {
    console.log('Initializing agent...');
    
    // Verify templates directory
    this.ensureTemplatesDirectory();
    
    // Verify logs directory
    this.ensureLogsDirectory();
    
    // Log the execution mode
    const mode = this.settingsManager.getExecutionMode();
    console.log(`Agent initialized in ${mode} mode`);
  }
  
  /**
   * Executes a command
   * @param command The command to execute
   * @returns The command result
   */
  async executeCommand(command: string): Promise<CommandResult> {
    console.log(`Executing command: ${command}`);
    
    // Store the command in context
    this.context.setValue('command', command);
    
    try {
      // Generate instructions for the command
      console.log('Generating instructions...');
      const { instructions, source } = await this.promptGenerator.generateInstructions(command);
      
      // Execute the instructions
      console.log('Executing instructions...');
      const result = await this.taskExecutor.execute(instructions, this.context);
      
      return {
        success: result.success,
        output: result.result,
        logId: result.logId,
        source
      };
    } catch (error) {
      console.error('Error executing command:', error);
      return {
        success: false,
        output: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Sets the execution mode
   * @param mode The execution mode
   */
  setExecutionMode(mode: 'speed' | 'accuracy'): void {
    this.settingsManager.setExecutionMode(mode);
    console.log(`Set execution mode to: ${mode}`);
  }
  
  /**
   * Gets the current execution mode
   * @returns The current execution mode
   */
  getExecutionMode(): 'speed' | 'accuracy' {
    return this.settingsManager.getExecutionMode();
  }
  
  /**
   * Loads the agent configuration from a file
   * @param configPath Path to the configuration file
   * @returns The agent configuration
   */
  static async loadConfig(configPath: string): Promise<AgentConfig> {
    try {
      // Check if the config file exists
      if (!fs.existsSync(configPath)) {
        return {
          settings: {
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
              mode: 'speed',
              maxIterations: 200,
              retryAttempts: 3
            }
          }
        };
      }
      
      // Load the config from the file
      const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
      
      return config;
    } catch (error) {
      console.error('Error loading agent configuration:', error);
      throw error;
    }
  }
  
  /**
   * Ensures the templates directory exists
   */
  private ensureTemplatesDirectory(): void {
    const templatesDir = this.config.settings.templatePaths.base;
    
    if (!fs.existsSync(templatesDir)) {
      fs.mkdirSync(templatesDir, { recursive: true });
      console.log(`Created templates directory: ${templatesDir}`);
    }
    
    const tasksDir = this.config.settings.templatePaths.tasks;
    
    if (!fs.existsSync(tasksDir)) {
      fs.mkdirSync(tasksDir, { recursive: true });
      console.log(`Created tasks templates directory: ${tasksDir}`);
    }
  }
  
  /**
   * Ensures the logs directory exists
   */
  private ensureLogsDirectory(): void {
    const logsDir = path.join(process.cwd(), 'logs');
    
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
      console.log(`Created logs directory: ${logsDir}`);
    }
  }
} 