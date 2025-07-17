# MCP Client

Test [Model Context Protocol](https://spec.modelcontextprotocol.io) servers via the [Bitte MCP proxy](https://docs.bitte.ai/agents/mcp):

> https://mcp.bitte.ai

Based on this [example](https://github.com/cloudflare/ai/tree/main/demos/mcp-client), showcasing how to:

- Access remote MCP servers via web interface
- View capabilities (tools, prompts, resources)
- Run tool calls and inspect structured responses

## Development

### 1. Setup

```bash
npm install
```

### 2. Build

```bash
npm run build
```

### 3. Run Backend

_Terminal A_

```bash
npx wrangler dev
```

### 4. Run Frontend

_Terminal B_

```bash
npm start
```

## Usage

Open your browser to http://localhost:5173 and start adding MCP servers.

1. **Connect:** Enter URL (e.g., `https://mcp.bitte.ai/mcp?agentId=hos-agent.vercel.app`)
2. **Test:** Click "Run Tool" buttons to try the available functionality
3. **Explore:** View data, tools, prompts, and resources from connected servers

## Deployment

_using Cloudflare_

```bash
wrangler deploy
```
