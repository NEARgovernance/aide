import { useState, useEffect, useRef } from "react";
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
  analyzeSentiment: (proposalId: number, proposalTitle: string) => Promise<any>;
}

export interface ForumSentiment {
  overall: "positive" | "negative" | "neutral" | "mixed";
  score: number;
  postsCount: number;
  trends: {
    support: number;
    concerns: number;
    questions: number;
  };
  topConcerns: string[];
  keySupport: string[];
  isLoading: boolean;
}

// Global connection state to prevent multiple connections
let globalSessionId: string | null = null;
let globalAutoConnectCompleted = false;
let globalConnectionPromise: Promise<void> | null = null;
let activeHookCount = 0;

export function useMCPConnection(): MCPConnection {
  // Ensure single session ID
  if (!globalSessionId) {
    globalSessionId = nanoid(8);
  }

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

  // Track if this hook instance is active
  const isActiveRef = useRef(true);
  const hasInitializedRef = useRef(false);

  const refreshMcpState = async () => {
    if (!isActiveRef.current) return; // Prevent updates after unmount

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

      if (!isActiveRef.current) return; // Check again after async operation

      if (response.ok) {
        const state = (await response.json()) as MCPServersState;
        setMcpState(state);
        setIsConnected(true);
      } else {
        setIsConnected(false);
        console.error("Failed to refresh MCP state:", response.status);
      }
    } catch (err) {
      if (!isActiveRef.current) return;
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

    setTimeout(() => {
      if (isActiveRef.current) {
        refreshMcpState();
      }
    }, 1000);
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

    setTimeout(() => {
      if (isActiveRef.current) {
        refreshMcpState();
      }
    }, 1000);
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

  const analyzeSentiment = async (
    proposalId: number,
    proposalTitle: string
  ): Promise<ForumSentiment> => {
    try {
      const response = await agentFetch(
        {
          agent: "my-agent",
          host,
          name: globalSessionId!,
          path: "sentiment-analysis",
        },
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ proposalId, proposalTitle }),
        }
      );

      if (!response.ok) {
        throw new Error(`Sentiment analysis failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Sentiment analysis error:", error);
      return {
        overall: "neutral",
        score: 50,
        postsCount: 0,
        trends: { support: 33, concerns: 33, questions: 34 },
        topConcerns: ["Analysis unavailable"],
        keySupport: ["Try again later"],
        isLoading: false,
      };
    }
  };

  const autoConnectDefaultServers = async () => {
    // Use a shared promise to prevent multiple simultaneous connection attempts
    if (globalConnectionPromise) {
      await globalConnectionPromise;
      return;
    }

    if (globalAutoConnectCompleted) return;

    console.log(`🔌 Starting auto-connect (Active hooks: ${activeHookCount})`);

    globalConnectionPromise = (async () => {
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
        if (!isActiveRef.current) break; // Stop if component unmounted

        try {
          console.log(`🔌 Auto-connecting to ${server.name}...`);
          await addMCPServer(server.name, server.url, server.type);
          await new Promise((r) => setTimeout(r, 500));
          console.log(`✅ Successfully connected to ${server.name}`);
        } catch (err: any) {
          console.warn(
            `❌ Failed to auto-connect to ${server.name}:`,
            err.message
          );
        }
      }

      setTimeout(() => {
        if (isActiveRef.current) {
          refreshMcpState();
        }
      }, 1500);
    })();

    await globalConnectionPromise;
    globalConnectionPromise = null;
  };

  useEffect(() => {
    // Prevent multiple initializations from the same hook instance
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    activeHookCount++;
    console.log(
      `🔗 Hook mounted (Active: ${activeHookCount}, Session: ${globalSessionId})`
    );

    // Initialize connection with proper sequencing
    const initializeConnection = async () => {
      try {
        console.log("🚀 Starting initialization...");
        await refreshMcpState();
        console.log("📊 MCP state refreshed");
        await autoConnectDefaultServers();
        console.log("🎯 Initial connection setup complete");
      } catch (error) {
        console.error("❌ Initial connection setup failed:", error);
      }
    };

    initializeConnection();

    // Set up polling interval
    const interval = setInterval(() => {
      if (isActiveRef.current) {
        refreshMcpState();
      }
    }, 10000);

    // Cleanup function
    return () => {
      console.log(`🔌 Hook unmounting (Active: ${activeHookCount - 1})`);
      activeHookCount--;
      isActiveRef.current = false;
      clearInterval(interval);

      // Reset global state when no hooks are active
      if (activeHookCount === 0) {
        console.log("🧹 Resetting global connection state");
        globalSessionId = null;
        globalAutoConnectCompleted = false;
        globalConnectionPromise = null;
      }
    };
  }, []); // Empty dependency array is correct here

  return {
    isConnected,
    mcpState,
    sessionId: globalSessionId!,
    callTool,
    addMCPServer: addMCPServer,
    removeMcpServer,
    refreshMcpState,
    analyzeSentiment,
  };
}
