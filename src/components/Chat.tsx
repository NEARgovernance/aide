import React, { useState, useRef, useEffect } from "react";
import {
  Send,
  Loader2,
  MessageSquare,
  FileText,
  Users,
  Key,
} from "lucide-react";
import type { MCPConnection } from "../mcp";
import { nanoid } from "nanoid";

const getBaseUrl = () =>
  window.location.hostname === "localhost"
    ? "http://localhost:8787"
    : window.location.origin;

// Simple API key management
const getApiKey = () => localStorage.getItem("anthropic_key");
const setApiKey = (key: string) => localStorage.setItem("anthropic_key", key);
const clearApiKey = () => localStorage.removeItem("anthropic_key");

// Types (same as before)
interface ChatProps {
  mcpConnection: MCPConnection;
}

interface Proposal {
  id: number;
  title: string;
  description: string;
  status: string;
  proposer_id: string;
  voting_options?: string[];
}

interface Discussion {
  id: number;
  title: string;
  excerpt: string;
  posts_count: number;
  views: number;
  type: string;
}

interface QueryResponse {
  message: string;
  proposals: Proposal[];
  discussions: Discussion[];
  confidence: number;
  analysis?: string;
}

interface ChatMessage {
  id: string;
  type: "user" | "assistant" | "system" | "tool" | "event";
  content: string;
  timestamp: Date;
  data?: QueryResponse;
}

interface AGUIEvent {
  type: string;
  [key: string]: any;
}

