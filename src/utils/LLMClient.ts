import { Anthropic } from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Response from the LLM
 */
export interface LLMResponse {
  text: string;
  model: string;
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
  };
}

/**
 * Image content for vision requests
 */
export interface ImageContent {
  type: 'image';
  source: {
    type: 'base64' | 'url' | 'file';
    media_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
    data?: string; // base64 data
    url?: string;  // for URL type
    file_id?: string; // for Files API
  };
}

/**
 * Text content for messages
 */
export interface TextContent {
  type: 'text';
  text: string;
}

/**
 * Combined content type
 */
export type MessageContent = TextContent | ImageContent;

/**
 * Options for LLM content generation
 */
export interface GenerateContentOptions {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Options for LLM content generation with images
 */
export interface GenerateContentWithImagesOptions {
  systemPrompt?: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | MessageContent[];
  }>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Client for interacting with LLMs
 */
export class LLMClient {
  private anthropic: Anthropic;
  private defaultModel: string;
  private defaultTemperature: number;
  private defaultMaxTokens: number;
  
  /**
   * Creates a new LLM client
   * @param options Configuration options
   */
  constructor(options?: {
    apiKey?: string;
    defaultModel?: string;
    defaultTemperature?: number;
    defaultMaxTokens?: number;
  }) {
    // Use the provided API key or look for it in environment variables
    const apiKey = options?.apiKey || process.env.ANTHROPIC_API_KEY;
    
    if (!apiKey) {
      throw new Error('Anthropic API key is required. Provide it in options or set ANTHROPIC_API_KEY environment variable.');
    }
    
    this.anthropic = new Anthropic({ apiKey });
    this.defaultModel = options?.defaultModel || 'claude-sonnet-4-20250514';
    this.defaultTemperature = options?.defaultTemperature || 0.5;
    this.defaultMaxTokens = options?.defaultMaxTokens || 8192;
  }
  
  /**
   * Generates content using the LLM
   * @param options Generation options
   * @returns The LLM response
   */
  async generateContent(options: GenerateContentOptions): Promise<LLMResponse> {
    const {
      systemPrompt,
      userPrompt,
      model = this.defaultModel,
      temperature = this.defaultTemperature,
      maxTokens = this.defaultMaxTokens
    } = options;
    
    try {
      const response = await this.anthropic.beta.messages.create({
        model,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature,
        max_tokens: maxTokens,
        betas: ["token-efficient-tools-2025-02-19", "output-128k-2025-02-19"]
      });
      
      // Extract the text content from the response
      const content = response.content.filter(c => c.type === 'text');
      const text = content.length > 0 ? content[0].text : '';
      
      return {
        text,
        model: response.model,
        tokenUsage: {
          input: response.usage.input_tokens,
          output: response.usage.output_tokens,
          total: response.usage.input_tokens + response.usage.output_tokens
        }
      };
    } catch (error) {
      console.error('Error generating content from LLM:', error);
      throw error;
    }
  }

  /**
   * Generates content with image support using Claude's vision capabilities
   * @param options Generation options with images
   * @returns The LLM response
   */
  async generateContentWithImages(options: GenerateContentWithImagesOptions): Promise<LLMResponse> {
    const {
      systemPrompt,
      messages,
      model = this.defaultModel,
      temperature = this.defaultTemperature,
      maxTokens = this.defaultMaxTokens
    } = options;
    
    try {
      // Convert messages to the format expected by Anthropic API
      const formattedMessages = messages.map(msg => ({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : msg.content
      }));

      const requestParams: any = {
        model,
        messages: formattedMessages,
        temperature,
        max_tokens: maxTokens,
        betas: ["token-efficient-tools-2025-02-19", "output-128k-2025-02-19"]
      };

      if (systemPrompt) {
        requestParams.system = systemPrompt;
      }

      const response = await this.anthropic.beta.messages.create(requestParams);
      
      // Extract the text content from the response
      const content = response.content.filter(c => c.type === 'text');
      const text = content.length > 0 ? content[0].text : '';
      
      return {
        text,
        model: response.model,
        tokenUsage: {
          input: response.usage.input_tokens,
          output: response.usage.output_tokens,
          total: response.usage.input_tokens + response.usage.output_tokens
        }
      };
    } catch (error) {
      console.error('Error generating content with images from LLM:', error);
      throw error;
    }
  }

  /**
   * Analyzes a screenshot with a given question
   * @param screenshotBase64 Base64 encoded screenshot data
   * @param question Question to ask about the screenshot
   * @param context Additional context about the page
   * @returns The analysis response
   */
  async analyzeScreenshot(
    screenshotBase64: string, 
    question: string, 
    context?: {
      url?: string;
      lastAction?: string;
      taskObjective?: string;
    }
  ): Promise<LLMResponse> {
    const contextText = context ? `
    Current URL: ${context.url || 'unknown'}
    Last Action: ${context.lastAction || 'none'}
    Task Objective: ${context.taskObjective || 'not specified'}
    ` : '';

    const systemPrompt = `You are an expert at analyzing web page screenshots to help with browser automation tasks. 
    Analyze the visual state and provide actionable insights about what you can see on the page.
    Be specific about UI elements, their locations, and potential next steps.${contextText}`;

    return this.generateContentWithImages({
      systemPrompt,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: screenshotBase64
            }
          },
          {
            type: 'text',
            text: question
          }
        ]
      }]
    });
  }
} 