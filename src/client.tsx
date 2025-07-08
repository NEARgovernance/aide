import { useAgent } from "agents/react";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import type { MCPServersState } from "agents";
import { agentFetch } from "agents/client";
import { nanoid } from "nanoid";

let sessionId = localStorage.getItem("sessionId");
if (!sessionId) {
  sessionId = nanoid(8);
  localStorage.setItem("sessionId", sessionId);
}
// TODO: clear sessionId on logout

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const mcpUrlInputRef = useRef<HTMLInputElement>(null);
  const mcpNameInputRef = useRef<HTMLInputElement>(null);
  const [mcpState, setMcpState] = useState<MCPServersState>({
    prompts: [],
    resources: [],
    servers: {},
    tools: [],
  });
  const [toolResults, setToolResults] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const agent = useAgent({
    agent: "my-agent",
    name: sessionId!,
    host:
      window.location.hostname === "localhost"
        ? "http://localhost:8787"
        : window.location.origin,
    onClose: () => setIsConnected(false),
    onMcpUpdate: (mcpServers: MCPServersState) => {
      setMcpState(mcpServers);
    },
    onOpen: () => setIsConnected(true),
  });

  console.log("Configured host:", agent.host);
  console.log("Full agent object:", agent);

  function openPopup(authUrl: string) {
    window.open(
      authUrl,
      "popupWindow",
      "width=600,height=800,resizable=yes,scrollbars=yes,toolbar=yes,menubar=no,location=no,directories=no,status=yes"
    );
  }

  const handleMcpSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!mcpUrlInputRef.current || !mcpUrlInputRef.current.value.trim()) return;
    const serverUrl = mcpUrlInputRef.current.value;

    if (!mcpNameInputRef.current || !mcpNameInputRef.current.value.trim())
      return;
    const serverName = mcpNameInputRef.current.value;
    agentFetch(
      {
        agent: "my-agent",
        host: agent.host,
        name: sessionId!,
        path: "add-mcp",
      },
      {
        body: JSON.stringify({ name: serverName, url: serverUrl }),
        method: "POST",
      }
    );
    setMcpState({
      ...mcpState,
      servers: {
        ...mcpState.servers,
        placeholder: {
          auth_url: null,
          capabilities: null,
          instructions: null,
          name: serverName,
          server_url: serverUrl,
          state: "connecting",
        },
      },
    });

    // Clear form inputs
    mcpUrlInputRef.current.value = "";
    mcpNameInputRef.current.value = "";
  };

  const removeMcpServer = async (serverId: string) => {
    try {
      await agentFetch(
        {
          agent: "my-agent",
          host: agent.host,
          name: sessionId!,
          path: "remove-mcp",
        },
        {
          body: JSON.stringify({ serverId }),
          method: "POST",
        }
      );
    } catch (err) {
      console.error("Failed to remove server:", err);
    }
  };

  const callTool = async (
    toolName: string,
    args: any = {},
    serverId: string
  ) => {
    const toolKey = `${toolName}-${serverId}`;
    setLoading((prev) => ({ ...prev, [toolKey]: true }));

    try {
      const response = await agentFetch(
        {
          agent: "my-agent",
          host: agent.host,
          name: sessionId!,
          path: "call-tool",
        },
        {
          body: JSON.stringify({ toolName, args, serverId }),
          method: "POST",
        }
      );

      const result = await response.json();
      setToolResults((prev) => ({ ...prev, [toolKey]: result }));
    } catch (error: any) {
      setToolResults((prev) => ({
        ...prev,
        [toolKey]: { error: error.message },
      }));
    } finally {
      setLoading((prev) => ({ ...prev, [toolKey]: false }));
    }
  };

  const getDefaultArgs = (tool: any) => {
    const schema = tool.inputSchema;
    const args: any = {};

    if (schema?.properties) {
      Object.entries(schema.properties).forEach(
        ([key, prop]: [string, any]) => {
          if (prop.default !== undefined) {
            args[key] = prop.default;
          } else if (schema.required?.includes(key)) {
            // Provide sample values for required fields
            if (key === "query") args[key] = "governance";
            if (key === "id") args[key] = "1";
          }
        }
      );
    }

    return args;
  };

  return (
    <div className="container">
      <div className="status-indicator">
        <div className={`status-dot ${isConnected ? "connected" : ""}`} />
        {isConnected ? "Connected to server" : "Disconnected"}
      </div>

      <div className="mcp-servers">
        <form className="mcp-form" onSubmit={handleMcpSubmit}>
          <input
            type="text"
            ref={mcpNameInputRef}
            className="mcp-input name"
            placeholder="MCP Server Name"
          />
          <input
            type="text"
            ref={mcpUrlInputRef}
            className="mcp-input url"
            placeholder="MCP Server URL"
          />
          <button type="submit">Add MCP Server</button>
        </form>
      </div>

      <div className="mcp-section">
        <h2>MCP Servers</h2>
        {Object.entries(mcpState.servers).map(([id, server]) => (
          <div key={id} className={"mcp-server"}>
            <div>
              <b>{String(server.name)}</b>{" "}
              <span>({String(server.server_url)})</span>
              <div className="status-indicator">
                <div
                  className={`status-dot ${
                    String(server.state) === "ready" ? "connected" : ""
                  }`}
                />
                {String(server.state)} (id: {String(id)})
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: "10px",
                alignItems: "center",
                marginTop: "10px",
              }}
            >
              {String(server.state) === "authenticating" && server.auth_url && (
                <button
                  type="button"
                  onClick={() => openPopup(String(server.auth_url))}
                >
                  Authorize
                </button>
              )}
              {String(server.state) === "ready" && (
                <button
                  type="button"
                  onClick={() => removeMcpServer(String(id))}
                  style={{
                    padding: "6px 12px",
                    background: "#d63031",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="messages-section">
        <h2>Server Data</h2>
        <h3>Tools</h3>
        {mcpState.tools.map((tool) => {
          const toolKey = `${String(tool.name)}-${String(tool.serverId)}`;
          const result = toolResults[toolKey];
          const isLoading = loading[toolKey];

          return (
            <div
              key={toolKey}
              style={{
                marginBottom: "20px",
                border: "1px solid #ddd",
                padding: "15px",
                borderRadius: "8px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: "10px",
                }}
              >
                <div style={{ flex: 1 }}>
                  <b>{String(tool.name)}</b>
                  {tool.description && (
                    <p
                      style={{
                        margin: "5px 0",
                        color: "#666",
                        fontSize: "14px",
                      }}
                    >
                      {String(tool.description)}
                    </p>
                  )}
                  <span
                    style={{
                      fontSize: "12px",
                      background: "#e74c3c",
                      color: "white",
                      padding: "2px 6px",
                      borderRadius: "3px",
                    }}
                  >
                    Server: {String(tool.serverId)}
                  </span>
                </div>
                <button
                  onClick={() =>
                    callTool(
                      String(tool.name),
                      getDefaultArgs(tool),
                      String(tool.serverId)
                    )
                  }
                  disabled={isLoading}
                  style={{
                    padding: "8px 16px",
                    background: isLoading ? "#bdc3c7" : "#00b894",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: isLoading ? "not-allowed" : "pointer",
                    marginLeft: "15px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {isLoading ? "Testing..." : "Test Tool"}
                </button>
              </div>

              {/* Tool Result */}
              {result && (
                <div
                  style={{
                    marginBottom: "10px",
                    padding: "10px",
                    background: result.error ? "#ffe6e6" : "#e8f5e8",
                    borderRadius: "4px",
                    border: result.error
                      ? "1px solid #ff7675"
                      : "1px solid #00b894",
                  }}
                >
                  <strong>{result.error ? "Error:" : "Result:"}</strong>
                  <pre
                    style={{
                      margin: "5px 0 0 0",
                      fontSize: "12px",
                      whiteSpace: "pre-wrap",
                      maxHeight: "300px",
                      overflow: "auto",
                    }}
                  >
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              )}

              <details>
                <summary style={{ cursor: "pointer", fontWeight: "bold" }}>
                  Tool Schema
                </summary>
                <pre className="code" style={{ marginTop: "10px" }}>
                  {JSON.stringify(tool, null, 2)}
                </pre>
              </details>
            </div>
          );
        })}

        <h3>Prompts</h3>
        {mcpState.prompts.length === 0 ? (
          <p style={{ color: "#666", fontStyle: "italic" }}>
            No prompts available
          </p>
        ) : (
          mcpState.prompts.map((prompt) => (
            <div
              key={`${prompt.name}-${String(prompt.serverId)}`}
              style={{
                marginBottom: "15px",
                border: "1px solid #ddd",
                padding: "10px",
                borderRadius: "6px",
              }}
            >
              <b>{String(prompt.name)}</b>
              <span
                style={{
                  fontSize: "12px",
                  background: "#6c5ce7",
                  color: "white",
                  padding: "2px 6px",
                  borderRadius: "3px",
                  marginLeft: "10px",
                }}
              >
                Server: {String(prompt.serverId)}
              </span>
              <pre className="code">{JSON.stringify(prompt, null, 2)}</pre>
            </div>
          ))
        )}

        <h3>Resources</h3>
        {mcpState.resources.length === 0 ? (
          <p style={{ color: "#666", fontStyle: "italic" }}>
            No resources available
          </p>
        ) : (
          mcpState.resources.map((resource) => (
            <div
              key={`${resource.name}-${String(resource.serverId)}`}
              style={{
                marginBottom: "15px",
                border: "1px solid #ddd",
                padding: "10px",
                borderRadius: "6px",
              }}
            >
              <b>{String(resource.name)}</b>
              <span
                style={{
                  fontSize: "12px",
                  background: "#a29bfe",
                  color: "white",
                  padding: "2px 6px",
                  borderRadius: "3px",
                  marginLeft: "10px",
                }}
              >
                Server: {String(resource.serverId)}
              </span>
              <div style={{ fontSize: "14px", color: "#666", margin: "5px 0" }}>
                URI: {String(resource.uri)}
              </div>
              <pre className="code">{JSON.stringify(resource, null, 2)}</pre>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
