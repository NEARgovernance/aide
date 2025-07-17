import { useAgent } from "agents/react";
import { useRef, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import type { MCPServersState } from "agents";
import { agentFetch } from "agents/client";
import { nanoid } from "nanoid";

const sessionId = nanoid(8);

interface ToolInput {
  [key: string]: any;
}

interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: any;
  serverId?: string;
}

interface MCPServerWithError {
  name: string;
  state: string;
  error?: string;
}

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const agentIdInputRef = useRef<HTMLInputElement>(null);
  const [mcpState, setMcpState] = useState<MCPServersState>({
    prompts: [],
    resources: [],
    servers: {},
    tools: [],
  });
  const [toolResults, setToolResults] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [connectionStatus, setConnectionStatus] = useState<string>("");
  const [toolInputs, setToolInputs] = useState<Record<string, ToolInput>>({});
  const [refreshing, setRefreshing] = useState(false);

  const agent = useAgent({
    agent: "my-agent",
    name: sessionId,
    host:
      window.location.hostname === "localhost"
        ? "http://localhost:8787"
        : window.location.origin,
    onClose: () => {
      console.warn("🛑 Agent connection closed");
      setIsConnected(false);
    },
    onMcpUpdate: (mcpServers: MCPServersState) => {
      console.debug(
        "📡 MCP Update received:",
        JSON.stringify(mcpServers, null, 2)
      );
      setMcpState((prev) => ({ ...prev, ...mcpServers }));
    },
    onOpen: () => {
      console.info("✅ Agent connection opened");
      setIsConnected(true);
      refreshMcpState();
    },
  });

  const refreshMcpState = async () => {
    if (!isConnected) return;

    setRefreshing(true);
    try {
      console.log("🔄 Refreshing MCP state...");
      const response = await agentFetch(
        {
          agent: "my-agent",
          host: agent.host,
          name: sessionId,
          path: "mcp-state",
        },
        {
          method: "GET",
        }
      );

      if (response.ok) {
        const state = (await response.json()) as MCPServersState;
        console.log("📊 Received MCP state:", state);
        setMcpState(state);
      } else {
        console.error("Failed to refresh MCP state:", response.status);
      }
    } catch (error) {
      console.error("Error refreshing MCP state:", error);
    } finally {
      setRefreshing(false);
    }
  };

  // Auto-refresh MCP state periodically
  useEffect(() => {
    if (!isConnected) return;

    const interval = setInterval(() => {
      refreshMcpState();
    }, 10000); // Refresh every 10 seconds

    return () => clearInterval(interval);
  }, [isConnected]);

  const handleAddConnection = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!agentIdInputRef.current || !agentIdInputRef.current.value.trim())
      return;

    const serverUrl = agentIdInputRef.current.value.trim();

    const urlParams = new URLSearchParams(serverUrl.split("?")[1] || "");
    const agentId = urlParams.get("agentId") || "Unknown Agent";
    const serverName = `Bitte Agent: ${agentId}`;

    setConnectionStatus(`Connecting to ${agentId}...`);

    try {
      const response = await agentFetch(
        {
          agent: "my-agent",
          host: agent.host,
          name: sessionId,
          path: "add-mcp",
        },
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: serverName, url: serverUrl }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Server responded with ${response.status}: ${errorText}`
        );
      }

      setConnectionStatus(`✅ Successfully added ${agentId}`);
      agentIdInputRef.current.value = "";

      setTimeout(() => {
        refreshMcpState();
        setConnectionStatus("");
      }, 2000);
    } catch (error: any) {
      setConnectionStatus(`❌ Failed to add MCP server: ${error.message}`);
      setTimeout(() => setConnectionStatus(""), 5000);
    }
  };

  const removeMcpServer = async (serverId: string) => {
    setConnectionStatus(`Removing server ${serverId}...`);
    console.log(`[DEBUG] Sending remove-mcp request for: ${serverId}`);

    try {
      const response = await agentFetch(
        {
          agent: "my-agent",
          host: agent.host,
          name: sessionId,
          path: "remove-mcp",
        },
        {
          body: JSON.stringify({ serverId }),
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Server responded with ${response.status}: ${errorText}`
        );
      }

      console.log("[DEBUG] remove-mcp response OK");

      setConnectionStatus(`✅ Removed server ${serverId}`);

      // Refresh state after removing
      setTimeout(() => {
        refreshMcpState();
        setConnectionStatus("");
      }, 2000);
    } catch (err: any) {
      console.error("Failed to remove server:", err);
      setConnectionStatus(`❌ Failed to remove server: ${err.message}`);
      setTimeout(() => setConnectionStatus(""), 5000);
    }
  };

  const updateToolInput = (toolKey: string, paramName: string, value: any) => {
    setToolInputs((prev) => ({
      ...prev,
      [toolKey]: {
        ...prev[toolKey],
        [paramName]: value,
      },
    }));
  };

  const callTool = async (
    toolName: string,
    serverId?: string,
    schema?: any
  ) => {
    const toolKey = serverId ? `${toolName}-${serverId}` : toolName;
    setLoading((prev) => ({ ...prev, [toolKey]: true }));

    try {
      // Get the input arguments for this tool
      const toolArgs = toolInputs[toolKey] || {};

      console.log(
        `[DEBUG] Calling tool "${toolName}" ${
          serverId ? `on server "${serverId}"` : ""
        } with:`,
        toolArgs
      );

      const requestBody: any = {
        toolName,
        args: toolArgs,
      };

      if (serverId) {
        requestBody.serverId = serverId;
      }

      const response = await agentFetch(
        {
          agent: "my-agent",
          host: agent.host,
          name: sessionId,
          path: "call-tool",
        },
        {
          body: JSON.stringify(requestBody),
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Tool call failed: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      setToolResults((prev) => ({ ...prev, [toolKey]: result }));
      console.log("[DEBUG] Tool result:", result);
    } catch (error: any) {
      console.error("Tool call error:", error);
      setToolResults((prev) => ({
        ...prev,
        [toolKey]: { error: error.message },
      }));
    } finally {
      setLoading((prev) => ({ ...prev, [toolKey]: false }));
    }
  };

  const renderToolInputs = (tool: MCPTool) => {
    const toolKey = tool.serverId
      ? `${String(tool.name)}-${String(tool.serverId)}`
      : String(tool.name);
    const schema = tool.inputSchema;

    if (!schema?.properties) return null;

    return (
      <div className="tool-inputs">
        <h4>Parameters:</h4>
        {Object.entries(schema.properties).map(
          ([paramName, paramDef]: [string, any]) => (
            <div
              key={paramName}
              className="input-group"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                marginBottom: "16px",
              }}
            >
              <label style={{ fontWeight: "500" }}>
                {paramName}
                {schema.required?.includes(paramName) && (
                  <span className="required" style={{ color: "red" }}>
                    *
                  </span>
                )}
              </label>
              {paramDef.type === "boolean" ? (
                <select
                  value={toolInputs[toolKey]?.[paramName] || ""}
                  onChange={(e) =>
                    updateToolInput(
                      toolKey,
                      paramName,
                      e.target.value === "true"
                    )
                  }
                  style={{ padding: "8px", fontSize: "1rem" }}
                >
                  <option value="">Select...</option>
                  <option value="true">True</option>
                  <option value="false">False</option>
                </select>
              ) : (
                <input
                  type={paramDef.type === "number" ? "number" : "text"}
                  placeholder={paramDef.description || `Enter ${paramName}`}
                  value={toolInputs[toolKey]?.[paramName] || ""}
                  onChange={(e) =>
                    updateToolInput(
                      toolKey,
                      paramName,
                      paramDef.type === "number"
                        ? Number(e.target.value)
                        : e.target.value
                    )
                  }
                  style={{
                    padding: "8px",
                    fontSize: "1rem",
                    borderRadius: "6px",
                    border: "1px solid #ccc",
                  }}
                />
              )}
            </div>
          )
        )}
      </div>
    );
  };

  const renderToolResult = (result: any) => {
    if (!result) return null;

    if (result.error) {
      return (
        <div className="result error">
          <strong>Error:</strong>
          <pre>{result.error}</pre>
        </div>
      );
    }

    // Handle MCP tool results that have content array
    if (result.content && Array.isArray(result.content)) {
      return (
        <div className="result success">
          <strong>Result:</strong>
          {result.content.map((item: any, index: number) => (
            <div key={index} className="result-item">
              {item.type === "text" ? (
                <pre>{item.text}</pre>
              ) : (
                <pre>{JSON.stringify(item, null, 2)}</pre>
              )}
            </div>
          ))}
        </div>
      );
    }

    // Fallback to JSON display
    return (
      <div className="result success">
        <strong>Result:</strong>
        <pre>{JSON.stringify(result, null, 2)}</pre>
      </div>
    );
  };

  return (
    <div className="container">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <h1>Bitte MCP Client</h1>
        <div
          className="status"
          style={{ display: "flex", alignItems: "center" }}
        >
          <span className={`dot ${isConnected ? "connected" : ""}`}></span>
          <span style={{ marginLeft: "6px" }}>
            {isConnected ? "Connected" : "Disconnected"}
          </span>
          {isConnected && (
            <button
              onClick={refreshMcpState}
              disabled={refreshing}
              className="refresh-btn"
              style={{
                marginLeft: "10px",
                fontSize: "12px",
                padding: "2px 6px",
              }}
            >
              {refreshing ? "🔄" : "↻"} Refresh
            </button>
          )}
        </div>
      </div>

      <div className="section">
        <h2>Connect</h2>
        {connectionStatus && (
          <div
            className={`connection-status ${
              connectionStatus.includes("❌")
                ? "error"
                : connectionStatus.includes("✅")
                ? "success"
                : "info"
            }`}
          >
            {connectionStatus}
          </div>
        )}
        <p className="help-text">Bitte MCP Link:</p>
        <form onSubmit={handleAddConnection}>
          <input
            ref={agentIdInputRef}
            type="text"
            placeholder="https://mcp.bitte.ai/mcp?agentId={YOUR_AGENT_ID}"
            required
            disabled={!isConnected}
          />
          <button type="submit" disabled={!isConnected}>
            Add
          </button>
        </form>
        <div>
          <p>
            <b>Example:</b>
            <br />
            <code>https://mcp.bitte.ai/mcp?agentId=hos-agent.vercel.app</code>
          </p>
          <p>
            To learn more, refer to the{" "}
            <a href="https://docs.bitte.ai/agents/mcp">documentation</a>.
          </p>
        </div>
      </div>

      <div className="section">
        <h2>Agents ({Object.keys(mcpState.servers).length})</h2>
        {Object.keys(mcpState.servers).length === 0 ? (
          <p className="empty-state">No agents connected yet. Add one above!</p>
        ) : (
          Object.entries(mcpState.servers).map(([id, server]) => {
            const serverWithError = server as MCPServerWithError;
            return (
              <div key={id} className="server">
                <div className="server-info">
                  <strong>{String(serverWithError.name)}</strong>
                  <div className="server-details">
                    <div className="server-status">
                      <span
                        className={`dot ${
                          String(serverWithError.state) === "ready"
                            ? "connected"
                            : String(serverWithError.state) === "error"
                            ? "error"
                            : ""
                        }`}
                      ></span>
                      {String(serverWithError.state)}
                    </div>
                    {serverWithError.error && (
                      <div className="server-error">
                        Error: {String(serverWithError.error)}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => removeMcpServer(String(id))}
                  className="remove-btn"
                  disabled={!isConnected}
                >
                  Remove
                </button>
              </div>
            );
          })
        )}
      </div>

      <div className="section">
        <h2>Tools ({mcpState.tools.length})</h2>
        {mcpState.tools.length === 0 ? (
          <p className="empty-state">
            {Object.keys(mcpState.servers).length === 0
              ? "Connect an agent to see available tools"
              : "No tools available from connected agents"}
          </p>
        ) : (
          mcpState.tools.map((tool) => {
            const mcpTool = tool as MCPTool;
            const toolKey = mcpTool.serverId
              ? `${String(mcpTool.name)}-${String(mcpTool.serverId)}`
              : String(mcpTool.name);
            const result = toolResults[toolKey];
            const isLoading = loading[toolKey];

            return (
              <div key={toolKey} className="tool">
                <div className="tool-header">
                  <div className="tool-info">
                    <strong>{String(mcpTool.name)}</strong>
                    {mcpTool.description && (
                      <p className="tool-description">
                        {String(mcpTool.description)}
                      </p>
                    )}
                    {mcpTool.serverId && (
                      <small className="tool-server">
                        Server: {String(mcpTool.serverId)}
                      </small>
                    )}
                  </div>
                  <button
                    onClick={() =>
                      callTool(
                        String(mcpTool.name),
                        mcpTool.serverId ? String(mcpTool.serverId) : undefined,
                        mcpTool.inputSchema
                      )
                    }
                    disabled={isLoading || !isConnected}
                    className="test-btn"
                  >
                    {isLoading ? "Running..." : "Run Tool"}
                  </button>
                </div>

                {renderToolInputs(mcpTool)}
                {renderToolResult(result)}
              </div>
            );
          })
        )}
      </div>

      <div className="section">
        <h2>Debug</h2>
        <details>
          <summary>View MCP State</summary>
          <pre className="debug-info">{JSON.stringify(mcpState, null, 2)}</pre>
        </details>
        <details>
          <summary>Session Info</summary>
          <pre className="debug-info">
            {JSON.stringify(
              {
                sessionId,
                isConnected,
                agentHost: agent.host,
                timestamp: new Date().toISOString(),
              },
              null,
              2
            )}
          </pre>
        </details>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
