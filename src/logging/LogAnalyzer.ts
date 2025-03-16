import { TaskLogEntry } from './LogManager';
import * as path from 'path';

/**
 * Result of log analysis
 */
export interface LogAnalysisResult {
  suggestions: string[];
  newPrompt?: string;
  failurePatterns?: {
    type: string;
    frequency: number;
    description: string;
  }[];
}

/**
 * Base LLM client interface for sending prompts
 */
export interface LLMClient {
  generateContent(options: {
    systemPrompt: string;
    userPrompt: string;
  }): Promise<{ text: string }>;
}

/**
 * Analyzes logs using LLM to identify patterns and suggest improvements
 */
export class LogAnalyzer {
  private llmClient: LLMClient;
  
  /**
   * Creates a new LogAnalyzer
   * @param llmClient The LLM client for analysis
   */
  constructor(llmClient: LLMClient) {
    this.llmClient = llmClient;
  }
  
  /**
   * Analyzes failed logs to identify patterns and suggest improvements
   * @param logs The logs to analyze
   * @param originalCommand The original command if available
   * @returns Analysis results with suggestions and potentially a new prompt
   */
  async analyzeLogs(
    logs: TaskLogEntry[], 
    originalCommand?: string
  ): Promise<LogAnalysisResult> {
    // Filter for failed logs
    const failedLogs = logs.filter(log => log.outcome === 'failure');
    
    if (failedLogs.length === 0) {
      return { 
        suggestions: ['No failed logs found to analyze.'] 
      };
    }
    
    // Get the most recent logs, limit to 5 to keep prompt size reasonable
    const recentFailures = failedLogs
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5);
    
    // Get the latest command's logs if available
    const commandLogs = originalCommand 
      ? logs.filter(log => log.command === originalCommand)
      : [];
    
    // Prepare a summarized version of logs to avoid token limits
    const summarizedLogs = recentFailures.map(log => ({
      command: log.command,
      outcome: log.outcome,
      executionMode: log.executionMode,
      error: log.error,
      // Summarize actions to reduce token count
      actions: log.actions.map(a => ({
        action: a.action.length > 100 ? a.action.substring(0, 100) + '...' : a.action,
        success: a.success,
        error: a.error
      }))
    }));
    
    // Create the analysis prompt
    const analysisPrompt = `
# Log Analysis Task

Analyze these ${recentFailures.length} failed task logs to identify patterns and improve automation.

## Command Context
${originalCommand ? `The current command is: "${originalCommand}"` : 'No specific command provided.'}

## Failed Logs Summary
\`\`\`json
${JSON.stringify(summarizedLogs, null, 2)}
\`\`\`

## Analysis Instructions
1. Identify patterns in failures (e.g., selector issues, timing problems, navigation errors)
2. Determine root causes where possible
3. Suggest specific improvements to automation prompts
4. If appropriate, generate a new, improved prompt that addresses the identified issues

Your response must be valid JSON with the following structure:
\`\`\`json
{
  "suggestions": ["suggestion1", "suggestion2", ...],
  "failurePatterns": [
    {
      "type": "pattern_type",
      "frequency": number_of_occurrences,
      "description": "detailed description"
    }
  ],
  "newPrompt": "complete_new_prompt_if_appropriate"
}
\`\`\`

Focus on practical improvements that will make the automation more reliable.
`;

    // Call the LLM for analysis
    const response = await this.llmClient.generateContent({
      systemPrompt: 'You are an expert in web automation and prompt engineering. Your task is to analyze failure logs and suggest improvements to make the automation more reliable. Focus on practical, specific changes that address root causes.',
      userPrompt: analysisPrompt
    });
    
    try {
      // Strip markdown code block if present
      let jsonText = response.text;
      
      // Check if the response is wrapped in markdown code blocks
      const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
      const match = jsonText.match(codeBlockRegex);
      
      if (match && match[1]) {
        // Extract the content from inside the code block
        jsonText = match[1];
      }
      
      // Parse the response as JSON
      const result: LogAnalysisResult = JSON.parse(jsonText);
      return result;
    } catch (error) {
      // If parsing fails, extract suggestions from the text response
      console.error('Error parsing LLM response as JSON:', error);
      return {
        suggestions: [
          'Error parsing LLM analysis results.',
          'Raw response: ' + response.text.substring(0, 100) + '...'
        ]
      };
    }
  }
} 