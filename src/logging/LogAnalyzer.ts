import { TaskLogEntry } from './LogManager';

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
  rawOutput?: string; // Raw output from LLM for debugging
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
   * Analyzes logs to identify patterns and suggest improvements
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
    
    // Extract error patterns and key details from logs
    const errorPatterns = this.extractErrorPatterns(recentFailures);
    const stepPatterns = this.analyzeStepSequences(recentFailures);
    
    // Prepare diagnostic information for each failure
    const diagnostics = recentFailures.map(log => {
      // Extract the most critical errors and diagnostics
      const criticalErrors = this.extractCriticalErrors(log);
      
      // Find the failure points in each log
      const failurePoints = this.identifyFailurePoints(log);
      
      // Extract any additional diagnostic info
      const additionalInfo = log.additionalDetails ? 
        this.extractRelevantDiagnostics(log.additionalDetails) : {};
      
      return {
        id: log.id,
        command: log.command,
        executionMode: log.executionMode,
        error: log.error,
        criticalErrors,
        failurePoints,
        ...additionalInfo
      };
    });
    
    // Create the analysis prompt with our enhanced diagnostics
    const analysisPrompt = `
# Log Analysis Task

Analyze these ${recentFailures.length} failed web automation task logs to identify patterns and improve automation.

## Command Context
${originalCommand ? `The current command is: "${originalCommand}"` : 'No specific command provided.'}

## Extracted Error Patterns
\`\`\`json
${JSON.stringify(errorPatterns, null, 2)}
\`\`\`

## Step Pattern Analysis
\`\`\`json
${JSON.stringify(stepPatterns, null, 2)}
\`\`\`

## Detailed Diagnostics
\`\`\`json
${JSON.stringify(diagnostics, null, 2)}
\`\`\`

## Original Prompts Used
${recentFailures.map(log => `### Log ${log.id} Prompt:
\`\`\`
${log.prompt.length > 1000 ? log.prompt.substring(0, 1000) + '... (truncated)' : log.prompt}
\`\`\``).join('\n\n')}

## Analysis Instructions
1. Identify specific patterns in failures (e.g., selector issues, timing problems, navigation errors)
2. Determine root causes for the failures
3. Suggest specific improvements for automation prompts
4. Generate a new, improved prompt that addresses the identified issues

