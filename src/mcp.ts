import { useState, useEffect } from "react";
import type { MCPServersState } from "agents";
import { agentFetch } from "agents/client";
import { nanoid } from "nanoid";

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: any;
  serverId?: string;
  serverType?: "bitte" | "direct" | "unknown";
}

export interface MCPConnection {
  isConnected: boolean;
  mcpState: MCPServersState;
  sessionId: string;
  callTool: (
    toolName: string,
    serverId: string,
    args: Record<string, any>
  ) => Promise<any>;
  addMCPServer: (
    name: string,
    url: string,
    type: "bitte" | "direct"
  ) => Promise<void>;
  removeMcpServer: (serverId: string) => Promise<void>;
  refreshMcpState: () => Promise<void>;
}

let globalSessionId: string | null = null;
let globalAutoConnectCompleted = false;

export function useMCPConnection(): MCPConnection {
  if (!globalSessionId) globalSessionId = nanoid(8);

  const host =
    window.location.hostname === "localhost"
      ? "http://localhost:8787"
      : window.location.origin;

  const [isConnected, setIsConnected] = useState(false);
  const [mcpState, setMcpState] = useState<MCPServersState>({
    prompts: [],
    resources: [],
    servers: {},
    tools: [],
  });

  const refreshMcpState = async () => {
    try {
      const response = await agentFetch(
        {
          agent: "my-agent",
          host,
          name: globalSessionId!,
          path: "mcp-state",
        },
        { method: "GET" }
      );
      if (response.ok) {
        const state = (await response.json()) as MCPServersState;
        setMcpState(state);
        setIsConnected(true);
      } else {
        setIsConnected(false);
        console.error("Failed to refresh MCP state:", response.status);
      }
    } catch (err) {
      setIsConnected(false);
      console.error("Error refreshing MCP state:", err);
    }
  };

  const addMCPServer = async (
    name: string,
    url: string,
    type: "bitte" | "direct"
  ) => {
    if (mcpState.servers[name]) return;
    const path = type === "direct" ? "add-discourse" : "add-mcp";

    const response = await agentFetch(
      {
        agent: "my-agent",
        host,
        name: globalSessionId!,
        path,
      },
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url, type }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server responded with ${response.status}: ${errorText}`);
    }

    setTimeout(refreshMcpState, 1000);
  };

  const removeMcpServer = async (serverId: string) => {
    const response = await agentFetch(
      {
        agent: "my-agent",
        host,
        name: globalSessionId!,
        path: "remove-mcp",
      },
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverId }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server responded with ${response.status}: ${errorText}`);
    }

    setTimeout(refreshMcpState, 1000);
  };

  const callTool = async (
    toolName: string,
    serverId: string,
    args: Record<string, any>
  ): Promise<any> => {
    const response = await agentFetch(
      {
        agent: "my-agent",
        host,
        name: globalSessionId!,
        path: "call-tool",
      },
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolName, serverId, args }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Tool call failed: ${response.status} ${errorText}`);
    }

    return await response.json();
  };

  const autoConnectDefaultServers = async () => {
    if (globalAutoConnectCompleted) return;
    globalAutoConnectCompleted = true;

    const defaultServers = [
      {
        name: "NEAR Discourse",
        url: "https://disco.multidaomensional.workers.dev/sse",
        type: "direct" as const,
      },
      {
        name: "House of Stake",
        url: "https://mcp.bitte.ai/mcp?agentId=hos-agent.vercel.app",
        type: "bitte" as const,
      },
    ];

    for (const server of defaultServers) {
      try {
        await addMCPServer(server.name, server.url, server.type);
        await new Promise((r) => setTimeout(r, 500));
      } catch (err: any) {
        console.warn(
          `❌ Failed to auto-connect to ${server.name}:`,
          err.message
        );
      }
    }

    setTimeout(refreshMcpState, 1500);
  };

  useEffect(() => {
    refreshMcpState();
    autoConnectDefaultServers();

    const interval = setInterval(refreshMcpState, 10000);
    return () => clearInterval(interval);
  }, []);

  return {
    isConnected,
    mcpState,
    sessionId: globalSessionId!,
    callTool,
    addMCPServer,
    removeMcpServer,
    refreshMcpState,
  };
}
