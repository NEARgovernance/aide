import { Agent, type AgentNamespace, routeAgentRequest } from "agents";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { nanoid } from "nanoid";

type Env = {
  MyAgent: AgentNamespace<MyAgent>;
  HOST: string;
};

type State = {};

interface MCPServerConfig {
  name: string;
  url: string;
  type: "bitte" | "direct"; // Track server type
}

const SERVER_IDS = {
  discourse: "near-discourse",
  hos: "house-of-stake",
};

export class MyAgent extends Agent<Env, State> {
  private clients = new Map<string, Client>();
  private serverConfigs = new Map<string, MCPServerConfig>();
  private eventControllers = new Map<
    string,
    WritableStreamDefaultWriter<Uint8Array>
  >();

  private async getMcpState(): Promise<any> {
    const tools = [];
    const servers: Record<string, any> = {};

    for (const [serverName, client] of this.clients) {
      try {
        const clientTools = await client.listTools();
        tools.push(
          ...clientTools.tools.map((tool) => ({
            ...tool,
            serverId: serverName,
            serverType: this.serverConfigs.get(serverName)?.type || "unknown",
          }))
        );
        servers[serverName] = {
          name: serverName,
          state: "ready",
          type: this.serverConfigs.get(serverName)?.type || "unknown",
        };
      } catch (err) {
        servers[serverName] = {
          name: serverName,
          state: "error",
          error: (err as Error).message,
          type: this.serverConfigs.get(serverName)?.type || "unknown",
        };
      }
    }

    return { tools, servers };
  }

  private generateProposalSentimentPrompt(
    forumData: any,
    latestTopics: any,
    proposalTitle: string,
    proposalId: number
  ): string {
    return `Analyze forum sentiment for NEAR Proposal #${proposalId}: "${proposalTitle}"

Forum Search Results: ${JSON.stringify(forumData, null, 2)}

Latest Forum Topics: ${JSON.stringify(latestTopics, null, 2)}

Instructions:
- Look for posts that mention the proposal title, proposal ID, or related keywords
- Analyze sentiment patterns in the discussions
- Extract key support points and concerns
- Estimate overall community sentiment

Return JSON analysis:
{
  "overall": "positive|negative|neutral|mixed",
  "score": 0-100,
  "postsCount": number_of_relevant_posts,
  "trends": {
    "support": percentage_expressing_support,
    "concerns": percentage_expressing_concerns,
    "questions": percentage_asking_questions
  },
  "topConcerns": ["concern 1", "concern 2"],
  "keySupport": ["support point 1", "support point 2"]
}

Be realistic - if there's limited forum activity, reflect that in the analysis.`;
  }

  private generateEcosystemSentimentPrompt(
    forumData: any,
    additionalData: any
  ): string {
    return `Analyze the NEAR governance ecosystem sentiment and health:

Forum Data: ${JSON.stringify(forumData, null, 2)}
Additional Data: ${JSON.stringify(additionalData, null, 2)}

Please provide a comprehensive analysis of:
- Overall ecosystem sentiment and health
- Community engagement levels
- Governance participation trends
- Key developments and concerns
- Future outlook

Be specific about what the data shows.`;
  }

  private getProposalSentimentFallback() {
    return {
      overall: "neutral",
      score: 50,
      postsCount: 0,
      trends: { support: 33, concerns: 33, questions: 34 },
      topConcerns: ["Analysis unavailable"],
      keySupport: ["Try again later"],
    };
  }

  // FALLBACK: Ecosystem sentiment fallback
  private getEcosystemSentimentFallback() {
    return {
      overall: "neutral",
      score: 50,
      engagement_level: "medium",
      governance_health: "fair",
      key_trends: ["Analysis unavailable"],
      hot_topics: [],
      community_concerns: ["Service temporarily down"],
      positive_signals: [],
      summary: "Ecosystem sentiment analysis temporarily unavailable.",
    };
  }

