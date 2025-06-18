# Autonomous Web Agent with Dynamic Prompt Management

This system allows you to create autonomous web agents using Puppeteer and large language models. It features a dynamic prompt management system that can generate detailed web automation instructions from simple natural language commands.

## Features

- **Dynamic Prompt Generation**: Turn simple commands into detailed step-by-step instructions
- **Task Classification**: Automatically categorize user requests and extract parameters
- **Template Management**: Organize and manage prompt templates for different tasks
- **Prompt Repository**: Store and retrieve generated prompts
- **Multiple Task Types**: Support for shopping, search, media, and more
- **Browserbase Integration**: Option to use Browserbase for cloud-based browser automation

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

### Local Browser Automation

Start the agent with a local Chrome instance:

```
npx ts-node client.ts
```

### Browserbase Cloud Automation

Start the agent with Browserbase cloud browser:

```
npm run browserbase
```

or

```
npx ts-node client.ts --browserbase
```

The interactive CLI will guide you through:
1. Generating detailed instructions from simple commands
2. Viewing available templates
3. Managing previously generated prompts

## Browserbase Integration

This project supports [Browserbase](https://browserbase.com/) for cloud-based browser automation. Browserbase provides:

- Cloud-based Chromium instances
- Anti-detection fingerprinting
- Proxy support
- Captcha solving

To use Browserbase:

1. Set the following environment variables in your `.env` file:
   ```
   BROWSERBASE_API_KEY=your_api_key
   BROWSERBASE_PROJECT_ID=your_project_id
   USE_BROWSERBASE=true
   ```

2. Or run with the `--browserbase` flag:
   ```
   npx ts-node client.ts --browserbase
   ```

You can view your Browserbase sessions at: https://browserbase.com/sessions

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
- `BROWSERBASE_API_KEY` - API key for Browserbase
- `BROWSERBASE_PROJECT_ID` - Project ID for Browserbase
- `USE_BROWSERBASE` - Set to "true" to use Browserbase instead of local Chrome
- `AGENT_MODE` - Set to "interactive" or "execute"
- `AGENT_INSTRUCTIONS_PATH` - Path to instructions file for agent mode

## License

MIT 