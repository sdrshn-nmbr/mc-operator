import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * PromptRepository handles loading, saving, and managing prompt templates
 */
export class PromptRepository {
  private baseDir: string;
  private systemDir: string;
  private tasksDir: string;
  private generatedDir: string;

  /**
   * Creates a new PromptRepository
   * @param config Configuration for template directories
   */
  constructor(config: {
    baseDir: string;
    systemDir: string;
    tasksDir: string;
    generatedDir: string;
  }) {
    this.baseDir = config.baseDir;
    this.systemDir = config.systemDir;
    this.tasksDir = config.tasksDir;
    this.generatedDir = config.generatedDir;
  }

  /**
   * Ensures all required directories exist
   */
  async initialize(): Promise<void> {
    // Create directories if they don't exist
    for (const dir of [this.baseDir, this.systemDir, this.tasksDir, this.generatedDir]) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error) {
        console.error(`Error creating directory ${dir}:`, error);
      }
    }
  }

  /**
   * Gets a template by name
   * @param templateName Name of the template (relative to base directory)
   * @returns The template content as a string
   */
  async getTemplate(templateName: string): Promise<string> {
    const templatePath = path.join(this.baseDir, templateName);
    
    try {
      return await fs.readFile(templatePath, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to load template ${templateName}: ${error}`);
    }
  }

  /**
   * Saves a generated prompt for future reference
   * @param command The original user command
   * @param taskType The type of task
   * @param generatedPrompt The LLM-generated detailed prompt
   * @returns The path to the saved file
   */
  async saveGeneratedPrompt(
    command: string, 
    taskType: string, 
    generatedPrompt: string
  ): Promise<string> {
    // Create a safe filename from the command
    const safeCommand = command
      .replace(/[^a-zA-Z0-9]/g, '_')
      .toLowerCase()
      .substring(0, 30);
    
    // Add timestamp for uniqueness
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${taskType}_${safeCommand}_${timestamp}.txt`;
    const filePath = path.join(this.generatedDir, filename);
    
    // Add metadata header to the content
    const contentWithMetadata = [
      `# Generated Prompt`,
      `# Original Command: ${command}`,
      `# Task Type: ${taskType}`,
      `# Generated: ${new Date().toISOString()}`,
      `# ===================================`,
      '',
      generatedPrompt
    ].join('\n');
    
    try {
      await fs.writeFile(filePath, contentWithMetadata);
      return filePath;
    } catch (error) {
      console.error(`Failed to save generated prompt: ${error}`);
      throw new Error(`Failed to save generated prompt: ${error}`);
    }
  }

  /**
   * Lists all available templates in a specific category
   * @param category Optional directory path to list templates from
   * @returns Array of template names
   */
  async listTemplates(category?: string): Promise<string[]> {
    const dirPath = category 
      ? path.join(this.baseDir, category) 
      : this.baseDir;
    
    try {
      const files = await fs.readdir(dirPath, { withFileTypes: true });
      
      // Filter for txt files
      return files
        .filter(file => file.isFile() && file.name.endsWith('.txt'))
        .map(file => path.join(
          category ? category : '', 
          file.name
        ));
        
    } catch (error) {
      console.error(`Failed to list templates: ${error}`);
      return [];
    }
  }

  /**
   * Gets a list of recently generated prompts
   * @param limit Maximum number of prompts to return
   * @returns Array of prompt metadata objects
   */
  async getRecentGeneratedPrompts(limit = 10): Promise<Array<{
    filename: string;
    command: string;
    taskType: string;
    timestamp: string;
  }>> {
    try {
      const files = await fs.readdir(this.generatedDir);
      
      // Process files to extract metadata
      const prompts = await Promise.all(
        files
          .filter(file => file.endsWith('.txt'))
          .map(async (filename) => {
            const filePath = path.join(this.generatedDir, filename);
            const stats = await fs.stat(filePath);
            const content = await fs.readFile(filePath, 'utf-8');
            
            // Extract metadata from the file content
            const commandMatch = content.match(/# Original Command: (.+)/);
            const taskTypeMatch = content.match(/# Task Type: (.+)/);
            const timestampMatch = content.match(/# Generated: (.+)/);
            
            return {
              filename,
              command: commandMatch ? commandMatch[1] : 'Unknown',
              taskType: taskTypeMatch ? taskTypeMatch[1] : 'Unknown',
              timestamp: timestampMatch ? timestampMatch[1] : stats.mtime.toISOString()
            };
          })
      );
      
      // Sort by most recent first and limit
      return prompts
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit);
        
    } catch (error) {
      console.error(`Failed to get recent generated prompts: ${error}`);
      return [];
    }
  }
} 