import { Agent, type AgentNamespace, routeAgentRequest } from "agents";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

type Env = {
  MyAgent: AgentNamespace<MyAgent>;
  HOST: string;
};

type State = {};

export class MyAgent extends Agent<Env, State> {
  private clients = new Map<string, Client>();

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.split("/").pop() ?? "";

    if (request.method === "OPTIONS") {
      const requestedHeaders =
        request.headers.get("Access-Control-Request-Headers") || "";
      console.log("🔍 CORS Preflight - Requested Headers:", requestedHeaders);

      const corsHeaders = this.createCorsHeaders(requestedHeaders);
      console.log(
        "✅ CORS Preflight - Allowed Headers:",
        corsHeaders["Access-Control-Allow-Headers"]
      );

      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    if (path === "add-mcp" && request.method === "POST") {
      const body = (await request.json()) as { url: string; name: string };
      const { url: serverUrl, name } = body;
      const sessionId = `session-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 11)}`;

      const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
        sessionId,
      });

      const client = new Client(
        {
          name: "bitte-mcp-client",
          version: "0.0.1",
        },
        {
          capabilities: {
            roots: { listChanged: true },
            sampling: {},
          },
        }
      );

      try {
        await client.connect(transport);
        this.clients.set(name, client);
        return this.createCorsResponse(
          JSON.stringify({ ok: true, sessionId }),
          200
        );
      } catch (error) {
        return this.createCorsResponse(
          JSON.stringify({
            error: `Failed to connect: ${(error as Error).message}`,
          }),
          500
        );
      }
    }

    if (path === "remove-mcp" && request.method === "POST") {
      const body = (await request.json()) as { serverId: string };
      const { serverId } = body;

      if (this.clients.has(serverId)) {
        const client = this.clients.get(serverId)!;
        await client.close();
        this.clients.delete(serverId);

        return this.createCorsResponse(JSON.stringify({ ok: true }), 200);
      } else {
        return this.createCorsResponse(
          JSON.stringify({ error: "Server not found" }),
          404
        );
      }
    }

    if (path === "tools" && request.method === "GET") {
      try {
        const allTools = [];

        for (const [serverName, client] of this.clients) {
          try {
            const tools = await client.listTools();
            allTools.push(
              ...tools.tools.map((tool) => ({ ...tool, serverId: serverName }))
            );
          } catch (err) {
            console.error(`Error listing tools from ${serverName}:`, err);
          }
        }

        return this.createCorsResponse(
          JSON.stringify({ tools: allTools }),
          200
        );
      } catch (err: any) {
        return this.createCorsResponse(
          JSON.stringify({ error: err.message }),
          500
        );
      }
    }

    if (path === "call-tool" && request.method === "POST") {
      try {
        const body = (await request.json()) as {
          toolName: string;
          args: Record<string, any>;
          serverId?: string;
        };
        const { toolName, args, serverId } = body;

        if (!serverId || !this.clients.has(serverId)) {
          return this.createCorsResponse(
            JSON.stringify({
              error: "Server not found or serverId not specified",
            }),
            400
          );
        }

        const client = this.clients.get(serverId)!;
        const result = await client.callTool({
          name: toolName,
          arguments: args,
        });

        return this.createCorsResponse(JSON.stringify(result), 200);
      } catch (err: any) {
        return this.createCorsResponse(
          JSON.stringify({ error: err.message }),
          500
        );
      }
    }

    if (path === "list-servers" && request.method === "GET") {
      const servers = Array.from(this.clients.keys());
      return this.createCorsResponse(JSON.stringify({ servers }), 200);
    }

    if (path === "mcp-state" && request.method === "GET") {
      try {
        const tools = [];
        const servers: Record<
          string,
          { name: string; state: string; error?: string }
        > = {}; // ✅ Proper typing

        // Collect tools from all clients
        for (const [serverName, client] of this.clients) {
          try {
            const clientTools = await client.listTools();
            tools.push(
              ...clientTools.tools.map((tool) => ({
                ...tool,
                serverId: serverName,
              }))
            );
            servers[serverName] = { name: serverName, state: "ready" };
          } catch (err) {
            console.error(`Error getting tools from ${serverName}:`, err);
            servers[serverName] = {
              name: serverName,
              state: "error",
              error: (err as Error).message,
            };
          }
        }

        return this.createCorsResponse(
          JSON.stringify({
            tools,
            servers,
            prompts: [],
            resources: [],
          }),
          200
        );
      } catch (err: any) {
        return this.createCorsResponse(
          JSON.stringify({ error: err.message }),
          500
        );
      }
    }

    return new Response("Not Found", { status: 404 });
  }

  private createCorsHeaders(acrh: string = "") {
    const requiredHeaders = [
      "content-type",
      "Content-Type",
      "authorization",
      "Authorization",
      "mcp-session-id",
      "Mcp-Session-Id",
      "mcp-protocol-version",
      "MCP-Protocol-Version",
    ];

    // Parse defined headers and merge with required ones
    const requestedHeaders = acrh ? acrh.split(",").map((h) => h.trim()) : [];

    // Combine + deduplicate (case-insensitive)
    const allHeaders = [...requiredHeaders];
    for (const header of requestedHeaders) {
      const headerLower = header.toLowerCase();
      const exists = allHeaders.some((h) => h.toLowerCase() === headerLower);
      if (!exists) {
        allHeaders.push(header);
      }
    }

    return {
      "Access-Control-Allow-Origin": "*", // restrict to specific domains in production
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": allHeaders.join(", "),
      "Access-Control-Max-Age": "86400",
    };
  }

  private createCorsResponse(
    body?: string,
    status = 200,
    headers: Record<string, string> = {}
  ) {
    return new Response(body, {
      status,
      headers: {
        ...this.createCorsHeaders(),
        "Content-Type": "application/json",
        ...headers,
      },
    });
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const routed = await routeAgentRequest(request, env);
    if (routed) return routed;

    return new Response(JSON.stringify({ error: "Route not found" }), {
      status: 404,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  },
};
