import { Agent, type AgentNamespace, routeAgentRequest } from "agents";
import { MCPClientManager } from "agents/mcp/client";

type Env = {
  MyAgent: AgentNamespace<MyAgent>;
  HOST: string;
};

export class MyAgent extends Agent<Env, never> {
  mcp = new MCPClientManager("my-agent", "1.0.0");

  async onRequest(request: Request): Promise<Response> {
    const reqUrl = new URL(request.url);
    const pathSegments = reqUrl.pathname.split("/");
    const lastSegment = pathSegments[pathSegments.length - 1];

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (lastSegment === "add-mcp" && request.method === "POST") {
      const mcpServer = (await request.json()) as { url: string; name: string };
      await this.addMcpServer(mcpServer.name, mcpServer.url, this.env.HOST);
      return new Response("Ok", { status: 200 });
    }

    if (lastSegment === "call-tool" && request.method === "POST") {
      try {
        const body = (await request.json()) as {
          toolName: string;
          args: any;
          serverId: string;
        };

        const result = await this.mcp.callTool({
          name: body.toolName,
          arguments: body.args,
          serverId: body.serverId,
        });

        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    if (lastSegment === "remove-mcp" && request.method === "POST") {
      try {
        const body = (await request.json()) as { serverId: string };
        await this.mcp.closeConnection(body.serverId);
        await this.removeMcpServer(body.serverId);
        return new Response("Ok", { status: 200 });
      } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
    });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const agentResponse = await routeAgentRequest(request, env, { cors: true });
    return agentResponse || new Response("Not found", { status: 404 });
  },
};
