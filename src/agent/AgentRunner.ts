import * as path from 'path';
import * as fs from 'fs/promises';
import { LLMClient } from '../utils/LLMClient';
import { PromptGenerator } from '../prompts/PromptGenerator';
import { PromptRepository } from '../storage/PromptRepository';
import { AgentContext } from './AgentContext';
import { TaskExecutor } from './TaskExecutor';

/**
 * Configuration for the agent
 */
interface AgentConfig {
  settings: any;
  tasksConfig: string;
  apiKey: string;
}

/**
 * Result of running a command
 */
interface CommandResult {
  command: string;
  taskType: string;
  parameters: Record<string, string>;
  success: boolean;
  result: any;
  instructions?: string;
}

/**
 * Manages the entire agent lifecycle
 */
export class AgentRunner {
  private llmClient: LLMClient;
  private repository: PromptRepository;
  private generator: PromptGenerator;
  private executor: TaskExecutor;
  private context: AgentContext;
  
  /**
   * Creates a new AgentRunner
   * @param config Configuration for the agent
   */
  constructor(config: AgentConfig) {
    this.llmClient = new LLMClient(config.apiKey, config.settings.llm);
    
    this.repository = new PromptRepository({
      baseDir: config.settings.templates.base_dir,
      systemDir: config.settings.templates.system_dir,
      tasksDir: config.settings.templates.tasks_dir,
      generatedDir: config.settings.templates.generated_dir
    });
    
    this.generator = new PromptGenerator(
      this.llmClient,
      this.repository,
      config.tasksConfig
    );
    
    this.executor = new TaskExecutor();
    this.context = new AgentContext();
  }
  
  /**
   * Initializes the agent
   */
  async initialize(): Promise<void> {
    await this.repository.initialize();
    console.log('Agent initialized successfully');
  }
  
  /**
   * Executes a user command
   * @param command The user command to execute
   * @returns The result of the command execution
   */
  async executeCommand(command: string): Promise<CommandResult> {
    console.log(`Executing command: ${command}`);
    
    try {
      // Reset the context for a new command
      this.context = new AgentContext();
      
      // 1. Generate detailed instructions
      const tasksPath = path.resolve('./config/tasks.json');
      const { taskType, parameters, instructions } = await this.generator.generateInstructions(command, tasksPath);
      
      console.log(`Task type: ${taskType}`);
      console.log(`Parameters: ${JSON.stringify(parameters)}`);
      
      // 2. Start the task in the context
      this.context.startTask(taskType, parameters);
      
      // 3. Execute the instructions
      const result = await this.executor.execute(instructions, this.context);
      
      // 4. Complete the task in the context
      this.context.completeTask({
        status: result.success ? 'completed' : 'failed',
        result: result.result
      });
      
      // 5. Return the result
      return {
        command,
        taskType,
        parameters,
        success: result.success,
        result: result.result,
        instructions
      };
    } catch (error) {
      console.error('Error executing command:', error);
      
      // If a task was started, mark it as failed
      const currentTask = this.context.getCurrentTask();
      if (currentTask) {
        this.context.completeTask({
          status: 'failed',
          result: { error: error instanceof Error ? error.message : String(error) }
        });
      }
      
      // Return the error result
      return {
        command,
        taskType: 'unknown',
        parameters: {},
        success: false,
        result: { error: error instanceof Error ? error.message : String(error) }
      };
    }
  }
  
  /**
   * Gets the current context
   * @returns The agent context
   */
  getContext(): AgentContext {
    return this.context;
  }
  
  /**
   * Loads a configuration for the agent
   * @param configPath Path to the configuration file
   * @returns The agent configuration
   */
  static async loadConfig(configPath: string): Promise<AgentConfig> {
    try {
      const configContent = await fs.readFile(configPath, 'utf-8');
      const settings = JSON.parse(configContent);
      
      const tasksConfig = path.resolve('./config/tasks.json');
      const apiKey = process.env.ANTHROPIC_API_KEY || '';
      
      return {
        settings,
        tasksConfig,
        apiKey
      };
    } catch (error) {
      console.error(`Failed to load config from ${configPath}:`, error);
      throw error;
    }
  }
} 