import { PromptTemplate } from './prompts/PromptTemplate';

/**
 * Test function to demonstrate prompt template functionality
 */
function testPromptTemplate() {
  console.log('===== Testing PromptTemplate =====');
  
  // Create a simple template
  const templateStr = `
Hello {{name}},

I'm going to help you {{action}} on {{website}}. 

Here's what we'll do:
1. Navigate to {{website}}
2. Search for "{{query}}"
3. Click on the results that match your preferences: {{preferences}}

Let me know if you need anything else!
`;

  // Create a new template with initial variables
  const template = new PromptTemplate(templateStr, {
    name: 'User',
    action: 'shop',
    website: 'amazon.com'
  });
  
  // Display the template with initial variables
  console.log('\n--- Template with initial variables ---\n');
  console.log(template.render());
  
  // Add more variables
  template.setVariables({
    query: 'wireless headphones',
    preferences: 'noise cancelling, under $100'
  });
  
  // Display the template with all variables
  console.log('\n--- Template with all variables ---\n');
  console.log(template.render());
  
  // Show extracted variable names
  console.log('\n--- Variables in template ---\n');
  console.log(template.extractVariableNames());
  
  // Test required variables check
  console.log('\n--- Required variables check ---\n');
  const requiredVars = ['name', 'website', 'query'];
  console.log(`Has all required variables? ${template.hasRequiredVariables(requiredVars)}`);
}

/**
 * Main function to run tests
 */
async function main() {
  testPromptTemplate();
}

// Run the tests
main().catch(error => {
  console.error('Test error:', error);
}); 