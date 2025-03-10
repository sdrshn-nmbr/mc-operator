/**
 * PromptTemplate handles variable substitution in prompt templates
 */
export class PromptTemplate {
  private template: string;
  private variables: Record<string, string>;

  /**
   * Creates a new PromptTemplate
   * @param template The template string with variables in {{variable}} format
   * @param variables The variables to substitute in the template
   */
  constructor(template: string, variables: Record<string, string> = {}) {
    this.template = template;
    this.variables = variables;
  }

  /**
   * Adds or updates a variable for this template
   * @param key The variable name
   * @param value The variable value
   */
  setVariable(key: string, value: string): void {
    this.variables[key] = value;
  }

  /**
   * Adds multiple variables to this template
   * @param variables Object containing variable name-value pairs
   */
  setVariables(variables: Record<string, string>): void {
    this.variables = { ...this.variables, ...variables };
  }

  /**
   * Gets the value of a variable
   * @param key The variable name
   * @returns The variable value or undefined if not set
   */
  getVariable(key: string): string | undefined {
    return this.variables[key];
  }

  /**
   * Gets all variables in this template
   * @returns Object containing all variables
   */
  getVariables(): Record<string, string> {
    return { ...this.variables };
  }

  /**
   * Renders the template with all variables substituted
   * @returns The rendered template string
   */
  render(): string {
    let result = this.template;
    
    // Replace all {{variable}} instances with their values
    const variablePattern = /\{\{([^}]+)\}\}/g;
    result = result.replace(variablePattern, (match, variableName) => {
      const trimmedName = variableName.trim();
      return this.variables[trimmedName] !== undefined 
        ? this.variables[trimmedName] 
        : match; // Keep the placeholder if variable not provided
    });
    
    return result;
  }

  /**
   * Extracts all variable names from the template
   * @returns Array of variable names found in the template
   */
  extractVariableNames(): string[] {
    const variablePattern = /\{\{([^}]+)\}\}/g;
    const matches = this.template.matchAll(variablePattern);
    const variables = new Set<string>();
    
    for (const match of matches) {
      if (match[1]) {
        variables.add(match[1].trim());
      }
    }
    
    return Array.from(variables);
  }

  /**
   * Checks if all required variables have been provided
   * @param requiredVars List of required variable names
   * @returns Boolean indicating if all required variables are set
   */
  hasRequiredVariables(requiredVars: string[]): boolean {
    return requiredVars.every(varName => 
      this.variables[varName] !== undefined && 
      this.variables[varName] !== null &&
      this.variables[varName] !== ''
    );
  }
} 