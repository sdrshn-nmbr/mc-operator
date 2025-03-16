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
    this.defaultModel = options?.defaultModel || 'claude-3-7-sonnet-latest';
    this.defaultTemperature = options?.defaultTemperature || 0.5;
    this.defaultMaxTokens = options?.defaultMaxTokens || 4096;
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
      const response = await this.anthropic.messages.create({
        model,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature,
        max_tokens: maxTokens
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
} 