import * as fs from 'fs';
import * as path from 'path';

/**
 * Settings schema for the application
 */
export interface Settings {
  execution: {
    mode: 'speed' | 'accuracy';
    maxIterations: number;
    retryAttempts: number;
    defaultTimeout: number;
  };
  logging: {
    enabled: boolean;
    level: 'debug' | 'info' | 'warn' | 'error';
    directory: string;
  };
  llm: {
    model: string;
    temperature: number;
    maxTokens: number;
  };
}

/**
 * Default settings
 */
const DEFAULT_SETTINGS: Settings = {
  execution: {
    mode: 'speed',
    maxIterations: 200,
    retryAttempts: 3,
    defaultTimeout: 30000
  },
  logging: {
    enabled: true,
    level: 'info',
    directory: 'logs'
  },
  llm: {
    model: 'claude-sonnet-4-20250514',
    temperature: 0.5,
    maxTokens: 8192
  }
};

/**
 * Manages application settings
 */
export class SettingsManager {
  private settings: Settings;
  private settingsPath: string;
  
  /**
   * Creates a new SettingsManager
   * @param settingsPath Path to settings file
   */
  constructor(settingsPath: string = path.join(process.cwd(), 'config', 'settings.json')) {
    this.settingsPath = settingsPath;
    this.settings = this.loadSettings();
  }
  
  /**
   * Gets the current settings
   */
  getSettings(): Settings {
    return { ...this.settings };
  }
  
  /**
   * Updates settings
   * @param newSettings Partial settings to update
   */
  updateSettings(newSettings: Partial<Settings>): Settings {
    // Deep merge the settings
    this.settings = this.deepMerge(this.settings, newSettings);
    this.saveSettings();
    return { ...this.settings };
  }
  
  /**
   * Sets the execution mode
   * @param mode The mode to set
   */
  setExecutionMode(mode: 'speed' | 'accuracy'): void {
    this.settings.execution.mode = mode;
    this.saveSettings();
  }
  
  /**
   * Gets the current execution mode
   */
  getExecutionMode(): 'speed' | 'accuracy' {
    return this.settings.execution.mode;
  }
  
  /**
   * Loads settings from file
   */
  private loadSettings(): Settings {
    try {
      // Check if settings file exists
      if (fs.existsSync(this.settingsPath)) {
        const fileContent = fs.readFileSync(this.settingsPath, 'utf-8');
        const fileSettings = JSON.parse(fileContent);
        
        // Merge with defaults to ensure all fields are present
        return this.deepMerge(DEFAULT_SETTINGS, fileSettings);
      } else {
        // Create settings file with defaults if it doesn't exist
        this.ensureSettingsDirectory();
        fs.writeFileSync(
          this.settingsPath, 
          JSON.stringify(DEFAULT_SETTINGS, null, 2)
        );
        return { ...DEFAULT_SETTINGS };
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      return { ...DEFAULT_SETTINGS };
    }
  }
  
  /**
   * Saves settings to file
   */
  private saveSettings(): void {
    try {
      this.ensureSettingsDirectory();
      fs.writeFileSync(
        this.settingsPath, 
        JSON.stringify(this.settings, null, 2)
      );
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }
  
  /**
   * Ensures the settings directory exists
   */
  private ensureSettingsDirectory(): void {
    const directory = path.dirname(this.settingsPath);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
  }
  
  /**
   * Deep merges two objects
   * @param target The target object
   * @param source The source object
   */
  private deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
    const output = { ...target };
    
    if (isObject(target) && isObject(source)) {
      Object.keys(source).forEach(key => {
        const sourceValue = source[key as keyof T];
        const targetValue = target[key as keyof T];
        
        if (isObject(sourceValue)) {
          if (!(key in target)) {
            output[key as keyof T] = sourceValue as T[keyof T];
          } else if (isObject(targetValue)) {
            output[key as keyof T] = this.deepMerge(
              targetValue as Record<string, any>,
              sourceValue as Partial<Record<string, any>>
            ) as T[keyof T];
          } else {
            output[key as keyof T] = sourceValue as T[keyof T];
          }
        } else {
          output[key as keyof T] = sourceValue as T[keyof T];
        }
      });
    }
    
    return output;
  }
}

/**
 * Type guard for objects
 * @param item The item to check
 */
function isObject(item: any): item is Record<string, any> {
  return item && typeof item === 'object' && !Array.isArray(item);
} 
