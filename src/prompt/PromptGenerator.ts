import * as fs from 'fs';
import * as path from 'path';
import { LLMClient } from '../utils/LLMClient';
import { LogAnalyzer, LogAnalysisResult } from '../logging/LogAnalyzer';
import { LogManager, TaskLogEntry } from '../logging/LogManager';
import { SettingsManager } from '../config/SettingsManager';

/**
 * Template repository for accessing prompt templates
 */
class TemplateRepository {
  private baseDir: string;
  
  /**
   * Creates a new TemplateRepository
   * @param baseDir Base directory for templates
   */
  constructor(baseDir: string = path.join(process.cwd(), 'templates')) {
    this.baseDir = baseDir;
  }
  
  /**
   * Gets the content of a template file
   * @param templatePath Path to the template, relative to the base directory
   * @returns The template content
   */
  async getTemplate(templatePath: string): Promise<string> {
    const fullPath = path.join(this.baseDir, templatePath);
    try {
      return await fs.promises.readFile(fullPath, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to load template: ${templatePath} - ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Simple template rendering engine
 */
class PromptTemplate {
  private template: string;
  private variables: Record<string, any>;
  
  /**
   * Creates a new PromptTemplate
   * @param template The template string
   * @param variables Variables to use in rendering
   */
  constructor(template: string, variables: Record<string, any> = {}) {
    this.template = template;
    this.variables = variables;
  }
  
  /**
   * Renders the template
   * @returns The rendered template
   */
  render(): string {
    let result = this.template;
    
    // Replace {{variable}} with the corresponding value
    for (const [key, value] of Object.entries(this.variables)) {
      const placeholder = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      result = result.replace(placeholder, String(value));
    }
    
    return result;
  }
}

/**
 * Results from prompt generation
 */
export interface PromptGenerationResult {
  taskType: string;
  parameters: Record<string, any>;
  instructions: string;
  templatePath: string;
  source: 'template' | 'analysis' | 'enhanced';
}

/**
 * Generates prompts for automation tasks
 */
export class PromptGenerator {
  private repository: TemplateRepository;
  private llmClient: LLMClient;
  private logManager: LogManager;
  private settingsManager: SettingsManager;
  private tasksConfig: any;
  
  /**
   * Creates a new PromptGenerator
   * @param llmClient The LLM client
   * @param logManager The log manager
   * @param settingsManager The settings manager
   * @param templateBaseDir Base directory for templates
   */
  constructor(
    llmClient: LLMClient,
    logManager: LogManager = new LogManager(),
    settingsManager: SettingsManager = new SettingsManager(),
    templateBaseDir: string = path.join(process.cwd(), 'templates')
  ) {
    this.repository = new TemplateRepository(templateBaseDir);
    this.llmClient = llmClient;
    this.logManager = logManager;
    this.settingsManager = settingsManager;
    this.tasksConfig = this.loadTasksConfig();
  }
  
  /**
   * Generates instructions for a command
   * @param command The user command
   * @param configPath Path to task configuration
   * @returns The generated instructions
   */
  async generateInstructions(command: string): Promise<PromptGenerationResult> {
    // Get the current execution mode
    const executionMode = this.settingsManager.getExecutionMode();
    console.log(`Generating instructions in ${executionMode} mode...`);
    
    // Analyze the command to determine task type and parameters
    const { taskType, parameters } = await this.analyzeCommand(command);
    console.log(`Identified task type: ${taskType}`);
    
    // Find the task configuration
    const taskConfig = this.tasksConfig.tasks.find((t: any) => t.id === taskType);
    if (!taskConfig) {
      throw new Error(`No configuration found for task type: ${taskType}`);
    }
    
    // Get the system and task template content
    const systemPromptContent = await this.repository.getTemplate('system/base.txt');
    const taskTemplateContent = await this.repository.getTemplate(taskConfig.template);
    
    // If we're in accuracy mode, try to analyze logs and improve the prompt
    if (executionMode === 'accuracy') {
      try {
        console.log('Analyzing logs for prompt improvement...');
        const enhancedInstructions = await this.getEnhancedInstructions(
          command, 
          taskType, 
          parameters,
          systemPromptContent,
          taskTemplateContent
        );
        
        if (enhancedInstructions && enhancedInstructions.newPrompt) {
          return {
            taskType,
            parameters,
            instructions: enhancedInstructions.newPrompt,
            templatePath: taskConfig.template,
            source: 'analysis'
          };
        }
      } catch (error) {
        console.error('Error during log analysis:', error);
        // Continue with normal prompt generation if analysis fails
      }
      
      // In accuracy mode with no log analysis results, generate a more robust prompt
      const accuracyPrompt = new PromptTemplate(taskTemplateContent, parameters).render() + 
        '\n\nAdditional Requirements:\n' +
        '- Add extra checks for web elements before interacting with them\n' +
        '- Use more robust selectors when possible\n' +
        '- Implement longer waits for dynamic content\n' +
        '- Add recovery strategies for potential failures';
      
      const response = await this.llmClient.generateContent({
        systemPrompt: new PromptTemplate(systemPromptContent, { command }).render(),
        userPrompt: accuracyPrompt
      });
      
      return {
        taskType,
        parameters,
        instructions: response.text,
        templatePath: taskConfig.template,
        source: 'enhanced'
      };
    } else {
      // In speed mode, use the template directly for faster execution
      const instructions = new PromptTemplate(taskTemplateContent, parameters).render();
      
      return {
        taskType,
        parameters,
        instructions,
        templatePath: taskConfig.template,
        source: 'template'
      };
    }
  }
  
  /**
   * Analyzes a command to determine the task type and parameters
   * @param command The user command
   * @returns The task type and parameters
   */
  private async analyzeCommand(command: string): Promise<{ taskType: string; parameters: Record<string, any> }> {
    // Load the command analysis template
    const analysisTemplate = await this.repository.getTemplate('system/command_analysis.txt');
    
    // Prepare the prompt for command analysis
    const prompt = `
    Analyze the following command and determine the task type and parameters:
    
    Command: ${command}
    
    Available Task Types:
    ${this.tasksConfig.tasks.map((t: any) => `- ${t.id}: ${t.description}`).join('\n')}
    
    Return a JSON object with taskType and parameters fields:
    {
      "taskType": "one_of_the_available_types",
      "parameters": {
        "param1": "value1",
        "param2": "value2"
      }
    }`;
    
    // Generate the analysis
    const response = await this.llmClient.generateContent({
      systemPrompt: analysisTemplate,
      userPrompt: prompt
    });
    
    try {
      // Extract JSON from the response
      const jsonMatch = response.text.match(/```json\s*([\s\S]*?)\s*```|(\{[\s\S]*\})/);
      const jsonContent = jsonMatch ? (jsonMatch[1] || jsonMatch[2]) : response.text;
      
      return JSON.parse(jsonContent);
    } catch (error) {
      console.error('Error parsing command analysis result:', error);
      throw new Error(`Failed to analyze command: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Gets enhanced instructions based on log analysis
   * @param command The current command
   * @param taskType The identified task type
   * @param parameters The identified parameters
   * @param systemPromptContent The system prompt content
   * @param taskTemplateContent The task template content
   * @returns Enhanced instructions if available
   */
  private async getEnhancedInstructions(
    command: string,
    taskType: string,
    parameters: Record<string, any>,
    systemPromptContent: string,
    taskTemplateContent: string
  ): Promise<LogAnalysisResult | null> {
    // Get logs from the log manager
    const logs = await this.logManager.getLogs();
    if (logs.length === 0) {
      console.log('No logs available for analysis');
      return null;
    }
    
    // Create a log analyzer
    const logAnalyzer = new LogAnalyzer(this.llmClient);
    
    // Analyze the logs with the current command for context
    const analysis = await logAnalyzer.analyzeLogs(logs, command);
    
    if (analysis.suggestions.length === 0 && !analysis.newPrompt) {
      console.log('No improvements suggested by log analysis');
      return null;
    }
    
    // If there's a new prompt, use it
    if (analysis.newPrompt) {
      console.log('Using improved prompt from log analysis');
      return analysis;
    }
    
    // If there are suggestions but no new prompt, incorporate them into the template
    if (analysis.suggestions.length > 0) {
      console.log(`Incorporating ${analysis.suggestions.length} suggestions into prompt`);
      
      // Generate an enhanced prompt with the suggestions
      const enhancedPrompt = `
      ${new PromptTemplate(taskTemplateContent, parameters).render()}
      
      Based on analysis of previous tasks, please incorporate these improvements:
      ${analysis.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}
      `;
      
      const response = await this.llmClient.generateContent({
        systemPrompt: new PromptTemplate(systemPromptContent, { command }).render(),
        userPrompt: enhancedPrompt
      });
      
      analysis.newPrompt = response.text;
      return analysis;
    }
    
    return null;
  }
  
  /**
   * Loads the tasks configuration
   * @param configPath Path to the tasks configuration file
   * @returns The tasks configuration
   */
  private loadTasksConfig(configPath: string = path.join(process.cwd(), 'config', 'tasks.json')): any {
    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(configContent);
    } catch (error) {
      console.error('Error loading tasks configuration:', error);
      
      // Return a minimal default config
      return {
        tasks: [
          {
            id: 'default',
            description: 'Default task',
            template: 'tasks/default.txt'
          }
        ]
      };
    }
  }
} 