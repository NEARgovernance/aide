import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Settings, Bot, Wrench } from "lucide-react";
import { useMCPConnection } from "./mcp";
import Chat from "./components/Chat";
import Toolbox from "./components/Toolbox";
import "./styles.css";

type AppMode = "agent" | "tools";

const AppContent: React.FC = () => {
  const [currentMode, setCurrentMode] = useState<AppMode>("agent");
  const [showModeSelector, setShowModeSelector] = useState(false);
  const mcpConnection = useMCPConnection();

  const modes = [
    {
      id: "agent" as AppMode,
      name: "Agent",
      icon: Bot,
      description: "LLM-based proposal interactions",
      component: Chat,
    },
    {
      id: "tools" as AppMode,
      name: "Tools",
      icon: Wrench,
      description: "MCP server testing for development",
      component: Toolbox,
    },
  ];

  const currentModeConfig = modes.find((mode) => mode.id === currentMode)!;
  const CurrentComponent = currentModeConfig.component;

  const renderModeSelector = () => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-900">Choose Interface</h2>
          <button
            onClick={() => setShowModeSelector(false)}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3">
          {modes.map((mode) => {
            const Icon = mode.icon;
            return (
              <button
                key={mode.id}
                onClick={() => {
                  setCurrentMode(mode.id);
                  setShowModeSelector(false);
                }}
                className={`w-full p-4 rounded-lg border-2 transition-all text-left ${
                  currentMode === mode.id
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-start gap-3">
                  <Icon
                    className={`w-6 h-6 mt-1 ${
                      currentMode === mode.id
                        ? "text-blue-600"
                        : "text-gray-600"
                    }`}
                  />
                  <div>
                    <h3
                      className={`font-semibold ${
                        currentMode === mode.id
                          ? "text-blue-900"
                          : "text-gray-900"
                      }`}
                    >
                      {mode.name}
                    </h3>
                    <p
                      className={`text-sm ${
                        currentMode === mode.id
                          ? "text-blue-700"
                          : "text-gray-600"
                      }`}
                    >
                      {mode.description}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-6 p-4 bg-gray-50 rounded-lg">
          <h4 className="font-medium text-gray-900 mb-2">Connection Status</h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span>MCP Connection:</span>
              <span
                className={
                  mcpConnection.isConnected ? "text-green-600" : "text-red-600"
                }
              >
                {mcpConnection.isConnected ? "Connected" : "Disconnected"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Connected Servers:</span>
              <span className="text-gray-600">
                {Object.keys(mcpConnection.mcpState.servers).length}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Available Tools:</span>
              <span className="text-gray-600">
                {mcpConnection.mcpState.tools.length}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderModeIndicator = () => {
    const Icon = currentModeConfig.icon;
    return (
      <div className="fixed top-4 right-4 bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-sm z-30">
        <div className="flex items-center gap-2 text-sm">
          <Icon className="w-4 h-4 text-gray-600" />
          <span className="text-gray-900 font-medium">
            {currentModeConfig.name}
          </span>
          <button
            onClick={() => setShowModeSelector(true)}
            className="text-gray-400 hover:text-gray-600 ml-1"
          >
            <Settings className="w-3 h-3" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="relative">
      <CurrentComponent mcpConnection={mcpConnection} />
      {renderModeIndicator()}
      {showModeSelector && renderModeSelector()}
    </div>
  );
};

const App: React.FC = () => {
  return <AppContent />;
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);

export default App;
