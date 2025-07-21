export interface Proposal {
  id: number;
  title: string;
  description: string;
  status: string;
  proposer_id: string;
  voting_options?: string[];
  voting_ends?: string;
  votes_for?: number;
  votes_against?: number;
  link?: string;
}

export interface Discussion {
  id: number;
  title: string;
  excerpt: string;
  posts_count: number;
  views: number;
  type: string;
  last_activity?: string;
  url?: string;
}

export interface QueryResponse {
  message: string;
  proposals: Proposal[];
  discussions: Discussion[];
  confidence: number;
  analysis?: string;
}

export interface ChatMessage {
  id: string;
  type: "user" | "assistant" | "system" | "tool" | "event";
  content: string;
  timestamp: Date;
  data?: QueryResponse;
}

export interface AGUIEvent {
  type: string;
  [key: string]: any;
}

export interface ForumSentiment {
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
