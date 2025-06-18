import { LLMClient, LLMResponse } from '../utils/LLMClient';

/**
 * Result of visual analysis
 */
export interface VisualAnalysis {
  pageState: string;
  identifiedElements: ElementInfo[];
  suggestedActions: string[];
  errors: string[];
  confidence: number;
  rawAnalysis: string;
}

/**
 * Information about UI elements
 */
export interface ElementInfo {
  type: 'button' | 'link' | 'form' | 'input' | 'navigation' | 'content' | 'error' | 'other';
  description: string;
  location: string;
  selector?: string;
  isClickable: boolean;
  isVisible: boolean;
}

/**
 * Result of comparing two states
 */
export interface StateComparison {
  hasChanged: boolean;
  changes: string[];
  actionSuccessful: boolean;
  nextSteps: string[];
  confidence: number;
}

/**
 * Context for visual analysis
 */
export interface AnalysisContext {
  currentUrl: string;
  lastAction?: string;
  taskObjective: string;
  expectedOutcome?: string;
  previousState?: string;
}

/**
 * Analyzes visual state of web pages for automation
 */
export class VisualStateAnalyzer {
  private llmClient: LLMClient;
  
  constructor(llmClient?: LLMClient) {
    this.llmClient = llmClient || new LLMClient();
  }