  // Claude Sentiment Analysis
  async claudeAnalyzeSentiment(
    forumData: string,
    additionalData: string,
    title: string,
    proposalId: number,
    scope: "proposal" | "ecosystem",
    apiKey: string
  ) {
    if (!apiKey || !apiKey.startsWith("sk-ant-")) {
      throw new Error("Claude API key not configured or invalid");
    }

    // Find the correct client for proposal data (e.g., House of Stake server)
    const hosServer = Array.from(this.clients.keys()).find(
      (name) =>
        name.toLowerCase().includes("stake") ||
        name.toLowerCase().includes("hos") ||
        name.toLowerCase().includes("bitte")
    );
    let proposalData = null;
    if (hosServer && this.clients.has(hosServer)) {
      proposalData = await this.clients.get(hosServer)!.callTool({
        name: "getrecentproposals",
        arguments: {},
      });
    }

    const prompt =
      scope === "proposal"
        ? this.generateProposalSentimentPrompt(
            forumData,
            additionalData,
            title,
            proposalId
          )
        : this.generateEcosystemSentimentPrompt(forumData, additionalData);

    const body = {
      model: "claude-sonnet-4-20250514", // Updated model
      system:
        "You are a wise and credibly neutral governance analyst. It is currently the year 2025. Any forum posts should be treated as valid historical data.",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Summarize the ecosystem governance sentiment from this:\n\nForum Data:\n${JSON.stringify(
            forumData,
            null,
            2
          )}\n\nProposal Data:\n${JSON.stringify(
            proposalData,
            null,
            2
          )}\n\nAdditional Data:\n${JSON.stringify(additionalData, null, 2)}`,
        },
      ],
    };

    try {
      let response: Response | undefined = undefined;
      let retries = 3;

      for (let i = 0; i < retries; i++) {
        response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(body),
        });

        if (response.ok) {
          break; // Success, exit retry loop
        }

        if (response.status === 529 && i < retries - 1) {
          const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s delays
          console.log(`⏳ Claude overloaded, retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // If not overloaded or final retry, throw error
        const errorText = await response.text();
        throw new Error(`Claude API error (${response.status}): ${errorText}`);
      }

      if (!response) {
        throw new Error("No response received after retries");
      }

      const result = (await response.json()) as {
        content?: Array<{ text: string }>;
      };

      const text = result?.content?.[0]?.text ?? "";
      console.log("🔍 Claude sentiment analysis:", text);

      return {
        analysis: text,
        raw_text: text,
      };
    } catch (error) {
      console.error(`❌ Claude ${scope} sentiment analysis failed:`, error);
      return {
        analysis:
          "Unable to analyze sentiment at this time. Please try again later.",
        raw_text: "",
      };
    }
  }

  private generateGovernanceToolCalls(
    query: string,
    mcpState: any
  ): Array<{ toolName: string; serverId: string; args: any }> {
    const toolCalls = [];
    const queryLower = query.toLowerCase();

    console.log(`🔍 Available servers:`, Object.keys(mcpState.servers));
    console.log(
      `🔍 Available tools:`,
      mcpState.tools.map((t: any) => `${t.name} (${t.serverId})`)
    );

    // Find Discourse server
    const discourseServer = Object.keys(mcpState.servers).find(
      (name) =>
        name.toLowerCase().includes("discourse") ||
        name.toLowerCase().includes("near")
    );

    // Find House of Stake server
    const hosServer = Object.keys(mcpState.servers).find(
      (name) =>
        name.toLowerCase().includes("stake") ||
        name.toLowerCase().includes("bitte")
    );

    console.log(
      `🔍 Found servers - Discourse: ${discourseServer}, HoS: ${hosServer}`
    );

    if (discourseServer) {
      // Always get latest topics
      toolCalls.push({
        toolName: "get_latest_topics",
        serverId: discourseServer,
        args: { per_page: 10 },
      });

      // Search for specific terms
      const keywords = queryLower.match(
        /\b(validator|reward|treasury|proposal|governance|vote|discussion)\b/g
      );
      if (keywords && keywords.length > 0) {
        toolCalls.push({
          toolName: "search_posts",
          serverId: discourseServer,
          args: { query: keywords.join(" "), max_results: 10 },
        });
      } else {
        // Default search for general governance terms
        toolCalls.push({
          toolName: "search_posts",
          serverId: discourseServer,
          args: { query: query, max_results: 10 },
        });
      }
    }

    // Add House of Stake tools if available
    if (hosServer) {
      const hosTools = mcpState.tools.filter(
        (t: any) => t.serverId === hosServer
      );
      console.log(
        `🔍 HoS tools available:`,
        hosTools.map((t: any) => t.name)
      );

      if (hosTools.some((t: any) => t.name.includes("proposal"))) {
        toolCalls.push({
          toolName: "getrecentproposals",
          serverId: hosServer,
          args: { limit: 10 },
        });
      }
    }

    return toolCalls;
  }

  private async executeGovernanceTools(
    toolCalls: Array<{ toolName: string; serverId: string; args: any }>
  ): Promise<any[]> {
    const results = [];

    for (const toolCall of toolCalls) {
      try {
        console.log(
          `🔧 Executing: ${toolCall.toolName} on ${toolCall.serverId}`
        );

        if (!this.clients.has(toolCall.serverId)) {
          console.warn(`⚠️ Server ${toolCall.serverId} not found`);
          continue;
        }

        const client = this.clients.get(toolCall.serverId)!;
        const result = await client.callTool({
          name: toolCall.toolName,
          arguments: toolCall.args,
        });

        console.log(`✅ Tool result for ${toolCall.toolName}:`, result);

        results.push({
          toolCall,
          result,
          success: true,
        });
      } catch (error) {
        console.error(`❌ Tool call failed: ${toolCall.toolName}`, error);
        results.push({
          toolCall,
          error: (error as Error).message,
          success: false,
        });
      }
    }

    return results;
  }

  private normalizeProposals(proposals: any[]): any[] {
    return proposals.map((proposal) => ({
      id: proposal.id || proposal.proposal_id || `prop-${Date.now()}`,
      title:
        proposal.title ||
        proposal.description?.substring(0, 100) ||
        "Untitled Proposal",
      status: proposal.status || "unknown",
      votes_for: proposal.votes_for || proposal.yes_votes || 0,
      votes_against: proposal.votes_against || proposal.no_votes || 0,
      voting_ends: proposal.voting_ends || proposal.end_time || "Unknown",
      link: proposal.link || proposal.discussion_url,
      description:
        proposal.description || proposal.summary || "No description available",
      ...proposal,
    }));
  }

  private extractGovernanceData(toolResults: any[], query: string): any {
    const proposals: any[] = [];
    const discussions: any[] = [];
    const crossReferences: any[] = [];

    console.log(`🔗 Processing ${toolResults.length} tool results`);

    // Extract data from tool results (no filtering)
    for (const result of toolResults) {
      if (!result.success) {
        console.log(`⚠️ Skipping failed result:`, result.error);
        continue;
      }

      const data = result.result;
      const toolName = result.toolCall.toolName;

      console.log(`📝 Processing result from ${toolName}`);

      // Parse different response formats
      let parsedData = data;
      if (data.content && Array.isArray(data.content)) {
        const textContent = data.content
          .filter((item: any) => item.type === "text")
          .map((item: any) => item.text)
          .join("\n");

        try {
          parsedData = JSON.parse(textContent);
        } catch {
          parsedData = { text: textContent, raw: data };
        }
      }

      // Extract proposals
      if (toolName.includes("proposal") || parsedData.proposals) {
        if (Array.isArray(parsedData.proposals)) {
          console.log(`📋 Found ${parsedData.proposals.length} proposals`);
          proposals.push(...parsedData.proposals);
        } else if (parsedData.proposal) {
          console.log(`📋 Found 1 proposal`);
          proposals.push(parsedData.proposal);
        }
      }

      // Extract discussions
      if (
        toolName.includes("topic") ||
        toolName.includes("post") ||
        parsedData.topics ||
        parsedData.posts
      ) {
        if (Array.isArray(parsedData.topics)) {
          console.log(`💬 Found ${parsedData.topics.length} topics`);
          discussions.push(...parsedData.topics);
        } else if (Array.isArray(parsedData.posts)) {
          console.log(`💬 Found ${parsedData.posts.length} posts`);
          discussions.push(
            ...parsedData.posts.map((p: any) => ({
              ...p,
              type: "post",
            }))
          );
        } else if (parsedData.topic) {
          console.log(`💬 Found 1 topic`);
          discussions.push(parsedData.topic);
        }
      }
    }

    console.log(
      `📊 Raw data - Proposals: ${proposals.length}, Discussions: ${discussions.length}`
    );

    // Simple cross-referencing (keep existing logic)
    for (const proposal of proposals) {
      const relatedDiscussions = discussions.filter((d) => {
        const content = `${d.title || ""} ${d.excerpt || ""}`.toLowerCase();
        const proposalTitle = (proposal.title || "").toLowerCase();
        return proposalTitle && content.includes(proposalTitle);
      });

      for (const discussion of relatedDiscussions) {
        crossReferences.push({
          type: "content_match",
          proposal_id: proposal.id,
          discussion_id: discussion.id,
          confidence: 0.8,
        });
      }
    }

    return {
      proposals: this.normalizeProposals(proposals),
      discussions: this.normalizeDiscussions(discussions),
      crossReferences,
    };
  }

  private async claudeFilterResults(
    rawData: any,
    query: string,
    claudeApiKey: string
  ): Promise<any> {
    try {
      console.log(`🤖 Asking Claude to filter results for query: "${query}"`);

      // Prepare data summary for Claude
      const proposalSummaries = rawData.proposals.map((p: any) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        status: p.status,
      }));

      const discussionSummaries = rawData.discussions.map((d: any) => ({
        id: d.id,
        title: d.title,
        excerpt: d.excerpt,
      }));

      const claudeRequest = {
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        messages: [
          {
            role: "user",
            content: `User Query: "${query}"

Available Proposals:
${proposalSummaries
  .map(
    (p: { id: string; title: string; description: string; status: string }) =>
      `ID: ${p.id} | Title: "${p.title}" | Description: "${p.description}" | Status: ${p.status}`
  )
  .join("\n")}

Available Discussions:
${discussionSummaries
  .map(
    (d: { id: string; title: string; excerpt: string }) =>
      `ID: ${d.id} | Title: "${d.title}" | Excerpt: "${d.excerpt}"`
  )
  .join("\n")}

Task: Analyze which proposals and discussions are actually relevant to the user's query. Be intelligent about relevance - don't just match keywords, understand the intent.

IMPORTANT RULES:
1. **ID-based queries**: If the user mentions specific IDs (like "proposal 2", "discussion 5"), return ONLY those exact IDs
2. **Content queries**: If asking about topics (like "budget", "AI"), filter by content relevance
3. **Status queries**: If asking about status (like "active", "finished"), filter by status
4. **General queries**: If asking for "latest" or "all", consider returning multiple items

Examples:
- "what do you think about proposal 2?" → return only ID 2
- "show me proposal 1 and 3" → return only IDs 1 and 3
- "budget proposals" → return only treasury-related content
- "active proposals" → return only proposals with "Voting" status
- "latest proposals" → return multiple recent proposals

CRITICAL: You MUST respond with ONLY valid JSON. No additional text before or after.

Return EXACTLY this JSON format:
{
  "relevant_proposal_ids": [array of relevant proposal IDs],
  "relevant_discussion_ids": [array of relevant discussion IDs],
  "explanation": "Brief explanation of why these items were selected"
}`,
          },
        ],
      };

      let claudeResponse: Response | undefined = undefined;
      let retries = 3;

      for (let i = 0; i < retries; i++) {
        claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": claudeApiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(claudeRequest),
        });

        if (claudeResponse.ok) {
          break; // Success, exit retry loop
        }

        if (claudeResponse.status === 529 && i < retries - 1) {
          const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s delays
          console.log(
            `⏳ Claude filtering overloaded, retrying in ${delay}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        const errorText = await claudeResponse.text();
        console.error(
          `❌ Claude filtering API error (${claudeResponse.status}):`,
          errorText
        );
        // Fallback to returning all data if Claude fails
        return rawData;
      }

      if (!claudeResponse) {
        throw new Error("No response received after retries");
      }

      const claudeResult = (await claudeResponse.json()) as {
        content: Array<{ text: string }>;
      };
      const claudeContent = claudeResult.content[0].text;

      console.log(`🤖 Claude response:`, claudeContent);

      // Parse Claude's response
      let filterInstructions;
      try {
        // Extract JSON from Claude's response
        const jsonMatch = claudeContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          filterInstructions = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("No JSON found in Claude response");
        }
      } catch (parseError) {
        console.error("Failed to parse Claude response:", parseError);
        // Fallback to returning all data if parsing fails
        return rawData;
      }

      // Filter based on Claude's analysis
      const filteredProposals = rawData.proposals.filter((p: any) =>
        filterInstructions.relevant_proposal_ids.includes(p.id)
      );

      const filteredDiscussions = rawData.discussions.filter((d: any) =>
        filterInstructions.relevant_discussion_ids.includes(d.id)
      );

      // Update cross-references for filtered data
      const filteredCrossReferences = rawData.crossReferences.filter(
        (ref: any) =>
          filterInstructions.relevant_proposal_ids.includes(ref.proposal_id) &&
          filterInstructions.relevant_discussion_ids.includes(ref.discussion_id)
      );

      console.log(
        `🤖 Claude filtered to ${filteredProposals.length} proposals and ${filteredDiscussions.length} discussions`
      );

      return {
        proposals: filteredProposals,
        discussions: filteredDiscussions,
        crossReferences: filteredCrossReferences,
        explanation: filterInstructions.explanation,
      };
    } catch (error) {
      console.error("Claude filtering error:", error);
      // Fallback to returning all data if Claude processing fails
      return rawData;
    }
  }

  private async claudeAnalyzeResults(
    filteredData: any,
    query: string,
    claudeApiKey: string
  ): Promise<any> {
    try {
      console.log(`🧠 Asking Claude to analyze results for query: "${query}"`);

      const claudeRequest = {
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: `User Query: "${query}"

Filtered Results:
Proposals: ${JSON.stringify(filteredData.proposals, null, 2)}
Discussions: ${JSON.stringify(filteredData.discussions, null, 2)}

Task: Analyze the filtered results and provide a direct, specific answer to the user's question. If the user is asking a specific question about the data (like "who submitted proposal 2?", "what is the status of proposal 1?", "when was proposal 3 created?"), extract the relevant information and provide a clear answer.

Examples:
- "who submitted proposal 2?" → Look at proposer_id field and answer "example.near submitted proposal 2"
- "what is the status of proposal 1?" → Look at status field and answer "Finished"
- "when does voting end for proposal 2?" → Look at voting_ends field
- "what are the voting options for proposal 2?" → List the voting_options array

If it's a general query like "show me budget proposals", just return a summary.

CRITICAL: You MUST respond with ONLY valid JSON. No additional text before or after.

Return EXACTLY this JSON format:
{
  "answer": "Direct answer to the user's question",
  "analysis": "Brief analysis of the data"
}`,
          },
        ],
      };

      let claudeResponse: Response | undefined = undefined;
      let retries = 3;

      for (let i = 0; i < retries; i++) {
        claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": claudeApiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(claudeRequest),
        });

        if (claudeResponse.ok) {
          break; // Success, exit retry loop
        }

        if (claudeResponse.status === 529 && i < retries - 1) {
          const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s delays
          console.log(
            `⏳ Claude analysis overloaded, retrying in ${delay}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        const errorText = await claudeResponse.text();
        console.error(
          `❌ Claude analysis API error (${claudeResponse.status}):`,
          errorText
        );
        return { answer: null, analysis: null };
      }

      if (!claudeResponse) {
        throw new Error("No response received after retries");
      }

      const claudeResult = (await claudeResponse.json()) as {
        content: Array<{ text: string }>;
      };
      const claudeContent = claudeResult.content[0].text;

      console.log(`🧠 Claude analysis response:`, claudeContent);

      // Parse Claude's response
      try {
        const jsonMatch = claudeContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        } else {
          return { answer: claudeContent, analysis: null };
        }
      } catch (parseError) {
        console.error("Failed to parse Claude analysis response:", parseError);
        return { answer: claudeContent, analysis: null };
      }
    } catch (error) {
      console.error("Claude analysis error:", error);
      return { answer: null, analysis: null };
    }
  }

  private normalizeDiscussions(discussions: any[]): any[] {
    return discussions.map((discussion) => ({
      id: discussion.id || `disc-${Date.now()}`,
      title:
        discussion.title || discussion.topic_title || "Untitled Discussion",
      posts_count: discussion.posts_count || 0,
      views: discussion.views || 0,
      last_activity:
        discussion.last_activity || discussion.last_posted_at || "Unknown",
      url: discussion.url || discussion.post_url || "#",
      excerpt: discussion.excerpt || discussion.blurb || "No excerpt available",
      type: discussion.type || "topic",
      ...discussion,
    }));
  }

  private async processQueryWithEvents(
    query: string,
    claudeApiKey: string,
    sessionId: string
  ) {
    const threadId = nanoid();
    const runId = nanoid();

    try {
      console.log(
        `🎬 Starting event-driven query processing for session: ${sessionId}`
      );

      await new Promise((resolve) => setTimeout(resolve, 500));

      if (!this.eventControllers.has(sessionId)) {
        console.warn(`⚠️ No event controller found for session: ${sessionId}`);
        return;
      }

      // Emit AG-UI run started
      this.emitToSession(sessionId, {
        type: "RUN_STARTED",
        threadId,
        runId,
        timestamp: Date.now(),
      });

      // Detect governance action
      const governanceAction = this.detectGovernanceAction(query);
      if (governanceAction) {
        this.emitToSession(sessionId, {
          type: "CUSTOM",
          name: "GOVERNANCE_ACTION_DETECTED",
          value: governanceAction,
          timestamp: Date.now(),
        });
      }

      // Start assistant message using proper AG-UI events
      const messageId = nanoid();
      this.emitToSession(sessionId, {
        type: "TEXT_MESSAGE_START",
        messageId,
        role: "assistant",
        timestamp: Date.now(),
      });

      // Stream progress message
      this.emitToSession(sessionId, {
        type: "TEXT_MESSAGE_CONTENT",
        messageId,
        delta: "🔍 Analyzing your governance query...\n\n",
        timestamp: Date.now(),
      });

      const mcpState = await this.getMcpState();
      this.emitToSession(sessionId, {
        type: "TEXT_MESSAGE_CONTENT",
        messageId,
        delta: `📡 Connected to ${
          Object.keys(mcpState.servers).length
        } governance servers\n`,
        timestamp: Date.now(),
      });

      const toolCalls = this.generateGovernanceToolCalls(query, mcpState);
      this.emitToSession(sessionId, {
        type: "TEXT_MESSAGE_CONTENT",
        messageId,
        delta: `🛠️ Running ${toolCalls.length} governance tools...\n`,
        timestamp: Date.now(),
      });

      // Execute your existing tool logic
      const toolResults = await this.executeGovernanceTools(toolCalls);
      const rawData = this.extractGovernanceData(toolResults, query);

      this.emitToSession(sessionId, {
        type: "TEXT_MESSAGE_CONTENT",
        messageId,
        delta: `📊 Found ${rawData.proposals.length} proposals, ${rawData.discussions.length} discussions\n`,
        timestamp: Date.now(),
      });

      this.emitToSession(sessionId, {
        type: "TEXT_MESSAGE_CONTENT",
        messageId,
        delta: `🤖 Asking Claude to analyze relevance...\n`,
        timestamp: Date.now(),
      });

      const filteredData = await this.claudeFilterResults(
        rawData,
        query,
        claudeApiKey
      );
      const analysisResult = await this.claudeAnalyzeResults(
        filteredData,
        query,
        claudeApiKey
      );

      // Stream final answer
      if (analysisResult.answer) {
        this.emitToSession(sessionId, {
          type: "TEXT_MESSAGE_CONTENT",
          messageId,
          delta: `\n📋 **Analysis:**\n${analysisResult.answer}\n`,
          timestamp: Date.now(),
        });
      }

      // End message properly
      this.emitToSession(sessionId, {
        type: "TEXT_MESSAGE_END",
        messageId,
        timestamp: Date.now(),
      });

      // Finish run with results
      this.emitToSession(sessionId, {
        type: "RUN_FINISHED",
        threadId,
        runId,
        result: {
          message: analysisResult.answer,
          proposals: filteredData.proposals,
          discussions: filteredData.discussions,
          confidence: 0.8,
        },
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error(
        `❌ Query processing error for session ${sessionId}:`,
        error
      );

      this.emitToSession(sessionId, {
        type: "RUN_ERROR",
        message: (error as Error).message,
        timestamp: Date.now(),
      });
    } finally {
      // Clean up session after 30 seconds
      setTimeout(() => {
        this.eventControllers.delete(sessionId);
      }, 30000);
    }
  }

  private async emitToSession(sessionId: string | null, event: any) {
    if (!sessionId) return;

    const writer = this.eventControllers.get(sessionId);
    if (!writer) {
      console.warn(`⚠️ No writer for session ${sessionId}`);
      return;
    }

    const encoder = new TextEncoder();
    const formatted = `event: ${event.type}\ndata: ${JSON.stringify(
      event
    )}\n\n`;

    try {
      await writer.write(encoder.encode(formatted));
      console.log(`📤 Emitted ${event.type} to session ${sessionId}`);
    } catch (err) {
      console.error(`❌ Failed to emit to session ${sessionId}:`, err);
      this.eventControllers.delete(sessionId);
      try {
        await writer.close();
      } catch {}
    }
  }

  private detectGovernanceAction(query: string): any {
    const queryLower = query.toLowerCase();

    if (
      queryLower.includes("create") &&
      (queryLower.includes("proposal") || queryLower.includes("suggest"))
    ) {
      return { type: "CREATE_PROPOSAL", intent: query };
    }
    if (
      queryLower.includes("delegate") ||
      queryLower.includes("delegation") ||
      queryLower.includes("who should i")
    ) {
      return { type: "ANALYZE_DELEGATION", context: query };
    }
    if (
      queryLower.includes("vote") ||
      queryLower.includes("voting") ||
      queryLower.includes("should i vote")
    ) {
      return { type: "VOTING_HELP", proposalQuery: query };
    }
    if (queryLower.includes("explain") && queryLower.includes("proposal")) {
      return { type: "EXPLAIN_PROPOSAL", query };
    }

    return null;
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.split("/").pop() ?? "";

    console.log(`🔧 MyAgent.onRequest: ${request.method} ${path}`);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      const requestedHeaders =
        request.headers.get("Access-Control-Request-Headers") || "";
      const corsHeaders = this.createCorsHeaders(requestedHeaders);
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (path === "sentiment-analysis" && request.method === "POST") {
      const body = (await request.json()) as { claudeApiKey?: string };
      const sessionId = nanoid();

      const { proposalId, proposalTitle } = body as {
        proposalId: number;
        proposalTitle: string;
      };

      console.log(
        `🎭 Starting proposal sentiment analysis for proposal ${proposalId}`
      );

      await this.performSentimentAnalysis("proposal", sessionId, {
        proposalId,
        proposalTitle,
      });

      return this.createCorsResponse(JSON.stringify({ sessionId }), 200);
    }

    if (path === "events" && request.method === "GET") {
      console.log("🔧 Events endpoint hit");

      const sessionId = url.searchParams.get("session") || crypto.randomUUID();
      const encoder = new TextEncoder();

      const { readable, writable } = new TransformStream();
      const { writable: eventWritable } = new TransformStream();
      const writer = writable.getWriter();

      this.eventControllers.set(sessionId, writer);
      console.log(`🔧 Event writer stored for session: ${sessionId}`);

      // Send initial connection event
      await writer.write(
        encoder.encode(
          `event: CONNECTION_ESTABLISHED\ndata: ${JSON.stringify({
            sessionId,
            timestamp: Date.now(),
          })}\n\n`
        )
      );

      // Keep-alive ping every 30s
      const keepAlive = setInterval(async () => {
        try {
          await writer.write(encoder.encode(`: keep-alive\n\n`));
        } catch (err) {
          console.warn(`Keep-alive failed for session ${sessionId}:`, err);
          clearInterval(keepAlive);
          this.eventControllers.delete(sessionId);
          await writer.close();
        }
      }, 30000);

      // Cleanup after 5 minutes
      const shutdown = setTimeout(async () => {
        clearInterval(keepAlive);
        this.eventControllers.delete(sessionId);
        try {
          await writer.close();
        } catch (_) {}
      }, 5 * 60 * 1000);

      // Return readable stream as SSE response
      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          ...this.createCorsHeaders(),
        },
      });
    }

    if (path === "claude-api" && request.method === "POST") {
      try {
        const claudeApiKey =
          request.headers.get("x-api-key") ||
          request.headers.get("x-claude-api-key");

        if (!claudeApiKey) {
          return this.createCorsResponse(
            JSON.stringify({ error: "Claude API key required" }),
            400
          );
        }

        const body = await request.json();

        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": claudeApiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorText = await response.text();
          return this.createCorsResponse(
            JSON.stringify({
              error: `Claude API error: ${response.status} ${errorText}`,
            }),
            response.status
          );
        }

        const result = await response.json();
        return this.createCorsResponse(JSON.stringify(result), 200);
      } catch (error) {
        console.error("Claude API error:", error);
        return this.createCorsResponse(
          JSON.stringify({ error: "Claude API call failed" }),
          500
        );
      }
    }

    if (path === "query-with-events" && request.method === "GET") {
      const sessionId = url.searchParams.get("session") || crypto.randomUUID();
      const encoder = new TextEncoder();

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();

      // Save writer for later emission
      this.eventControllers.set(sessionId, writer);

      // Send initial connected message
      await writer.write(encoder.encode(`: connected\n\n`));

      // Optionally send keep-alive pings
      const keepAlive = setInterval(() => {
        writer.write(encoder.encode(`: keep-alive\n\n`)).catch((err) => {
          console.warn("Keep-alive failed:", err);
          clearInterval(keepAlive);
        });
      }, 10000);

      return new Response(readable, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    if (path === "query-with-events" && request.method === "POST") {
      const body = await request.json();

      const pathSegments = url.pathname.split("/").filter(Boolean);
      const sessionId = pathSegments.at(-2) ?? nanoid();
      const agent = this;

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();

      agent.eventControllers.set(sessionId, writer);

      const encoder = new TextEncoder();

      const send = (event: any) => {
        const formatted = `data: ${JSON.stringify(event)}\n\n`;
        writer.write(encoder.encode(formatted));
      };

      (async () => {
        try {
          send({ type: "RUN_STARTED", sessionId });

          const parsedBody = body as { query?: string; claudeApiKey?: string };
          const { query, claudeApiKey, ...otherArgs } = parsedBody;

          if (query && query.trim()) {
            console.log(`🧠 Processing query: "${query}"`);
            await agent.processQueryWithEvents(
              query,
              claudeApiKey || "",
              sessionId
            );
          } else {
            console.log(
              "🌐 No query provided, running ecosystem sentiment analysis"
            );
            await agent.performSentimentAnalysis("ecosystem", sessionId, {
              ...otherArgs,
              claudeApiKey,
            });
          }

          send({ type: "RUN_FINISHED", sessionId });
        } catch (err) {
          const message =
            typeof err === "object" && err && "message" in err
              ? (err as any).message
              : String(err);
          console.error("❌ Query processing failed:", message);
          send({ type: "RUN_ERROR", message, sessionId });
        } finally {
          await writer.close();
          agent.eventControllers.delete(sessionId);
        }
      })();

      return new Response(readable, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    if (path === "query" && request.method === "POST") {
      try {
        const body = (await request.json()) as {
          query: string;
          claudeApiKey: string;
        };

        const { query, claudeApiKey } = body;

        console.log(`🧠 Processing query: "${query}"`);

        const finalApiKey = claudeApiKey || request.headers.get("x-api-key");

        if (!finalApiKey) {
          return this.createCorsResponse(
            JSON.stringify({ error: "Claude API key required" }),
            400
          );
        }

        // 1. Get available MCP tools and servers
        const mcpState = await this.getMcpState();
        console.log(`📊 MCP State:`, mcpState);

        // 2. Generate tool calls
        const toolCalls = this.generateGovernanceToolCalls(query, mcpState);
        console.log(`🛠️ Generated ${toolCalls.length} tool calls:`, toolCalls);

        // 3. Execute MCP tools
        const toolResults = await this.executeGovernanceTools(toolCalls);
        console.log(`📊 Got ${toolResults.length} tool results`);

        // 4. Extract raw data (no filtering yet)
        const rawData = this.extractGovernanceData(toolResults, query);
        console.log(`🔗 Raw data extracted:`, rawData);

        // 5. Ask Claude to intelligently filter the results
        const filteredData = await this.claudeFilterResults(
          rawData,
          query,
          claudeApiKey
        );
        console.log(`🤖 Claude-filtered data:`, filteredData);

        // 6. Ask Claude to analyze and answer the specific question
        const analysisResult = await this.claudeAnalyzeResults(
          filteredData,
          query,
          claudeApiKey
        );
        console.log(`🧠 Claude analysis result:`, analysisResult);

        // 7. Create response
        const response = {
          message:
            analysisResult.answer ||
            `Found ${filteredData.proposals.length} proposals and ${filteredData.discussions.length} discussions related to "${query}".`,
          proposals: filteredData.proposals,
          discussions: filteredData.discussions,
          crossReferences: filteredData.crossReferences,
          confidence: 0.8,
          explanation: filteredData.explanation,
          analysis: analysisResult.analysis,
        };

        return this.createCorsResponse(JSON.stringify(response), 200);
      } catch (error) {
        console.error("Query error:", error);
        return this.createCorsResponse(
          JSON.stringify({
            error: "Failed to process query",
            details: (error as Error).message,
          }),
          500
        );
      }
    }

    if (path === "add-mcp" && request.method === "POST") {
      const body = (await request.json()) as {
        url: string;
        name: string;
        type?: "bitte" | "direct";
      };

      const { url: serverUrl, name, type = "bitte" } = body;

      return await this.addMCPServer({ name, url: serverUrl, type });
    }

    // Add endpoint for adding Discourse server specifically
    if (path === "add-discourse" && request.method === "POST") {
      const body = (await request.json()) as {
        url: string;
        apiKey?: string;
        name?: string;
      };

      const { url: serverUrl, name = "NEAR Discourse" } = body;

      return await this.addMCPServer({
        name,
        url: serverUrl,
        type: "direct",
      });
    }

    if (path === "remove-mcp" && request.method === "POST") {
      const body = (await request.json()) as { serverId: string };
      const { serverId } = body;

      if (this.clients.has(serverId)) {
        const client = this.clients.get(serverId)!;
        await client.close();
        this.clients.delete(serverId);
        this.serverConfigs.delete(serverId);

        return this.createCorsResponse(JSON.stringify({ ok: true }), 200);
      } else {
        return this.createCorsResponse(
          JSON.stringify({ error: "Server not found" }),
          404
        );
      }
    }

    if (path === "tools" && request.method === "GET") {
      try {
        const allTools = [];

        for (const [serverName, client] of this.clients) {
          try {
            const tools = await client.listTools();
            allTools.push(
              ...tools.tools.map((tool) => ({
                ...tool,
                serverId: serverName,
                serverType:
                  this.serverConfigs.get(serverName)?.type || "unknown",
              }))
            );
          } catch (err) {
            console.error(`Error listing tools from ${serverName}:`, err);
          }
        }

        return this.createCorsResponse(
          JSON.stringify({ tools: allTools }),
          200
        );
      } catch (err: any) {
        return this.createCorsResponse(
          JSON.stringify({ error: err.message }),
          500
        );
      }
    }

    if (path === "call-tool" && request.method === "POST") {
      try {
        const body = (await request.json()) as {
          toolName: string;
          args: Record<string, any>;
          serverId?: string;
        };
        const { toolName, args, serverId } = body;

        if (!serverId || !this.clients.has(serverId)) {
          return this.createCorsResponse(
            JSON.stringify({
              error: "Server not found or serverId not specified",
            }),
            400
          );
        }

        const client = this.clients.get(serverId)!;

        // Add governance-specific context handling
        let enhancedArgs = args;
        if (this.isGovernanceQuery(toolName, args)) {
          enhancedArgs = await this.enhanceGovernanceContext(args, serverId);
        }

        const result = await client.callTool({
          name: toolName,
          arguments: enhancedArgs,
        });

        return this.createCorsResponse(JSON.stringify(result), 200);
      } catch (err: any) {
        return this.createCorsResponse(
          JSON.stringify({ error: err.message }),
          500
        );
      }
    }

    if (path === "list-servers" && request.method === "GET") {
      const servers = Array.from(this.clients.keys()).map((serverId) => ({
        id: serverId,
        config: this.serverConfigs.get(serverId),
      }));
      return this.createCorsResponse(JSON.stringify({ servers }), 200);
    }

    if (path === "mcp-state" && request.method === "GET") {
      try {
        const tools = [];
        const servers: Record<
          string,
          { name: string; state: string; error?: string; type?: string }
        > = {};

        for (const [serverName, client] of this.clients) {
          try {
            const clientTools = await client.listTools();
            tools.push(
              ...clientTools.tools.map((tool) => ({
                ...tool,
                serverId: serverName,
              }))
            );
            servers[serverName] = {
              name: serverName,
              state: "ready",
              type: this.serverConfigs.get(serverName)?.type || "unknown",
            };
          } catch (err) {
            console.error(`Error getting tools from ${serverName}:`, err);
            servers[serverName] = {
              name: serverName,
              state: "error",
              error: (err as Error).message,
              type: this.serverConfigs.get(serverName)?.type || "unknown",
            };
          }
        }

        return this.createCorsResponse(
          JSON.stringify({
            tools,
            servers,
            prompts: [],
            resources: [],
          }),
          200
        );
      } catch (err: any) {
        return this.createCorsResponse(
          JSON.stringify({ error: err.message }),
          500
        );
      }
    }

    if (path === "health" && request.method === "GET") {
      return this.createCorsResponse(
        JSON.stringify({
          status: "ok",
          timestamp: new Date().toISOString(),
          agent: "MyAgent",
        }),
        200
      );
    }

    console.log(`🔧 No matching endpoint for path: ${path}`);
    return new Response("Not Found", { status: 404 });
  }

  private async addMCPServer(config: MCPServerConfig): Promise<Response> {
    try {
      let transport;

      if (config.type === "direct") {
        // Use SSE transport for Cloudflare Agents SDK servers
        console.log(`🔌 Creating SSE transport for: ${config.url}`);
        transport = new SSEClientTransport(new URL(config.url));
      } else {
        // Bitte AI proxy connection uses HTTP transport
        const sessionId = `session-${Date.now()}-${Math.random()
          .toString(36)
          .substring(2, 11)}`;
        transport = new StreamableHTTPClientTransport(new URL(config.url), {
          sessionId,
        });
      }

      const client = new Client(
        {
          name: "bitte-mcp-client",
          version: "0.0.1",
        },
        {
          capabilities: {
            roots: { listChanged: true },
            sampling: {},
          },
        }
      );

      console.log(`🔌 Connecting to ${config.name}...`);
      await client.connect(transport);
      console.log(`✅ Connected to ${config.name}`);

      // Test tool listing
      try {
        const tools = await client.listTools();
        console.log(
          `🛠️ Found ${tools.tools.length} tools from ${config.name}:`,
          tools.tools.map((t) => t.name)
        );
      } catch (toolError) {
        console.warn(`⚠️ Could not list tools from ${config.name}:`, toolError);
      }

      this.clients.set(config.name, client);
      this.serverConfigs.set(config.name, config);

      return this.createCorsResponse(
        JSON.stringify({
          ok: true,
          serverType: config.type,
          transportType: config.type === "direct" ? "SSE" : "HTTP",
        }),
        200
      );
    } catch (error) {
      console.error(`❌ Failed to connect to ${config.name}:`, error);
      return this.createCorsResponse(
        JSON.stringify({
          error: `Failed to connect to ${config.type} server: ${
            (error as Error).message
          }`,
        }),
        500
      );
    }
  }

  private isGovernanceQuery(
    toolName: string,
    args: Record<string, any>
  ): boolean {
    // Detect queries based on your specific tools
    const governanceTools = [
      "get_latest_topics",
      "search_posts",
      "get_topic",
      "get_recent_posts",
    ];

    const governanceKeywords = [
      "proposal",
      "vote",
      "governance",
      "discussion",
      "forum",
      "near",
      "dao",
    ];
    const toolString = `${toolName} ${JSON.stringify(args)}`.toLowerCase();

    return (
      governanceTools.includes(toolName) ||
      governanceKeywords.some((keyword) => toolString.includes(keyword))
    );
  }

  private async enhanceGovernanceContext(
    args: Record<string, any>,
    currentServerId: string
  ): Promise<Record<string, any>> {
    // Cross-reference data between House of Stake and Discourse
    try {
      if (args.proposalId || args.proposal_id || args.id) {
        const proposalId = args.proposalId || args.proposal_id || args.id;

        // If calling Discourse, add proposal context from House of Stake
        if (
          currentServerId.toLowerCase().includes("discourse") ||
          currentServerId.toLowerCase().includes("near")
        ) {
          const hosServer = Array.from(this.clients.keys()).find(
            (name) =>
              name.toLowerCase().includes("stake") ||
              name.toLowerCase().includes("hos") ||
              name.toLowerCase().includes("bitte")
          );

          if (hosServer && this.clients.has(hosServer)) {
            try {
              const hosClient = this.clients.get(hosServer)!;
              const proposalData = await hosClient.callTool({
                name: "get_proposal",
                arguments: { proposal_id: proposalId },
              });

              return {
                ...args,
                proposalContext: proposalData,
                enhancedSearch: true,
              };
            } catch (err) {
              console.warn("Failed to enhance with proposal context:", err);
            }
          }
        }

        // If calling House of Stake, add forum discussion context from Discourse
        if (
          currentServerId.toLowerCase().includes("stake") ||
          currentServerId.toLowerCase().includes("hos") ||
          currentServerId.toLowerCase().includes("bitte")
        ) {
          const discourseServer = Array.from(this.clients.keys()).find(
            (name) =>
              name.toLowerCase().includes("discourse") ||
              name.toLowerCase().includes("near")
          );

          if (discourseServer && this.clients.has(discourseServer)) {
            try {
              const discourseClient = this.clients.get(discourseServer)!;
              const forumData = await discourseClient.callTool({
                name: "search_posts",
                arguments: { query: `proposal ${proposalId}`, max_results: 5 },
              });

              return {
                ...args,
                forumContext: forumData,
                enhancedSearch: true,
              };
            } catch (err) {
              console.warn("Failed to enhance with forum context:", err);
            }
          }
        }
      }
    } catch (err) {
      console.error("Error enhancing governance context:", err);
    }

    return args;
  }

  private async callTool(
    toolName: string,
    serverId: string,
    args: Record<string, any>
  ): Promise<any> {
    if (!this.clients.has(serverId)) {
      throw new Error(`Server ${serverId} not found`);
    }

    const client = this.clients.get(serverId)!;
    const result = await client.callTool({
      name: toolName,
      arguments: args,
    });

    return result;
  }

  private async performSentimentAnalysis(
    scope: "proposal" | "ecosystem",
    sessionId: string,
    options: {
      proposalId?: number;
      proposalTitle?: string;
      claudeApiKey?: string;
    }
  ) {
    try {
      // Wait for event stream connection
      let attempts = 0;
      while (!this.eventControllers.has(sessionId) && attempts < 10) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        attempts++;
      }

      if (!this.eventControllers.has(sessionId)) {
        console.warn(`⚠️ No event controller found for session ${sessionId}`);
        return;
      }

      // Emit start event
      if (scope === "proposal") {
        this.emitToSession(sessionId, {
          type: "CUSTOM",
          name: "SENTIMENT_ANALYSIS_STARTED",
          value: {
            proposalId: options.proposalId,
            proposalTitle: options.proposalTitle,
          },
        });
        console.log(
          `🎭 Starting proposal sentiment analysis for proposal ${options.proposalId}`
        );
      } else {
        this.emitToSession(sessionId, {
          type: "CUSTOM",
          name: "ECOSYSTEM_SENTIMENT_STARTED",
          value: { scope: "ecosystem" },
        });
        console.log("🌐 Starting ecosystem sentiment analysis");
      }

      // Validate and log API key
      const claudeApiKey = options.claudeApiKey;
      if (!claudeApiKey) {
        throw new Error("Claude API key not provided");
      }
      console.log("🔐 Using Claude key from frontend (hidden)");

      // Gather data and analyze sentiment
      const sentimentData = await this.gatherSentimentData(scope, options);
      const sentimentResult = await this.claudeAnalyzeSentiment(
        sentimentData.forumData,
        sentimentData.additionalData,
        options.proposalTitle ?? "ecosystem analysis",
        options.proposalId ?? 0,
        scope,
        claudeApiKey
      );

      // Emit custom result
      const eventName =
        scope === "proposal"
          ? "SENTIMENT_ANALYSIS_COMPLETE"
          : "ECOSYSTEM_SENTIMENT_COMPLETE";

      await this.emitToSession(sessionId, {
        type: "CUSTOM",
        name: eventName,
        value: sentimentResult,
      });

      const header =
        scope === "ecosystem"
          ? "🧠 **Governance Ecosystem Analysis**\n\n"
          : `🧠 **Proposal #${options.proposalId} Sentiment Analysis**\n\n`;

      const analysisText =
        sentimentResult?.analysis ||
        sentimentResult?.raw_text ||
        "Analysis complete.";

      // AG-UI event sequence
      const messageId = nanoid();

      // Start the message
      await this.emitToSession(sessionId, {
        type: "TEXT_MESSAGE_START",
        messageId,
        role: "assistant",
        timestamp: Date.now(),
      });

      await this.emitToSession(sessionId, {
        type: "TEXT_MESSAGE_CONTENT",
        messageId,
        delta: header + analysisText,
        timestamp: Date.now(),
      });

      // End the message
      await this.emitToSession(sessionId, {
        type: "TEXT_MESSAGE_END",
        messageId,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error(`${scope} sentiment analysis failed:`, error);

      const fallbackResult = {
        analysis:
          "Unable to analyze sentiment at this time. Please try again later.",
        raw_text: "",
      };

      // Error message using proper AG-UI events
      const errorMessageId = nanoid();

      await this.emitToSession(sessionId, {
        type: "TEXT_MESSAGE_START",
        messageId: errorMessageId,
        role: "assistant",
        timestamp: Date.now(),
      });

      await this.emitToSession(sessionId, {
        type: "TEXT_MESSAGE_CONTENT",
        messageId: errorMessageId,
        delta: `⚠️ Sentiment analysis failed: ${
          error && typeof error === "object" && "message" in error
            ? (error as any).message
            : String(error)
        }`,
        timestamp: Date.now(),
      });

      await this.emitToSession(sessionId, {
        type: "TEXT_MESSAGE_END",
        messageId: errorMessageId,
        timestamp: Date.now(),
      });

      await this.emitToSession(sessionId, {
        type: "CUSTOM",
        name:
          scope === "proposal"
            ? "SENTIMENT_ANALYSIS_COMPLETE"
            : "ECOSYSTEM_SENTIMENT_COMPLETE",
        value: fallbackResult,
      });
    }
  }

  private async gatherSentimentData(
    scope: "proposal" | "ecosystem",
    options: { proposalId?: number; proposalTitle?: string }
  ): Promise<{ forumData: any; additionalData: any }> {
    console.log(`🔍 Available servers for sentiment analysis:`, [
      ...this.clients.keys(),
    ]);

    const discourseServer = [...this.clients.keys()].find((name) => {
      const nameLower = name.toLowerCase();
      console.log(`🔍 Checking server: "${name}" (lowercase: "${nameLower}")`);
      const matches =
        nameLower.includes("discourse") ||
        nameLower.includes("near") ||
        nameLower.includes("disco");
      console.log(`🔍 Server "${name}" matches: ${matches}`);
      return matches;
    });

    console.log(`🔍 Final discourse server result: ${discourseServer}`);

    if (!discourseServer) {
      console.warn("⚠️ Discourse server not found. Skipping forum data.");
    }

    if (scope === "proposal") {
      if (!discourseServer) {
        return {
          forumData: [],
          additionalData: [],
        };
      }

      try {
        console.log(
          `🔍 Searching forum for proposal ${options.proposalId}: "${options.proposalTitle}"`
        );

        const forumResults = await this.callTool(
          "search_posts",
          discourseServer,
          {
            query: `${options.proposalTitle} proposal ${options.proposalId}`,
            max_results: 20,
          }
        );

        const latestTopics = await this.callTool(
          "get_latest_topics",
          discourseServer,
          {
            per_page: 10,
          }
        );

        return {
          forumData: forumResults,
          additionalData: latestTopics,
        };
      } catch (err) {
        console.warn("⚠️ Failed to fetch proposal-related forum data:", err);
        return {
          forumData: [],
          additionalData: [],
        };
      }
    } else {
      console.log(`🌐 Gathering ecosystem-wide sentiment data`);

      let latestTopics = [];
      let recentPosts = null;

      if (discourseServer) {
        try {
          latestTopics = await this.callTool(
            "get_latest_topics",
            discourseServer,
            {
              per_page: 20,
            }
          );
        } catch (err) {
          console.warn("⚠️ Failed to fetch latest topics:", err);
        }

        try {
          recentPosts = await this.callTool(
            "get_recent_posts",
            discourseServer,
            {
              limit: 15,
            }
          );
        } catch (err) {
          console.warn("⚠️ Failed to fetch recent posts:", err);
        }
      }

      const hosServer = Object.keys(this.clients).find(
        (name) =>
          name.toLowerCase().includes("stake") ||
          name.toLowerCase().includes("bitte")
      );

      let proposalData = null;
      if (hosServer) {
        try {
          proposalData = await this.callTool("getrecentproposals", hosServer, {
            limit: 15,
          });
        } catch (err) {
          console.warn(
            "⚠️ Could not get proposal data for ecosystem sentiment:",
            err
          );
        }
      }

      return {
        forumData: latestTopics,
        additionalData: { recentPosts, proposalData },
      };
    }
  }

  private createCorsHeaders(acrh: string = "") {
    const requiredHeaders = [
      "content-type",
      "Content-Type",
      "authorization",
      "Authorization",
      "mcp-session-id",
      "Mcp-Session-Id",
      "mcp-protocol-version",
      "MCP-Protocol-Version",
      "x-api-key",
      "X-API-Key",
    ];

    const requestedHeaders = acrh ? acrh.split(",").map((h) => h.trim()) : [];
    const allHeaders = [...requiredHeaders];

    for (const header of requestedHeaders) {
      const headerLower = header.toLowerCase();
      const exists = allHeaders.some((h) => h.toLowerCase() === headerLower);
      if (!exists) {
        allHeaders.push(header);
      }
    }

    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": allHeaders.join(", "),
      "Access-Control-Max-Age": "86400",
    };
  }

  private createCorsResponse(
    body?: string,
    status = 200,
    headers: Record<string, string> = {}
  ) {
    return new Response(body, {
      status,
      headers: {
        ...this.createCorsHeaders(),
        "Content-Type": "application/json",
        ...headers,
      },
    });
  }
}

async function emitEvent(
  writer: WritableStreamDefaultWriter,
  event: Record<string, any>
) {
  const encoder = new TextEncoder();
  const formatted = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

  try {
    await writer.write(encoder.encode(formatted));
    console.log(`📤 Emitted event: ${event.type}`);
  } catch (err) {
    console.error("❌ Failed to write event:", err);
    try {
      await writer.close();
    } catch (_) {}
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    console.log(`🌐 Worker request: ${request.method} ${url.pathname}`);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      const requestedHeaders =
        request.headers.get("Access-Control-Request-Headers") || "*";

      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": requestedHeaders,
        },
      });
    }

    // **IMPORTANT: Route agent requests FIRST**
    try {
      const routed = await routeAgentRequest(request, env);
      if (routed) {
        console.log("✅ Agent request routed successfully");
        return routed;
      }
    } catch (error) {
      console.error("❌ Agent routing error:", error);
    }

    // SSE endpoint for general events
    if (request.method === "GET" && url.pathname === "/query-with-events") {
      console.log("🔧 SSE endpoint hit");
      const encoder = new TextEncoder();

      let keepAlive: any;
      let shutdown: any;

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`: connected\n\n`));

          keepAlive = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(`: keep-alive\n\n`));
            } catch (err) {
              console.warn("Keep-alive failed:", err);
              clearInterval(keepAlive);
            }
          }, 10000);

          shutdown = setTimeout(() => {
            clearInterval(keepAlive);
            controller.close();
          }, 5 * 60 * 1000);
        },
        cancel() {
          clearInterval(keepAlive);
          clearTimeout(shutdown);
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // Health check endpoint
    if (request.method === "GET" && url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          status: "ok",
          timestamp: new Date().toISOString(),
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    console.log(`❌ No route found for: ${request.method} ${url.pathname}`);
    return new Response(
      JSON.stringify({
        error: "Route not found",
        method: request.method,
        pathname: url.pathname,
      }),
      {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  },
};
