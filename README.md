# Autonomous Web Agent with Dynamic Prompt Management

This system allows you to create autonomous web agents using Puppeteer and large language models. It features a dynamic prompt management system that can generate detailed web automation instructions from simple natural language commands.

## Features

- **Dynamic Prompt Generation**: Turn simple commands into detailed step-by-step instructions
- **Task Classification**: Automatically categorize user requests and extract parameters
- **Template Management**: Organize and manage prompt templates for different tasks
- **Prompt Repository**: Store and retrieve generated prompts
- **Multiple Task Types**: Support for shopping, search, media, and more

## Installation

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Copy the `.env.example` to `.env` and fill in your API keys:
   ```
   cp .env.example .env
   ```
4. Build the TypeScript code:
   ```
   npm run build
   ```

## Usage

Start the prompt management system:

```
npm run dev
```

The interactive CLI will guide you through:
1. Generating detailed instructions from simple commands
2. Viewing available templates
3. Managing previously generated prompts

## Directory Structure

- `/src` - TypeScript source code
  - `/prompts` - Prompt generation and templating
  - `/storage` - File storage and retrieval
  - `/utils` - Utility functions including LLM client
  - `/agent` - Agent execution logic (future)
- `/templates` - Prompt templates
  - `/system` - System prompts
  - `/tasks` - Task-specific templates
  - `/generated` - Generated detailed instructions
- `/config` - Configuration files

## Creating Custom Templates

Create your own templates in the `/templates` directory. Use the `{{variable}}` syntax for dynamic content. For example:

```
I need to search for information about {{query}} and collect the results.

Please provide detailed step-by-step instructions for...
```

Then define the task in `/config/tasks.json`.

## Environment Variables

- `ANTHROPIC_API_KEY` - API key for the Claude AI model

## License

MIT 