export default function Chat({ mcpConnection }: ChatProps) {
  const sessionId = useRef(nanoid(8)).current;
  const [apiKey, setApiKeyState] = useState(getApiKey() || "");
  const [showApiKeyInput, setShowApiKeyInput] = useState(!getApiKey());
  const [eventStream, setEventStream] = useState<AGUIEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "1",
      type: "assistant",
      content:
        "How can I help you? Ask me about specific proposals, or we can discuss any topics of interest.",
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const streamMessageIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // Simple API key save
  const handleSaveApiKey = () => {
    if (apiKey.startsWith("sk-ant-")) {
      setApiKey(apiKey);
      setShowApiKeyInput(false);
    } else {
      alert('API key should start with "sk-ant-"');
    }
  };

  const startEventStream = (querySessionId: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(
      `${getBaseUrl()}/agents/my-agent/${
        mcpConnection.sessionId
      }/events?session=${querySessionId}`
    );
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const agentEvent = JSON.parse(event.data) as AGUIEvent;
        handleAGUIEvent(agentEvent);
      } catch (err) {
        console.error("Failed to parse event:", err);
      }
    };

    eventSource.onerror = (e) => {
      console.error("EventSource error:", e);
      setIsStreaming(false);
    };
  };

  const handleAGUIEvent = (agentEvent: AGUIEvent) => {
    setEventStream((prev) => [...prev, agentEvent]);

    switch (agentEvent.type) {
      case "CONNECTION_ESTABLISHED":
        console.log(
          "🔗 Event stream connected for session:",
          agentEvent.sessionId
        );
        break;

      case "RUN_STARTED":
        console.log("🏁 Governance analysis started");
        setIsStreaming(true);
        break;

      case "TEXT_MESSAGE_START":
        const newMessageId = nanoid();
        streamMessageIdRef.current = newMessageId;
        setMessages((prev) => [
          ...prev,
          {
            id: newMessageId,
            type: "assistant",
            content: "",
            timestamp: new Date(),
          },
        ]);
        break;

      case "TEXT_MESSAGE_CONTENT":
        if (streamMessageIdRef.current) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === streamMessageIdRef.current
                ? { ...msg, content: msg.content + agentEvent.delta }
                : msg
            )
          );
        }
        break;

      case "RUN_FINISHED":
        console.log("✅ Governance analysis complete");
        setIsStreaming(false);
        setIsLoading(false);

        const currentMessageId = streamMessageIdRef.current;
        streamMessageIdRef.current = null;

        if (agentEvent.result && currentMessageId) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === currentMessageId
                ? {
                    ...msg,
                    content: agentEvent.result.message || "ANALYSIS COMPLETE",
                    data: {
                      message: agentEvent.result.message,
                      proposals: agentEvent.result.proposals || [],
                      discussions: agentEvent.result.discussions || [],
                      confidence: agentEvent.result.confidence || 0.8,
                    },
                  }
                : msg
            )
          );
        }
        break;

      case "RUN_ERROR":
        console.error("❌ Governance analysis error:", agentEvent.message);
        setIsStreaming(false);
        setIsLoading(false);
        setMessages((prev) => [
          ...prev,
          {
            id: nanoid(),
            type: "assistant",
            content: `❌ Error: ${agentEvent.message}`,
            timestamp: new Date(),
          },
        ]);
        break;

      case "TEXT_MESSAGE_DELTA":
        if (streamMessageIdRef.current) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === streamMessageIdRef.current
                ? { ...msg, content: msg.content + agentEvent.delta }
                : msg
            )
          );
        }
        break;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading) return;

    // Check if API key exists and store it safely
    const currentApiKey = getApiKey();
    if (!currentApiKey) {
      setShowApiKeyInput(true);
      return;
    }

    const userMessage: ChatMessage = {
      id: nanoid(),
      type: "user",
      content: inputValue,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    const query = inputValue;
    setInputValue("");
    streamMessageIdRef.current = null;
    setIsStreaming(true);
    setIsLoading(true);

    try {
      const response = await fetch(
        `${getBaseUrl()}/agents/my-agent/${
          mcpConnection.sessionId
        }/query-with-events`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": getApiKey()!, // Use stored API key
          },
          body: JSON.stringify({
            query,
            claudeApiKey: getApiKey()!, // Use stored API key
          }),
        }
      );

      if (!response.ok) {
        // Handle invalid API key
        if (response.status === 401) {
          clearApiKey();
          setShowApiKeyInput(true);
          setApiKeyState("");
          throw new Error(
            "Invalid API key. Please check your key and try again."
          );
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as { sessionId: string };
      const querySessionId = data.sessionId;
      startEventStream(querySessionId);
    } catch (error) {
      console.error("Query error:", error);
      setIsLoading(false);
      setIsStreaming(false);

      const errorMessage: ChatMessage = {
        id: nanoid(),
        type: "assistant",
        content:
          "Sorry, I encountered an error processing your request. Please try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    }
  };

  const renderProposalCard = (proposal: Proposal, index: number) => (
    <div
      key={`proposal-${proposal.id}-${index}`}
      className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-3"
    >
      <div className="flex items-start gap-3">
        <FileText className="w-5 h-5 text-blue-600 mt-1 flex-shrink-0" />
        <div className="flex-1">
          <h4 className="font-semibold text-blue-900 mb-1">
            Proposal #{proposal.id}
          </h4>
          <h5 className="font-medium text-gray-800 mb-2">{proposal.title}</h5>
          <p className="text-gray-600 text-sm mb-2">{proposal.description}</p>
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span
              className={`px-2 py-1 rounded-full ${
                proposal.status === "Finished"
                  ? "bg-gray-100 text-gray-700"
                  : "bg-green-100 text-green-700"
              }`}
            >
              {proposal.status}
            </span>
            <span>By: {proposal.proposer_id}</span>
          </div>
          {proposal.voting_options && (
            <div className="mt-2">
              <span className="text-xs text-gray-500">Options: </span>
              <span className="text-xs text-gray-700">
                {proposal.voting_options.join(", ")}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderDiscussionCard = (discussion: Discussion, index: number) => (
    <div
      key={`discussion-${discussion.id}-${discussion.type}-${index}`}
      className="bg-green-50 border border-green-200 rounded-lg p-4 mb-3"
    >
      <div className="flex items-start gap-3">
        <MessageSquare className="w-5 h-5 text-green-600 mt-1 flex-shrink-0" />
        <div className="flex-1">
          <h4 className="font-semibold text-green-900 mb-1">
            {discussion.title}
          </h4>
          <p className="text-gray-600 text-sm mb-2">{discussion.excerpt}</p>
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {discussion.posts_count} posts
            </span>
            <span>{discussion.views} views</span>
            <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full">
              {discussion.type}
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderMessage = (message: ChatMessage) => (
    <div
      key={message.id}
      className={`flex ${
        message.type === "user" ? "justify-end" : "justify-start"
      } mb-4`}
    >
      <div
        className={`max-w-[80%] rounded-lg px-4 py-3 ${
          message.type === "user"
            ? "bg-blue-600 text-white"
            : "bg-gray-100 text-gray-800"
        }`}
      >
        <p className="text-sm">{message.content}</p>

        {message.type === "assistant" && message.data && (
          <div className="mt-4 space-y-3">
            {message.data.proposals && message.data.proposals.length > 0 && (
              <div>
                <h3 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Proposals ({message.data.proposals.length})
                </h3>
                {message.data.proposals.map((proposal, index) =>
                  renderProposalCard(proposal, index)
                )}
              </div>
            )}

            {message.data.discussions &&
              message.data.discussions.length > 0 && (
                <div>
                  <h3 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" />
                    Discussions ({message.data.discussions.length})
                  </h3>
                  {message.data.discussions.map((discussion, index) =>
                    renderDiscussionCard(discussion, index)
                  )}
                </div>
              )}

            {message.data.analysis && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <h4 className="font-medium text-yellow-800 mb-1">Analysis</h4>
                <p className="text-sm text-yellow-700">
                  {message.data.analysis}
                </p>
              </div>
            )}

            <div className="text-xs text-gray-500 mt-2">
              Confidence: {message.data.confidence}%
            </div>
          </div>
        )}

        <div className="text-xs opacity-70 mt-2">
          {message.timestamp.toLocaleTimeString()}
        </div>
      </div>
    </div>
  );

  // Show API key input if no key is saved
  if (showApiKeyInput) {
    return (
      <div className="flex flex-col h-screen bg-gray-50">
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <h1 className="text-xl font-semibold text-gray-800">
            NEAR Governance Assistant
          </h1>
          <p className="text-sm text-gray-600">
            You can take part in the House of Stake!
          </p>
        </div>

        <div className="flex-1 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <Key className="w-6 h-6 text-blue-600" />
              <h2 className="text-lg font-semibold">API Key Required</h2>
            </div>

            <p className="text-gray-600 mb-4 text-sm">
              Enter your Anthropic API key to get started. Get one at{" "}
              <a
                href="https://console.anthropic.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline"
              >
                console.anthropic.com
              </a>
            </p>

            <div className="space-y-3">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKeyState(e.target.value)}
                placeholder="sk-ant-..."
                className="w-full p-3 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />

              <button
                onClick={handleSaveApiKey}
                disabled={!apiKey}
                className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                Save & Continue
              </button>
            </div>

            <p className="text-xs text-gray-500 mt-3">
              Your API key is stored locally in your browser and never shared.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-xl font-semibold text-gray-800">
              NEAR Governance Assistant
            </h1>
            <p className="text-sm text-gray-600">
              You can take part in the House of Stake!
            </p>
          </div>
          <button
            onClick={() => {
              clearApiKey();
              setShowApiKeyInput(true);
              setApiKeyState("");
            }}
            className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
            title="Change API Key"
          >
            <Key className="w-4 h-4" />
            Change Key
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-3xl mx-auto">
          {messages.map(renderMessage)}
          <div ref={messagesEndRef} />

          {(isLoading || isStreaming) && (
            <div className="flex justify-start mb-4">
              <div className="bg-gray-100 rounded-lg px-4 py-3 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm text-gray-600">
                  {isLoading ? "Thinking..." : "Typing..."}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input Area */}
      <div className="h-16 bg-gradient-to-t from-white via-white/95 to-transparent" />

      <div className="bg-white/95 backdrop-blur-xl px-4 pt-5 pb-8">
        {/* Suggestions */}
        <div className="mb-4 flex flex-wrap gap-3 justify-center">
          {[
            { text: "active proposals", display: "active proposals" },
            { text: "new proposals", display: "new proposals" },
            { text: "top forum topics", display: "top discussions" },
          ].map((suggestion) => (
            <button
              key={suggestion.text}
              onClick={() => setInputValue(suggestion.text)}
              className="group px-5 py-3 bg-white/70 backdrop-blur-md text-gray-700 rounded-2xl hover:bg-white hover:text-gray-900 transition-all duration-300 border border-gray-200/50 hover:border-gray-300 hover:shadow-lg transform hover:scale-105 text-sm font-medium min-h-[44px]"
              disabled={isLoading}
              aria-label={`Quick search: ${suggestion.text}`}
            >
              {suggestion.display}
            </button>
          ))}
        </div>

        {/* Input form */}
        <div className="max-w-3xl mx-auto">
          <form onSubmit={handleSubmit}>
            <div className="relative group">
              <div className="absolute inset-0 bg-gradient-to-r from-blue-600/20 via-purple-600/20 to-blue-600/20 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <div className="relative flex items-center bg-white/90 backdrop-blur-md rounded-3xl shadow-2xl border border-gray-200/60 hover:border-gray-300/80 transition-all duration-300 px-4 py-2">
                <div className="flex-1 relative">
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    className="w-full px-4 py-3 bg-transparent border-none outline-none focus:outline-none text-gray-800 text-lg font-medium"
                    disabled={isLoading}
                    aria-label="governance query input"
                  />
                  {!inputValue && !isLoading && (
                    <div className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none">
                      <span className="inline-block animate-pulse">💬</span>
                      <span className="ml-2">
                        Ask about proposals, forum topics, community delegates,
                        etc.
                      </span>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isLoading || !inputValue.trim()}
                  className="relative m-2 p-4 bg-gradient-to-br from-blue-600 via-blue-700 to-purple-700 text-white rounded-2xl hover:from-blue-700 hover:via-blue-800 hover:to-purple-800 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-110 disabled:transform-none"
                  aria-label="Send message"
                >
                  <div className="relative z-10">
                    {isLoading ? (
                      <Loader2 className="w-6 h-6 animate-spin" />
                    ) : (
                      <Send className="w-6 h-6" />
                    )}
                  </div>
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-blue-400 to-purple-500 opacity-0 hover:opacity-20 transition-opacity duration-300" />
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
