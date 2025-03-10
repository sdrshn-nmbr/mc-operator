import * as path from 'path';
import * as dotenv from 'dotenv';
import { LLMClient } from './utils/LLMClient';
import { PromptRepository } from './storage/PromptRepository';
import { PromptGenerator } from './prompts/PromptGenerator';
import { PromptTemplate } from './prompts/PromptTemplate';
import * as fs from 'fs/promises';
import { stdin as input, stdout as output } from 'process';
import * as readline from 'readline';

// Load environment variables
dotenv.config();

// Create readline interface for user input
const rl = readline.createInterface({ input, output });

/**
 * Prompts the user for input
 * @param question The question to ask
 * @returns The user's response
 */
function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

/**
 * Main application class
 */
class PromptManagerApp {
  private llmClient!: LLMClient;
  private repository!: PromptRepository;
  private generator!: PromptGenerator;
  private settings: any;
  
  /**
   * Initializes the application
   */
  async initialize(): Promise<void> {
    // Load settings
    const settingsPath = path.resolve('./config/settings.json');
    const tasksPath = path.resolve('./config/tasks.json');
    
    try {
      const settingsContent = await fs.readFile(settingsPath, 'utf-8');
      this.settings = JSON.parse(settingsContent);
      
      // Initialize clients
      this.llmClient = new LLMClient(
        process.env.ANTHROPIC_API_KEY || '', 
        this.settings.llm
      );
      
      // Initialize repository
      this.repository = new PromptRepository({
        baseDir: this.settings.templates.base_dir,
        systemDir: this.settings.templates.system_dir,
        tasksDir: this.settings.templates.tasks_dir,
        generatedDir: this.settings.templates.generated_dir
      });
      
      await this.repository.initialize();
      
      // Initialize generator
      this.generator = new PromptGenerator(
        this.llmClient,
        this.repository,
        tasksPath
      );
      
      console.log('🚀 Prompt Manager initialized successfully!');
      
    } catch (error) {
      console.error('Failed to initialize application:', error);
      throw error;
    }
  }
  
  /**
   * Runs the application
   */
  async run(): Promise<void> {
    console.log('====================================');
    console.log('🤖 Welcome to the Web Agent Prompt Manager');
    console.log('====================================\n');
    
    while (true) {
      console.log('\n--- Available Actions ---');
      console.log('1. Generate instructions from a simple command');
      console.log('2. List available templates');
      console.log('3. View recent generated prompts');
      console.log('0. Exit');
      
      const choice = await askQuestion('\nSelect an action (0-3): ');
      
      switch (choice) {
        case '1':
          await this.generateInstructions();
          break;
        case '2':
          await this.listTemplates();
          break;
        case '3':
          await this.viewRecentPrompts();
          break;
        case '0':
          console.log('\nThank you for using the Web Agent Prompt Manager. Goodbye!');
          rl.close();
          return;
        default:
          console.log('Invalid choice. Please try again.');
      }
    }
  }
  
  /**
   * Generates instructions from a simple command
   */
  private async generateInstructions(): Promise<void> {
    const command = await askQuestion('\nEnter your command (e.g., "buy toilet paper from Amazon"): ');
    
    console.log('\nAnalyzing command and generating detailed instructions...');
    
    try {
      const tasksPath = path.resolve('./config/tasks.json');
      const result = await this.generator.generateInstructions(command, tasksPath);
      
      console.log('\n✅ Instructions generated successfully!');
      console.log(`Task Type: ${result.taskType}`);
      console.log(`Parameters: ${JSON.stringify(result.parameters, null, 2)}`);
      console.log('\n--- Generated Instructions ---\n');
      console.log(result.instructions);
      console.log('\n--- End of Instructions ---\n');
      
      const saveChoice = await askQuestion('\nWould you like to save these instructions to a file? (y/n): ');
      
      if (saveChoice.toLowerCase() === 'y') {
        const filename = await askQuestion('\nEnter filename (without extension): ');
        const filePath = path.resolve(`./templates/generated/${filename}.txt`);
        
        await fs.writeFile(filePath, result.instructions);
        console.log(`\nInstructions saved to: ${filePath}`);
      }
    } catch (error) {
      console.error('Error generating instructions:', error);
    }
  }
  
  /**
   * Lists available templates
   */
  private async listTemplates(): Promise<void> {
    console.log('\n--- Available Templates ---');
    
    try {
      console.log('\nSystem Templates:');
      const systemTemplates = await this.repository.listTemplates('system');
      systemTemplates.forEach(template => console.log(`- ${template}`));
      
      console.log('\nTask Templates:');
      const taskTemplates = await this.repository.listTemplates('tasks');
      taskTemplates.forEach(template => console.log(`- ${template}`));
      
      const viewChoice = await askQuestion('\nWould you like to view a template? (y/n): ');
      
      if (viewChoice.toLowerCase() === 'y') {
        const templateName = await askQuestion('\nEnter template name (e.g., "system/base.txt"): ');
        try {
          const templateContent = await this.repository.getTemplate(templateName);
          console.log('\n--- Template Content ---\n');
          console.log(templateContent);
          console.log('\n--- End of Template ---');
        } catch (error) {
          console.error(`Error loading template: ${error}`);
        }
      }
    } catch (error) {
      console.error('Error listing templates:', error);
    }
  }
  
  /**
   * Views recently generated prompts
   */
  private async viewRecentPrompts(): Promise<void> {
    console.log('\n--- Recent Generated Prompts ---');
    
    try {
      const recentPrompts = await this.repository.getRecentGeneratedPrompts(5);
      
      if (recentPrompts.length === 0) {
        console.log('\nNo generated prompts found.');
        return;
      }
      
      recentPrompts.forEach((prompt, index) => {
        console.log(`\n${index + 1}. ${prompt.command}`);
        console.log(`   Task: ${prompt.taskType}`);
        console.log(`   Generated: ${prompt.timestamp}`);
        console.log(`   Filename: ${prompt.filename}`);
      });
      
      const viewChoice = await askQuestion('\nWould you like to view a prompt? (1-5, or n): ');
      
      if (viewChoice.toLowerCase() !== 'n') {
        const index = parseInt(viewChoice) - 1;
        
        if (index >= 0 && index < recentPrompts.length) {
          const promptPath = path.resolve(
            this.settings.templates.generated_dir,
            recentPrompts[index].filename
          );
          
          try {
            const promptContent = await fs.readFile(promptPath, 'utf-8');
            console.log('\n--- Prompt Content ---\n');
            console.log(promptContent);
            console.log('\n--- End of Prompt ---');
          } catch (error) {
            console.error(`Error loading prompt: ${error}`);
          }
        } else {
          console.log('Invalid selection.');
        }
      }
    } catch (error) {
      console.error('Error viewing recent prompts:', error);
    }
  }
}

/**
 * Main application entry point
 */
async function main() {
  try {
    const app = new PromptManagerApp();
    await app.initialize();
    await app.run();
  } catch (error) {
    console.error('Application error:', error);
    process.exit(1);
  }
}

// Start the application
main(); 