Your response must be valid JSON with the following structure:
\`\`\`json
{
  "suggestions": [
    "Be very specific with your suggestions, e.g., 'Add explicit waitForSelector before clicking elements'",
    "..."
  ],
  "failurePatterns": [
    {
      "type": "pattern_type",
      "frequency": number_of_occurrences,
      "description": "detailed description",
      "recommendedFix": "specific fix"
    }
  ],
  "newPrompt": "A complete improved prompt that fixes the issues. This should be a full replacement prompt."
}
\`\`\`

Focus on practical, actionable improvements that will make the automation more reliable.
`;

    // Call the LLM for enhanced analysis
    const response = await this.llmClient.generateContent({
      systemPrompt: 'You are an expert in web automation, prompt engineering, and error analysis. Your task is to analyze failure logs and suggest improvements to make the automation more reliable. Focus on practical, specific changes that address root causes.',
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
      
      // Add the raw output for debugging purposes
      result.rawOutput = response.text;
      
      return result;
    } catch (error) {
      // If parsing fails, extract suggestions from the text response
      console.error('Error parsing LLM response as JSON:', error);
      return {
        suggestions: [
          'Error parsing LLM analysis results.',
          'Raw response: ' + response.text.substring(0, 100) + '...'
        ],
        rawOutput: response.text
      };
    }
  }
  
  /**
   * Extract error patterns from logs
   * @param logs The logs to analyze
   * @returns Extracted error patterns
   */
  private extractErrorPatterns(logs: TaskLogEntry[]): any[] {
    const patternCounts: Record<string, number> = {};
    const errors: string[] = [];
    
    // Extract errors from each log
    logs.forEach(log => {
      // Add the main error if present
      if (log.error) {
        errors.push(log.error);
      }
      
      // Add errors from actions
      log.actions.forEach(action => {
        if (action.error) {
          errors.push(action.error);
        }
        
        // Look for errors in action details
        if (action.details && typeof action.details === 'object') {
          if (action.details.error) {
            errors.push(action.details.error);
          }
          
          // Extract errors from error messages in the details
          for (const [key, value] of Object.entries(action.details)) {
            if (
              typeof key === 'string' && 
              key.toLowerCase().includes('error') && 
              typeof value === 'string'
            ) {
              errors.push(value);
            }
          }
        }
      });
    });
    
    // Count occurrences of error patterns
    errors.forEach(error => {
      // Normalize error message to identify common patterns
      const normalized = this.normalizeErrorMessage(error);
      patternCounts[normalized] = (patternCounts[normalized] || 0) + 1;
    });
    
    // Convert to array sorted by frequency
    return Object.entries(patternCounts)
      .map(([error, count]) => ({ error, count }))
      .filter(({ count }) => count > 1) // Only include patterns that appear multiple times
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Limit to top 10 patterns
  }
  
  /**
   * Normalize error message to identify common patterns
   * @param error The error message
   * @returns Normalized error message
   */
  private normalizeErrorMessage(error: string): string {
    if (!error) return '';
    
    // Replace specific values with placeholders
    return error
      // Replace specific selectors
      .replace(/('|")(#|\.)[a-zA-Z0-9_-]+('|")/g, '"SELECTOR"')
      // Replace URLs
      .replace(/(https?:\/\/[^\s]+)/g, 'URL')
      // Replace element IDs, classes, etc.
      .replace(/(\w+)-[a-f0-9]{6,}/g, '$1-ID')
      // Replace timestamps
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, 'TIMESTAMP')
      // Trim and normalize whitespace
      .trim()
      .replace(/\s+/g, ' ');
  }
  
  /**
   * Analyze step sequences in logs
   * @param logs The logs to analyze
   * @returns Analysis of step sequences
   */
  private analyzeStepSequences(logs: TaskLogEntry[]): any {
    // Extract common action sequences that lead to failures
    const sequences: Record<string, { count: number, failureRate: number }> = {};
    const steps: Record<string, { success: number, failure: number }> = {};
    
    logs.forEach(log => {
      // Track sequences of actions (up to 3 consecutive actions)
      for (let i = 0; i < log.actions.length - 1; i++) {
        // Single steps
        const step = log.actions[i].action;
        if (!steps[step]) {
          steps[step] = { success: 0, failure: 0 };
        }
        if (log.actions[i].success) {
          steps[step].success++;
        } else {
          steps[step].failure++;
        }
        
        // Pairs of steps
        if (i < log.actions.length - 1) {
          const pair = `${log.actions[i].action} → ${log.actions[i+1].action}`;
          if (!sequences[pair]) {
            sequences[pair] = { count: 0, failureRate: 0 };
          }
          sequences[pair].count++;
          
          // Count as failure if second step failed
          if (!log.actions[i+1].success) {
            sequences[pair].failureRate++;
          }
        }
        
        // Triples of steps
        if (i < log.actions.length - 2) {
          const triple = `${log.actions[i].action} → ${log.actions[i+1].action} → ${log.actions[i+2].action}`;
          if (!sequences[triple]) {
            sequences[triple] = { count: 0, failureRate: 0 };
          }
          sequences[triple].count++;
          
          // Count as failure if third step failed
          if (!log.actions[i+2].success) {
            sequences[triple].failureRate++;
          }
        }
      }
    });
    
    // Calculate failure rates
    for (const [sequence, data] of Object.entries(sequences)) {
      if (data.count > 0) {
        data.failureRate = data.failureRate / data.count;
      }
    }
    
    // Calculate step failure rates
    const stepFailureRates = Object.entries(steps)
      .map(([step, data]) => ({
        step,
        totalExecutions: data.success + data.failure,
        failureRate: data.failure / (data.success + data.failure)
      }))
      .filter(item => item.totalExecutions >= 2) // Only include steps executed multiple times
      .sort((a, b) => b.failureRate - a.failureRate);
    
    // Find high-failure sequences
    const highFailureSequences = Object.entries(sequences)
      .map(([sequence, data]) => ({
        sequence,
        count: data.count,
        failureRate: data.failureRate
      }))
      .filter(item => item.count >= 2 && item.failureRate > 0.5) // Only sequences executed multiple times with high failure rates
      .sort((a, b) => b.failureRate - a.failureRate);
    
    return {
      highFailureSteps: stepFailureRates.slice(0, 5),
      highFailureSequences: highFailureSequences.slice(0, 5)
    };
  }
  
  /**
   * Extract critical errors from a log
   * @param log The log to analyze
   * @returns Critical errors
   */
  private extractCriticalErrors(log: TaskLogEntry): Array<{
    action: string;
    error: string;
    type: string;
    details?: any;
  }> {
    const criticalErrors: Array<{
      action: string;
      error: string;
      type: string;
      details?: any;
    }> = [];
    
    // Extract error messaging patterns that indicate critical failures
    const criticalPatterns = [
      /(?:timeout|timed out)/i,
      /(?:element not found|no element|cannot find|couldn't find)/i,
      /(?:navigation failed|failed to navigate)/i,
      /(?:selector.*invalid)/i,
      /(?:browser crashed|browser disconnected)/i
    ];
    
    // Find actions with critical errors
    log.actions.forEach(action => {
      if (!action.success && action.error) {
        // Check if this is a critical error
        for (const pattern of criticalPatterns) {
          if (pattern.test(action.error)) {
            criticalErrors.push({
              action: action.action,
              error: action.error,
              type: this.categorizeError(action.error),
              details: action.details ? this.summarizeDetails(action.details) : undefined
            });
            break;
          }
        }
      }
    });
    
    return criticalErrors;
  }
  
  /**
   * Categorize an error message
   * @param error The error message
   * @returns Error category
   */
  private categorizeError(error: string): string {
    if (!error) return 'unknown';
    
    if (/timeout|timed out|wait.*exceeded/i.test(error)) {
      return 'timeout';
    }
    
    if (/element not found|no element|cannot find|couldn't find/i.test(error)) {
      return 'element_not_found';
    }
    
    if (/navigation|failed to navigate|page crash/i.test(error)) {
      return 'navigation_error';
    }
    
    if (/selector|invalid selector|malformed selector/i.test(error)) {
      return 'selector_error';
    }
    
    if (/browser crash|browser disconnect|connection lost/i.test(error)) {
      return 'browser_error';
    }
    
    return 'unknown';
  }
  
  /**
   * Identify failure points in a log
   * @param log The log to analyze
   * @returns Failure points
   */
  private identifyFailurePoints(log: TaskLogEntry): any[] {
    // Find sequences of failed actions
    const failurePoints = [];
    
    for (let i = 0; i < log.actions.length; i++) {
      if (!log.actions[i].success) {
        // Find the first of a sequence of failures
        const startIndex = i > 0 && log.actions[i-1].success ? i : i;
        
        // Find surrounding context (successful actions before failure)
        const contextBefore = i > 0 ? 
          log.actions.slice(Math.max(0, i-2), i).map(a => ({
            action: a.action,
            success: a.success
          })) : [];
        
        // Look ahead to see if there are more failures or recoveries
        let failureLength = 1;
        for (let j = i + 1; j < log.actions.length && !log.actions[j].success; j++) {
          failureLength++;
        }
        
        // Extract this failure sequence with context
        failurePoints.push({
          index: startIndex,
          action: log.actions[i].action,
          error: log.actions[i].error,
          contextBefore,
          failureLength,
          recovers: i + failureLength < log.actions.length // Whether execution continues after this failure
        });
        
        // Skip to the end of this failure sequence
        i += failureLength - 1;
      }
    }
    
    return failurePoints;
  }
  
  /**
   * Extract relevant diagnostics from additional details
   * @param details Additional details
   * @returns Relevant diagnostics
   */
  private extractRelevantDiagnostics(details: any): any {
    // If details is not an object, return empty object
    if (!details || typeof details !== 'object') {
      return {};
    }
    
    const relevantKeys = [
      'diagnostics', 
      'executionMetrics', 
      'errorDetails', 
      'errorContext', 
      'possibleErrors'
    ];
    
    const result: Record<string, any> = {};
    
    // Extract only relevant diagnostic information
    for (const key of relevantKeys) {
      if (details[key]) {
        result[key] = details[key];
      }
    }
    
    return result;
  }
  
  /**
   * Summarize action details for display
   * @param details Action details
   * @returns Summarized details
   */
  private summarizeDetails(details: any): any {
    if (!details) return undefined;
    
    // If details is not an object, return as is
    if (typeof details !== 'object') {
      return details;
    }
    
    // Create a simplified copy with limited output size
    const simplified: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(details)) {
      // Skip very large or non-essential properties
      if (key === 'rawOutput' || key === 'rawStepOutput') {
        simplified[key] = typeof value === 'string' ? 
          'Content truncated - ' + value.length + ' chars' : 
          value;
        continue;
      }
      
      // Include everything else with reasonable limits
      if (typeof value === 'string' && value.length > 200) {
        simplified[key] = value.substring(0, 200) + '... (truncated)';
      } else {
        simplified[key] = value;
      }
    }
    
    return simplified;
  }
} 