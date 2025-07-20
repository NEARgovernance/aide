import { useRef, useState } from "react";
import { useMCPConnection, type MCPTool } from "../mcp";

interface ToolInput {
  [key: string]: any;
}

interface MCPServerWithError {
  name: string;
  state: string;
  error?: string;
  type?: string;
}

export default function Toolbox() {
  const agentIdInputRef = useRef<HTMLInputElement>(null);
  const discourseUrlRef = useRef<HTMLInputElement>(null);
  const discourseApiKeyRef = useRef<HTMLInputElement>(null);
  const [toolResults, setToolResults] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [toolInputs, setToolInputs] = useState<Record<string, ToolInput>>({});
  const [activeTab, setActiveTab] = useState<"bitte" | "discourse">("bitte");
  const [connectionStatus, setConnectionStatus] = useState<string>("");

  const mcpConnection = useMCPConnection();

  const handleAddBitteConnection = async (
    e: React.FormEvent<HTMLFormElement>
  ) => {
    e.preventDefault();
    if (!agentIdInputRef.current || !agentIdInputRef.current.value.trim())
      return;

    const serverUrl = agentIdInputRef.current.value.trim();
    const urlParams = new URLSearchParams(serverUrl.split("?")[1] || "");
    const agentId = urlParams.get("agentId") || "Unknown Agent";
    const serverName = `Bitte Agent: ${agentId}`;

    setConnectionStatus(`Connecting to ${agentId}...`);

    try {
      await mcpConnection.addMCPServer(serverName, serverUrl, "bitte");
      if (agentIdInputRef.current) agentIdInputRef.current.value = "";
      setConnectionStatus(`✅ Successfully added ${agentId}`);
      setTimeout(() => setConnectionStatus(""), 3000);
    } catch (error: any) {
      setConnectionStatus(`❌ Failed to add ${agentId}: ${error.message}`);
      setTimeout(() => setConnectionStatus(""), 5000);
    }
  };

  const handleAddDiscourseConnection = async (
    e: React.FormEvent<HTMLFormElement>
  ) => {
    e.preventDefault();
    if (!discourseUrlRef.current || !discourseUrlRef.current.value.trim())
      return;

    const serverUrl = discourseUrlRef.current.value.trim();
    setConnectionStatus("Connecting to NEAR Discourse...");

    try {
      await mcpConnection.addMCPServer("NEAR Discourse", serverUrl, "direct");
      if (discourseUrlRef.current) discourseUrlRef.current.value = "";
      if (discourseApiKeyRef.current) discourseApiKeyRef.current.value = "";
      setConnectionStatus("✅ Successfully added NEAR Discourse");
      setTimeout(() => setConnectionStatus(""), 3000);
    } catch (error: any) {
      setConnectionStatus(`❌ Failed to add Discourse: ${error.message}`);
      setTimeout(() => setConnectionStatus(""), 5000);
    }
  };

  const handleToolInputChange = (
    toolName: string,
    field: string,
    value: any
  ) => {
    setToolInputs((prev) => ({
      ...prev,
      [toolName]: {
        ...prev[toolName],
        [field]: value,
      },
    }));
  };

  const executeTool = async (tool: MCPTool) => {
    const toolName = tool.name;
    const input = toolInputs[toolName] || {};

    const serverId =
      tool.serverId || Object.keys(mcpConnection.mcpState.servers)[0] || "";

    setLoading((prev) => ({ ...prev, [toolName]: true }));
    try {
      const result = await mcpConnection.callTool(toolName, serverId, input);
      setToolResults((prev) => ({ ...prev, [toolName]: result }));
    } catch (error: any) {
      setToolResults((prev) => ({
        ...prev,
        [toolName]: { error: error.message },
      }));
    } finally {
      setLoading((prev) => ({ ...prev, [toolName]: false }));
    }
  };

  const renderToolForm = (tool: MCPTool) => {
    const toolName = tool.name;
    const inputSchema = tool.inputSchema?.properties || {};
    const inputValues = toolInputs[toolName] || {};

    return (
      <div key={toolName} className="p-4 border rounded mb-4">
        <h4 className="font-semibold mb-2">{toolName}</h4>
        <p className="text-sm text-gray-600 mb-2">{tool.description}</p>
        <div className="space-y-2">
          {Object.entries(inputSchema).map(([key, schema]) => (
            <input
              key={key}
              className="w-full p-2 border rounded"
              type="text"
              placeholder={
                (schema as { description?: string })?.description || key
              }
              value={inputValues[key] || ""}
              onChange={(e) =>
                handleToolInputChange(toolName, key, e.target.value)
              }
            />
          ))}
        </div>
        <button
          className="mt-3 px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
          onClick={() => executeTool(tool)}
          disabled={loading[toolName]}
        >
          {loading[toolName] ? "Running..." : "Run Tool"}
        </button>
        {toolResults[toolName] && (
          <pre className="mt-3 p-2 bg-gray-100 rounded text-sm overflow-x-auto">
            {JSON.stringify(toolResults[toolName], null, 2)}
          </pre>
        )}
      </div>
    );
  };

  const renderTab = () => {
    return (
      <div className="space-y-6">
        {mcpConnection.mcpState.tools.map((tool) => renderToolForm(tool))}
      </div>
    );
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">MCP Tool Testing</h2>

      <div className="flex gap-4 mb-6">
        <button
          onClick={() => setActiveTab("bitte")}
          className={`px-4 py-2 rounded ${
            activeTab === "bitte" ? "bg-blue-600 text-white" : "bg-gray-200"
          }`}
        >
          Add Bitte Agent
        </button>
        <button
          onClick={() => setActiveTab("discourse")}
          className={`px-4 py-2 rounded ${
            activeTab === "discourse" ? "bg-blue-600 text-white" : "bg-gray-200"
          }`}
        >
          Add Discourse Server
        </button>
      </div>

      {activeTab === "bitte" && (
        <form onSubmit={handleAddBitteConnection} className="mb-6">
          <input
            ref={agentIdInputRef}
            type="text"
            placeholder="Bitte MCP Server URL"
            className="w-full p-2 border rounded mb-2"
          />
          <button className="px-4 py-2 bg-green-600 text-white rounded">
            Add Bitte Agent
          </button>
        </form>
      )}

      {activeTab === "discourse" && (
        <form onSubmit={handleAddDiscourseConnection} className="mb-6">
          <input
            ref={discourseUrlRef}
            type="text"
            placeholder="Discourse MCP Server URL"
            className="w-full p-2 border rounded mb-2"
          />
          <button className="px-4 py-2 bg-green-600 text-white rounded">
            Add Discourse Server
          </button>
        </form>
      )}

      {connectionStatus && (
        <div className="mb-4 text-sm text-gray-700">{connectionStatus}</div>
      )}

      <hr className="my-6" />

      {renderTab()}
    </div>
  );
}
