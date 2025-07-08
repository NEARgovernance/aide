# MCP Client

A demo for testing [Model Context Protocol (MCP)](https://spec.modelcontextprotocol.io/) servers:

> https://mcp-client.multidaomensional.workers.dev

Based on this [example](https://github.com/cloudflare/ai/tree/main/demos/mcp-client), which showcases how to:

- Connect to remote MCP servers via web interface
- Test tools with auto-generated sample arguments
- View capabilities (tools, prompts, resources) in real time

## Development

### 1. Setup

```bash
npm install
```

### 2. Run Backend

_Terminal A_

```bash
npx wrangler dev
```

### 3. Run Frontend

_Terminal B_

```bash
npm start
```

## Usage

Open your browser to http://localhost:5173 and start adding MCP servers.

1. **Connect:** Enter name and URL (e.g., `https://disco.multidaomensional.workers.dev/sse`)
2. **Test Tools:** Click "Test Tool" buttons to try available functionality
3. **View Schema:** Explore data, tools, prompts, and resources from connected servers

## Deployment

_using Cloudflare_

```bash
wrangler deploy
```

## Stack

- **Frontend:** TypeScript + React + Vite
- **Backend:** Cloudflare Workers + Durable Objects
- **Middleware:** Model Context Protocol (MCP)

## License

MIT
