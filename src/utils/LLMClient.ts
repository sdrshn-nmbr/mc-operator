import Anthropic from '@anthropic-ai/sdk';

/**
 * Interface for LLM configuration
 */
interface LLMConfig {
  model: string;
  max_tokens: number;
  temperature: number;
  beta_features?: string[];
}

/**
 * Interface for content generation request
 */
interface GenerateContentRequest {
  systemPrompt: string;
  userPrompt: string;
  tools?: any[];
}

/**
 * Interface for content generation response
 */
interface GenerateContentResponse {
  text: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  stop_reason?: string | null;
}

/**
 * LLMClient handles interactions with language model APIs
 */
export class LLMClient {
  private anthropic: Anthropic;
  private config: LLMConfig;
  
  /**
   * Creates a new LLMClient
   * @param apiKey API key for the LLM service
   * @param config Configuration for the LLM
   */
  constructor(apiKey: string, config: LLMConfig) {
    this.anthropic = new Anthropic({ apiKey });
    this.config = config;
  }
  
  /**
   * Generates content using the LLM
   * @param request The generation request
   * @returns The generated content
   */
  async generateContent(request: GenerateContentRequest): Promise<GenerateContentResponse> {
    try {
      const { systemPrompt, userPrompt, tools } = request;
      
      // Create the messages array
      const messages = [
        { role: 'user' as const, content: userPrompt }
      ];
      
      // Generate content with the LLM
      const response = await this.anthropic.beta.messages.create({
        model: this.config.model,
        system: systemPrompt,
        max_tokens: this.config.max_tokens,
        temperature: this.config.temperature,
        messages,
        tools: tools,
        ...(this.config.beta_features && { betas: this.config.beta_features })
      });
      
      // Extract text content from response
      const textContent = response.content.find(c => c.type === 'text');
      
      return {
        text: textContent ? textContent.text : '',
        usage: {
          input_tokens: response.usage?.input_tokens ?? 0,
          output_tokens: response.usage?.output_tokens ?? 0
        },
        stop_reason: response.stop_reason
      };
    } catch (error) {
      console.error('Error generating content with LLM:', error);
      throw new Error(`Failed to generate content: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Updates the LLM configuration
   * @param config New configuration parameters
   */
  updateConfig(config: Partial<LLMConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  /**
   * Gets the current LLM configuration
   * @returns The current configuration
   */
  getConfig(): LLMConfig {
    return { ...this.config };
  }
} 