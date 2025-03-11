import { LLMClient } from '../utils/LLMClient';
import { PromptTemplate } from './PromptTemplate';
import { PromptRepository } from '../storage/PromptRepository';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Task information extracted from a user command
 */
interface TaskInfo {
  taskType: string;
  parameters: Record<string, string>;
}

/**
 * PromptGenerator creates detailed instructions from simple user commands
 */
export class PromptGenerator {
  private llmClient: LLMClient;
  private repository: PromptRepository;
  private tasksConfig: any;
  
  /**
   * Creates a new PromptGenerator
   * @param llmClient The LLM client for generating content
   * @param repository The repository for accessing templates
   * @param tasksConfigPath Path to the tasks configuration file
   */
  constructor(
    llmClient: LLMClient, 
    repository: PromptRepository,
    tasksConfigPath: string
  ) {
    this.llmClient = llmClient;
    this.repository = repository;
    this.tasksConfig = null;
    
    // Load the tasks config asynchronously
    this.loadTasksConfig(tasksConfigPath).catch(error => {
      console.error('Failed to load tasks configuration:', error);
    });
  }
  
  /**
   * Loads the tasks configuration file
   * @param configPath Path to the tasks configuration file
   */
  private async loadTasksConfig(configPath: string): Promise<void> {
    try {
      const configContent = await fs.readFile(configPath, 'utf-8');
      this.tasksConfig = JSON.parse(configContent);
    } catch (error) {
      console.error(`Failed to load tasks config from ${configPath}:`, error);
      throw error;
    }
  }
  
  /**
   * Ensures the tasks configuration is loaded
   */
  private async ensureTasksConfig(configPath: string): Promise<void> {
    if (!this.tasksConfig) {
      await this.loadTasksConfig(configPath);
    }
  }
  
  /**
   * Analyzes a user command to determine the task type and extract parameters
   * @param command The user command
   * @returns Information about the detected task
   */
  async analyzeCommand(command: string): Promise<TaskInfo> {
    if (!this.tasksConfig) {
      throw new Error('Tasks configuration not loaded');
    }
    
    // Create a prompt for the LLM to analyze the command
    const analysisPrompt = `
      I need you to analyze this user command and determine:
      1. The most appropriate task type from this list: ${this.tasksConfig.tasks.map((t: any) => t.id).join(', ')}
      2. Extract all relevant parameters mentioned in the command
      
      Here's information about each task type:
      - shopping: For buying items from online stores. Required params: item, store
      - search: For searching information online. Required params: query
      - media: For consuming media content. Required params: content, platform
      - social: For social media interactions. Required params: action, platform
      
      For a social task like "go to Twitter and check Elon Musk's latest post", 
      you would identify:
      - task type: social
      - parameters: { action: "check latest post", platform: "twitter", username: "Elon Musk" }
      
      User command: "${command}"
      
      Respond with a valid JSON object in this exact format:
      {
        "taskType": "the task type",
        "parameters": {
          "param1": "value1",
          "param2": "value2",
          ...
        }
      }
      
      Just return the JSON object, nothing else.
    `;
    
    // Get the task analysis from the LLM
    const response = await this.llmClient.generateContent({
      systemPrompt: 'You are a helpful assistant that analyzes user commands.',
      userPrompt: analysisPrompt
    });
    
    try {
      // Parse the JSON response
      const result = JSON.parse(response.text);
      
      // Validate the task type
      if (!this.tasksConfig.tasks.some((t: any) => t.id === result.taskType)) {
        // Fall back to default task if the detected task is invalid
        result.taskType = this.tasksConfig.defaultTask || 'search';
      }
      
      // Add default parameters based on task type if they're missing
      const taskConfig = this.tasksConfig.tasks.find((t: any) => t.id === result.taskType);
      
      if (taskConfig) {
        // Ensure all required parameters have at least a default value
        for (const param of taskConfig.requiredParams || []) {
          if (!result.parameters[param]) {
            // Set default values based on task type and parameter
            if (result.taskType === 'search' && param === 'query') {
              result.parameters.query = command; // Use full command as query for search
            } else if (result.taskType === 'social') {
              // Default social media parameters
              if (param === 'action' && !result.parameters.action) {
                if (command.toLowerCase().includes('search')) {
                  result.parameters.action = command.toLowerCase().includes('summarize') ? 
                    'search and summarize' : 'search';
                } else {
                  result.parameters.action = command.toLowerCase().includes('summarize') ? 
                    'summarize' : 'view';
                }
              }
              if (param === 'platform' && !result.parameters.platform) {
                // Check for platform mentions
                const platforms = ['twitter', 'x.com', 'x', 'facebook', 'instagram', 'linkedin'];
                for (const platform of platforms) {
                  if (command.toLowerCase().includes(platform)) {
                    result.parameters.platform = platform === 'x' || platform === 'x.com' ? 
                      'x.com' : platform;
                    break;
                  }
                }
                if (!result.parameters.platform) {
                  result.parameters.platform = 'x.com'; // Default to X (Twitter)
                }
              }
              
              // Extract search query if it's a search task
              if (command.toLowerCase().includes('search')) {
                const queryRegex = /search\s+(?:for|about)?\s*["']([^"']+)["']|search\s+(?:for|about)?\s+([^\s.]+(?:\s+[^\s.]+)*)/i;
                const match = command.match(queryRegex);
                if (match) {
                  result.parameters.query = match[1] || match[2];
                }
              }
              
              // Only extract username if it's specifically mentioned or needed
              if (!result.parameters.username && command.includes('@')) {
                const usernameMatch = command.match(/@([a-zA-Z0-9_]+)/);
                if (usernameMatch) {
                  result.parameters.username = usernameMatch[1];
                }
              }
              
              // Look for specific usernames mentioned, but only if this seems to be a profile-related task
              if (!result.parameters.username && !command.toLowerCase().includes('search') && 
                  (command.toLowerCase().includes('profile') || 
                   command.toLowerCase().includes('tweet') || 
                   command.toLowerCase().includes('post'))) {
                const commonNames = ['Elon Musk', 'elonmusk', 'karpathy', 'Andrej Karpathy'];
                for (const name of commonNames) {
                  if (command.toLowerCase().includes(name.toLowerCase())) {
                    result.parameters.username = name;
                    break;
                  }
                }
              }
            }
          }
        }
      }
      
      return result;
    } catch (error) {
      console.error('Failed to parse task analysis result:', error);
      
      // Return a default task if parsing fails
      return {
        taskType: this.tasksConfig.defaultTask || 'search',
        parameters: { query: command }
      };
    }
  }
  
