import { Agent, type AgentNamespace, routeAgentRequest } from "agents";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

type Env = {
  MyAgent: AgentNamespace<MyAgent>;
  HOST: string;
};

type State = {};

interface MCPServerConfig {
  name: string;
  url: string;
  type: "bitte" | "direct"; // Track server type
}

export class MyAgent extends Agent<Env, State> {
  private clients = new Map<string, Client>();
  private serverConfigs = new Map<string, MCPServerConfig>();

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
      const body = (await request.json()) as {
        url: string;
        name: string;
        type?: "bitte" | "direct";
      };

      const { url: serverUrl, name, type = "bitte" } = body;

      return await this.addMCPServer({ name, url: serverUrl, type });
    }

    // Add endpoint for adding Discourse server specifically
    if (path === "add-discourse" && request.method === "POST") {
      const body = (await request.json()) as {
        url: string;
        apiKey?: string;
        name?: string;
      };

      const { url: serverUrl, name = "NEAR Discourse" } = body;

      return await this.addMCPServer({
        name,
        url: serverUrl,
        type: "direct",
      });
    }

    if (path === "remove-mcp" && request.method === "POST") {
      const body = (await request.json()) as { serverId: string };
      const { serverId } = body;

      if (this.clients.has(serverId)) {
        const client = this.clients.get(serverId)!;
        await client.close();
        this.clients.delete(serverId);
        this.serverConfigs.delete(serverId);

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
              ...tools.tools.map((tool) => ({
                ...tool,
                serverId: serverName,
                serverType:
                  this.serverConfigs.get(serverName)?.type || "unknown",
              }))
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

        // Add governance-specific context handling
        let enhancedArgs = args;
        if (this.isGovernanceQuery(toolName, args)) {
          enhancedArgs = await this.enhanceGovernanceContext(args, serverId);
        }

        const result = await client.callTool({
          name: toolName,
          arguments: enhancedArgs,
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
      const servers = Array.from(this.clients.keys()).map((serverId) => ({
        id: serverId,
        config: this.serverConfigs.get(serverId),
      }));
      return this.createCorsResponse(JSON.stringify({ servers }), 200);
    }

    if (path === "mcp-state" && request.method === "GET") {
      try {
        const tools = [];
        const servers: Record<
          string,
          { name: string; state: string; error?: string; type?: string }
        > = {};

        for (const [serverName, client] of this.clients) {
          try {
            const clientTools = await client.listTools();
            tools.push(
              ...clientTools.tools.map((tool) => ({
                ...tool,
                serverId: serverName,
              }))
            );
            servers[serverName] = {
              name: serverName,
              state: "ready",
              type: this.serverConfigs.get(serverName)?.type || "unknown",
            };
          } catch (err) {
            console.error(`Error getting tools from ${serverName}:`, err);
            servers[serverName] = {
              name: serverName,
              state: "error",
              error: (err as Error).message,
              type: this.serverConfigs.get(serverName)?.type || "unknown",
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

  private async addMCPServer(config: MCPServerConfig): Promise<Response> {
    try {
      let transport;

      if (config.type === "direct") {
        // Use SSE transport for Cloudflare Agents SDK servers
        console.log(`🔌 Creating SSE transport for: ${config.url}`);
        transport = new SSEClientTransport(new URL(config.url));
      } else {
        // Bitte AI proxy connection uses HTTP transport
        const sessionId = `session-${Date.now()}-${Math.random()
          .toString(36)
          .substring(2, 11)}`;
        transport = new StreamableHTTPClientTransport(new URL(config.url), {
          sessionId,
        });
      }

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

      console.log(`🔌 Connecting to ${config.name}...`);
      await client.connect(transport);
      console.log(`✅ Connected to ${config.name}`);

      // Test tool listing
      try {
        const tools = await client.listTools();
        console.log(
          `🛠️ Found ${tools.tools.length} tools from ${config.name}:`,
          tools.tools.map((t) => t.name)
        );
      } catch (toolError) {
        console.warn(`⚠️ Could not list tools from ${config.name}:`, toolError);
      }

      this.clients.set(config.name, client);
      this.serverConfigs.set(config.name, config);

      return this.createCorsResponse(
        JSON.stringify({
          ok: true,
          serverType: config.type,
          transportType: config.type === "direct" ? "SSE" : "HTTP",
        }),
        200
      );
    } catch (error) {
      console.error(`❌ Failed to connect to ${config.name}:`, error);
      return this.createCorsResponse(
        JSON.stringify({
          error: `Failed to connect to ${config.type} server: ${
            (error as Error).message
          }`,
        }),
        500
      );
    }
  }

  private isGovernanceQuery(
    toolName: string,
    args: Record<string, any>
  ): boolean {
    // Detect governance-related queries based on your specific tools
    const governanceTools = [
      "get_latest_topics",
      "search_posts",
      "get_topic",
      "get_recent_posts",
    ];

    const governanceKeywords = [
      "proposal",
      "vote",
      "governance",
      "discussion",
      "forum",
      "near",
      "dao",
    ];
    const toolString = `${toolName} ${JSON.stringify(args)}`.toLowerCase();

    return (
      governanceTools.includes(toolName) ||
      governanceKeywords.some((keyword) => toolString.includes(keyword))
    );
  }

  private async enhanceGovernanceContext(
    args: Record<string, any>,
    currentServerId: string
  ): Promise<Record<string, any>> {
    // Cross-reference data between House of Stake and Discourse
    try {
      if (args.proposalId || args.proposal_id || args.id) {
        const proposalId = args.proposalId || args.proposal_id || args.id;

        // If calling Discourse, add proposal context from House of Stake
        if (
          currentServerId.toLowerCase().includes("discourse") ||
          currentServerId.toLowerCase().includes("near")
        ) {
          const hosServer = Array.from(this.clients.keys()).find(
            (name) =>
              name.toLowerCase().includes("stake") ||
              name.toLowerCase().includes("hos") ||
              name.toLowerCase().includes("bitte")
          );

          if (hosServer && this.clients.has(hosServer)) {
            try {
              const hosClient = this.clients.get(hosServer)!;
              const proposalData = await hosClient.callTool({
                name: "get_proposal",
                arguments: { proposal_id: proposalId },
              });

              return {
                ...args,
                proposalContext: proposalData,
                enhancedSearch: true,
              };
            } catch (err) {
              console.warn("Failed to enhance with proposal context:", err);
            }
          }
        }

        // If calling House of Stake, add forum discussion context from Discourse
        if (
          currentServerId.toLowerCase().includes("stake") ||
          currentServerId.toLowerCase().includes("hos") ||
          currentServerId.toLowerCase().includes("bitte")
        ) {
          const discourseServer = Array.from(this.clients.keys()).find(
            (name) =>
              name.toLowerCase().includes("discourse") ||
              name.toLowerCase().includes("near")
          );

          if (discourseServer && this.clients.has(discourseServer)) {
            try {
              const discourseClient = this.clients.get(discourseServer)!;
              const forumData = await discourseClient.callTool({
                name: "search_posts",
                arguments: { query: `proposal ${proposalId}`, max_results: 5 },
              });

              return {
                ...args,
                forumContext: forumData,
                enhancedSearch: true,
              };
            } catch (err) {
              console.warn("Failed to enhance with forum context:", err);
            }
          }
        }
      }
    } catch (err) {
      console.error("Error enhancing governance context:", err);
    }

    return args;
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
      "x-api-key",
      "X-API-Key",
    ];

    const requestedHeaders = acrh ? acrh.split(",").map((h) => h.trim()) : [];
    const allHeaders = [...requiredHeaders];

    for (const header of requestedHeaders) {
      const headerLower = header.toLowerCase();
      const exists = allHeaders.some((h) => h.toLowerCase() === headerLower);
      if (!exists) {
        allHeaders.push(header);
      }
    }

    return {
      "Access-Control-Allow-Origin": "*",
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
