import React, { useState, useEffect } from "react";
import {
  FileText,
  MessageSquare,
  TrendingUp,
  AlertTriangle,
  Users,
  Brain,
  Loader2,
  ExternalLink,
  Plus,
} from "lucide-react";
import type { MCPConnection } from "../mcp";
import type { Proposal } from "../types/index";

// Add the base URL function
const getBaseUrl = () =>
  window.location.hostname === "localhost"
    ? "http://localhost:8787"
    : window.location.origin;

// Get API key from localStorage
const getApiKey = () => localStorage.getItem("anthropic_key");

interface ProposalCardProps {
  proposal: Proposal;
  mcpConnection: MCPConnection;
  onAGUIEvent: (event: any) => void;
  index: number;
  sentimentData?: any;
}

interface ForumSentiment {
  overall: "positive" | "negative" | "neutral" | "mixed";
  score: number; // 0-100
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

const ProposalCard: React.FC<ProposalCardProps> = ({
  proposal,
  mcpConnection,
  onAGUIEvent,
  index,
  sentimentData,
}) => {
  const [sentiment, setSentiment] = useState<ForumSentiment>({
    overall: "neutral",
    score: 0,
    postsCount: 0,
    trends: { support: 0, concerns: 0, questions: 0 },
    topConcerns: [],
    keySupport: [],
    isLoading: true,
  });

  const [lastUpdate, setLastUpdate] = useState(new Date());

  // Auto-load sentiment analysis when card appears
  useEffect(() => {
    loadForumSentiment();

    // Refresh every 2 minutes
    const interval = setInterval(loadForumSentiment, 120000);
    return () => clearInterval(interval);
  }, [proposal.id]);

  useEffect(() => {
    if (sentimentData) {
      setSentiment(sentimentData);
      setLastUpdate(new Date());
    }
  }, [sentimentData]);

  const loadForumSentiment = async () => {
    setSentiment((prev) => ({ ...prev, isLoading: true }));

    try {
      onAGUIEvent({
        type: "CUSTOM",
        name: "SENTIMENT_ANALYSIS_REQUESTED",
        value: {
          proposalId: proposal.id,
          analysisType: "forum_sentiment",
          timestamp: Date.now(),
        },
      });

      const response = await fetch(
        `${getBaseUrl()}/agents/my-agent/${
          mcpConnection.sessionId
        }/query-with-events`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": getApiKey()!,
          },
          body: JSON.stringify({
            scope: "proposal",
            proposalId: proposal.id,
            proposalTitle: proposal.title,
            claudeApiKey: getApiKey(),
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error("Failed to load sentiment:", error);
      setSentiment((prev) => ({ ...prev, isLoading: false }));
    }
  };

  const getSentimentColor = (overall: string, score: number) => {
    switch (overall) {
      case "positive":
        return "text-green-700 bg-green-50 border-green-200";
      case "negative":
        return "text-red-700 bg-red-50 border-red-200";
      case "mixed":
        return "text-yellow-700 bg-yellow-50 border-yellow-200";
      default:
        return "text-gray-700 bg-gray-50 border-gray-200";
    }
  };

  const getSentimentIcon = (overall: string) => {
    switch (overall) {
      case "positive":
        return "😊";
      case "negative":
        return "😟";
      case "mixed":
        return "🤔";
      default:
        return "😐";
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 mb-4 hover:shadow-lg transition-all duration-300 group">
      {/* Header with Live Sentiment */}
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200 transition-colors">
            <FileText className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h4 className="font-semibold text-gray-900 text-lg">
              Proposal #{proposal.id}
            </h4>
            <p className="text-sm text-gray-600">{proposal.proposer_id}</p>
          </div>
        </div>

        {/* Live Forum Sentiment Indicator */}
        <div className="flex items-center gap-3">
          {sentiment.isLoading ? (
            <div className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-lg border">
              <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
              <span className="text-xs text-gray-600">Analyzing forum...</span>
            </div>
          ) : (
            <div
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${getSentimentColor(
                sentiment.overall,
                sentiment.score
              )}`}
            >
              <span className="text-sm">
                {getSentimentIcon(sentiment.overall)}
              </span>
              <div className="text-xs">
                <div className="font-medium">
                  {sentiment.score}% {sentiment.overall}
                </div>
                <div className="text-xs opacity-75">
                  {sentiment.postsCount} forum posts
                </div>
              </div>
            </div>
          )}

          <div className="text-xs text-gray-400">
            Updated {Math.round((Date.now() - lastUpdate.getTime()) / 60000)}m
            ago
          </div>
        </div>
      </div>

      {/* Proposal Title & Description */}
      <h5 className="font-medium text-gray-800 mb-3 text-lg leading-tight">
        {proposal.title}
      </h5>
      <p className="text-gray-600 text-sm mb-4 leading-relaxed">
        {proposal.description}
      </p>

      {/* Live Forum Insights */}
      {!sentiment.isLoading && sentiment.postsCount > 0 && (
        <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-4 mb-4 border border-blue-100">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-4 h-4 text-blue-600" />
            <span className="font-medium text-blue-800">
              Live Forum Analysis
            </span>
            <div className="ml-auto flex items-center gap-1">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-xs text-blue-600">Real-time</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-3">
            <div className="text-center">
              <div className="text-lg font-bold text-green-600">
                {sentiment.trends.support}%
              </div>
              <div className="text-xs text-gray-600">Support</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-orange-600">
                {sentiment.trends.concerns}%
              </div>
              <div className="text-xs text-gray-600">Concerns</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-blue-600">
                {sentiment.trends.questions}%
              </div>
              <div className="text-xs text-gray-600">Questions</div>
            </div>
          </div>

          {/* Top Insights */}
          {(sentiment.keySupport.length > 0 ||
            sentiment.topConcerns.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {sentiment.keySupport.length > 0 && (
                <div>
                  <div className="font-medium text-green-700 mb-1">
                    💚 Key Support Points
                  </div>
                  <ul className="space-y-1">
                    {sentiment.keySupport.slice(0, 2).map((point, idx) => (
                      <li
                        key={idx}
                        className="text-green-600 flex items-start gap-1"
                      >
                        <span>•</span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {sentiment.topConcerns.length > 0 && (
                <div>
                  <div className="font-medium text-orange-700 mb-1">
                    ⚠️ Top Concerns
                  </div>
                  <ul className="space-y-1">
                    {sentiment.topConcerns.slice(0, 2).map((concern, idx) => (
                      <li
                        key={idx}
                        className="text-orange-600 flex items-start gap-1"
                      >
                        <span>•</span>
                        <span>{concern}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Status and Metadata */}
      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span
            className={`px-3 py-1 rounded-full font-medium ${
              proposal.status === "Finished"
                ? "bg-gray-100 text-gray-700"
                : proposal.status === "Active"
                ? "bg-green-100 text-green-700"
                : "bg-blue-100 text-blue-700"
            }`}
          >
            {proposal.status}
          </span>

          {proposal.voting_options && (
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {proposal.voting_options.join(" / ")}
            </span>
          )}

          {proposal.voting_ends && (
            <span>
              Ends: {new Date(proposal.voting_ends).toLocaleDateString()}
            </span>
          )}
        </div>

        <div className="text-xs text-gray-400">ID: {proposal.id}</div>
      </div>
    </div>
  );
};

export default ProposalCard;