  /**
   * Generates detailed instructions for a task based on a simple command
   * @param command The user command
   * @param configPath Path to the tasks configuration file
   * @returns The detailed instructions
   */
  async generateInstructions(command: string, configPath: string): Promise<{
    taskType: string;
    parameters: Record<string, string>;
    instructions: string;
    templatePath: string;
  }> {
    // Make sure tasks config is loaded
    await this.ensureTasksConfig(configPath);
    
    // Analyze the command to determine task type and parameters
    const { taskType, parameters } = await this.analyzeCommand(command);
    
    // Find the task configuration
    const taskConfig = this.tasksConfig.tasks.find((t: any) => t.id === taskType);
    
    if (!taskConfig) {
      throw new Error(`Unknown task type: ${taskType}`);
    }
    
    // Load the system prompt template
    const systemPromptContent = await this.repository.getTemplate('system/base.txt');
    const systemPrompt = new PromptTemplate(systemPromptContent, {
      command
    });
    
    // Load the task-specific template
    const templatePath = taskConfig.template;
    const taskTemplateContent = await this.repository.getTemplate(templatePath);
    const taskTemplate = new PromptTemplate(taskTemplateContent, parameters);
    
    // Check for missing required parameters
    const missingParams = (taskConfig.requiredParams || []).filter(
      (param: string) => !parameters[param]
    );
    
    if (missingParams.length > 0) {
      throw new Error(`Missing required parameters for ${taskType}: ${missingParams.join(', ')}`);
    }
    
    // Generate detailed instructions with the LLM
    const response = await this.llmClient.generateContent({
      systemPrompt: systemPrompt.render(),
      userPrompt: taskTemplate.render()
    });
    
    // Store the generated instructions
    const savedPath = await this.repository.saveGeneratedPrompt(
      command,
      taskType,
      response.text
    );
    
    console.log(`Generated instructions saved to: ${savedPath}`);
    
    return {
      taskType,
      parameters,
      instructions: response.text,
      templatePath
    };
  }
} 