  /**
   * Analyzes the current visual state of a page
   */
  async analyzeCurrentState(
    screenshot: string, 
    context: AnalysisContext
  ): Promise<VisualAnalysis> {
    const systemPrompt = `You are an expert web automation analyst. Analyze the screenshot and provide detailed insights about the page state, interactive elements, and next steps.

    Always respond in JSON format with this structure:
    {
      "pageState": "Brief description of current page state",
      "identifiedElements": [
        {
          "type": "button|link|form|input|navigation|content|error|other",
          "description": "What this element is",
          "location": "Where on the page it appears",
          "selector": "Suggested CSS selector if possible",
          "isClickable": true/false,
          "isVisible": true/false
        }
      ],
      "suggestedActions": ["List of suggested next steps"],
      "errors": ["Any error messages or issues spotted"],
      "confidence": 0.9,
      "rawAnalysis": "Detailed analysis of what you see"
    }`;

    const userPrompt = `Analyze this screenshot in the context of browser automation:

    Current URL: ${context.currentUrl}
    Last Action: ${context.lastAction || 'none'}
    Task Objective: ${context.taskObjective}
    Expected Outcome: ${context.expectedOutcome || 'not specified'}

    Please provide a comprehensive analysis focusing on:
    1. Current page state and what's visible
    2. Interactive elements (buttons, forms, links)
    3. Any error messages or notifications
    4. Suggested next actions to achieve the objective
    5. CSS selectors for key elements when possible`;

    try {
      const response = await this.llmClient.analyzeScreenshot(
        screenshot,
        userPrompt,
        {
          url: context.currentUrl,
          lastAction: context.lastAction,
          taskObjective: context.taskObjective
        }
      );

      // Try to parse as JSON, fallback to text analysis
      try {
        const jsonMatch = response.text.match(/```json\s*([\s\S]*?)\s*```|(\{[\s\S]*\})/);
        const jsonContent = jsonMatch ? (jsonMatch[1] || jsonMatch[2]) : response.text;
        const parsed = JSON.parse(jsonContent);
        
        return {
          pageState: parsed.pageState || 'Unknown state',
          identifiedElements: parsed.identifiedElements || [],
          suggestedActions: parsed.suggestedActions || [],
          errors: parsed.errors || [],
          confidence: parsed.confidence || 0.5,
          rawAnalysis: parsed.rawAnalysis || response.text
        };
      } catch (parseError) {
        // Fallback to text-based analysis
        return this.parseTextAnalysis(response.text, context);
      }
    } catch (error) {
      throw new Error(`Visual analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Compares two screenshots to determine changes
   */
  async compareStates(
    beforeImage: string,
    afterImage: string,
    action: string
  ): Promise<StateComparison> {
    const systemPrompt = `You are analyzing before/after screenshots to determine if an automation action was successful.

    Respond in JSON format:
    {
      "hasChanged": true/false,
      "changes": ["List of visual changes observed"],
      "actionSuccessful": true/false,
      "nextSteps": ["Suggested next actions"],
      "confidence": 0.9
    }`;

    const userPrompt = `Compare these two screenshots - before and after performing this action: "${action}"

    Analyze:
    1. What changed between the two images?
    2. Was the action successful based on visual feedback?
    3. Are there any error messages or unexpected results?
    4. What should be the next steps?`;

    try {
      const response = await this.llmClient.generateContentWithImages({
        systemPrompt,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'BEFORE image:' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: beforeImage
              }
            },
            { type: 'text', text: 'AFTER image:' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: afterImage
              }
            },
            { type: 'text', text: userPrompt }
          ]
        }]
      });

      // Parse JSON response
      const jsonMatch = response.text.match(/```json\s*([\s\S]*?)\s*```|(\{[\s\S]*\})/);
      const jsonContent = jsonMatch ? (jsonMatch[1] || jsonMatch[2]) : response.text;
      const parsed = JSON.parse(jsonContent);

      return {
        hasChanged: parsed.hasChanged || false,
        changes: parsed.changes || [],
        actionSuccessful: parsed.actionSuccessful || false,
        nextSteps: parsed.nextSteps || [],
        confidence: parsed.confidence || 0.5
      };
    } catch (error) {
      throw new Error(`State comparison failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Identifies interactive elements and suggests actions
   */
  async identifyElements(
    screenshot: string,
    task: string
  ): Promise<ElementInfo[]> {
    const analysis = await this.analyzeCurrentState(screenshot, {
      currentUrl: 'unknown',
      taskObjective: task
    });

    return analysis.identifiedElements;
  }

  /**
   * Validates if an action was successful based on visual feedback
   */
  async validateActionSuccess(
    beforeImage: string,
    afterImage: string,
    action: string,
    expectedOutcome: string
  ): Promise<boolean> {
    const comparison = await this.compareStates(beforeImage, afterImage, action);
    
    if (!comparison.hasChanged) {
      return false; // No change usually means action failed
    }

    // Use LLM to determine if changes match expected outcome
    const systemPrompt = `Determine if the visual changes match the expected outcome of an action.`;
    
    const userPrompt = `Action performed: ${action}
    Expected outcome: ${expectedOutcome}
    Observed changes: ${comparison.changes.join(', ')}
    
    Does this indicate success? Reply with just "true" or "false".`;

    try {
      const response = await this.llmClient.generateContent({
        systemPrompt,
        userPrompt
      });

      return response.text.toLowerCase().includes('true');
    } catch (error) {
      // Fallback to heuristic
      return comparison.actionSuccessful;
    }
  }

  /**
   * Fallback parser for text-based analysis when JSON parsing fails
   */
  private parseTextAnalysis(text: string, context: AnalysisContext): VisualAnalysis {
    const lines = text.split('\n');
    const elements: ElementInfo[] = [];
    const actions: string[] = [];
    const errors: string[] = [];

    // Simple text parsing heuristics
    for (const line of lines) {
      const lower = line.toLowerCase();
      
      if (lower.includes('button') || lower.includes('click')) {
        elements.push({
          type: 'button',
          description: line.trim(),
          location: 'detected in text',
          isClickable: true,
          isVisible: true
        });
      }
      
      if (lower.includes('error') || lower.includes('failed')) {
        errors.push(line.trim());
      }
      
      if (lower.includes('next') || lower.includes('should')) {
        actions.push(line.trim());
      }
    }

    return {
      pageState: `Page analyzed via text parsing`,
      identifiedElements: elements,
      suggestedActions: actions.length > 0 ? actions : ['Continue with automation'],
      errors,
      confidence: 0.3, // Lower confidence for text parsing
      rawAnalysis: text
    };
  }
} 