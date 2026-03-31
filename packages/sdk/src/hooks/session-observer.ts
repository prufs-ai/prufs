/**
 * Agent Session Observer
 *
 * Defines the interface that agent-specific hooks implement. Each hook
 * watches an agent's lifecycle events (user prompt, agent response,
 * tool use, file changes) and translates them into Prufs trail
 * events via the TrailRecorder.
 *
 * The observer pattern decouples the trail recording logic from any
 * specific agent's implementation details.
 */

import { TrailRecorder } from "../recorder.js";
import type { PrufsConfig, FileChange } from "../types.js";

// ---------------------------------------------------------------------------
// Agent event types - what the hook system receives from any agent
// ---------------------------------------------------------------------------

export interface AgentEvent {
  type: AgentEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

export type AgentEventType =
  | "session_start"
  | "user_prompt"       // Human issues a directive
  | "agent_plan"        // Agent states its interpretation / plan
  | "agent_reasoning"   // Agent explains trade-offs or alternatives
  | "tool_call"         // Agent invokes a tool (file edit, shell, etc.)
  | "tool_result"       // Result of a tool invocation
  | "file_change"       // Agent modifies a file
  | "test_result"       // Test suite output
  | "agent_complete"    // Agent signals task completion
  | "session_end";

// ---------------------------------------------------------------------------
// Decision extraction - identifies decisions in agent output
// ---------------------------------------------------------------------------

/**
 * A detected decision point in agent output text.
 * Phase 2 uses pattern matching; post-MVP will add LLM extraction.
 */
export interface DetectedDecision {
  chosen: string;
  alternatives: Array<{ description: string; rejection_reason?: string }>;
  rationale: string;
  domain_tags: string[];
  confidence: number;
}

/**
 * A detected constraint in agent output text.
 */
export interface DetectedConstraint {
  text: string;
  source: "project_rule" | "agent_inferred" | "human_stated";
}

// ---------------------------------------------------------------------------
// Session observer - the main instrumentation class
// ---------------------------------------------------------------------------

export interface SessionObserverConfig extends PrufsConfig {
  /** Enable automatic decision detection from agent text (default: true) */
  detect_decisions?: boolean;

  /** Enable automatic constraint detection (default: true) */
  detect_constraints?: boolean;

  /** Minimum confidence threshold for detected decisions (default: 0.6) */
  min_decision_confidence?: number;
}

export class SessionObserver {
  private recorder: TrailRecorder;
  private config: SessionObserverConfig;

  // State tracking for the current session
  private currentDirectiveId: string | null = null;
  private currentInterpretationId: string | null = null;
  private decisionIds: string[] = [];
  private constraintIds: string[] = [];
  private pendingFileChanges: FileChange[] = [];
  private sessionActive = false;

  constructor(config: SessionObserverConfig) {
    this.config = {
      detect_decisions: true,
      detect_constraints: true,
      min_decision_confidence: 0.6,
      ...config,
    };
    this.recorder = new TrailRecorder(this.config);
  }

  /**
   * Process an agent event. Call this from the agent-specific hook
   * whenever something happens in the agent's lifecycle.
   */
  async onEvent(event: AgentEvent): Promise<void> {
    switch (event.type) {
      case "session_start":
        await this.handleSessionStart();
        break;
      case "user_prompt":
        await this.handleUserPrompt(event.data as { text: string; author?: string });
        break;
      case "agent_plan":
        await this.handleAgentPlan(event.data as { text: string; confidence?: number });
        break;
      case "agent_reasoning":
        await this.handleAgentReasoning(event.data as { text: string });
        break;
      case "file_change":
        this.handleFileChange(event.data as unknown as FileChange);
        break;
      case "test_result":
        await this.handleTestResult(
          event.data as { passed: number; failed: number; skipped: number; duration_ms: number }
        );
        break;
      case "agent_complete":
        await this.handleAgentComplete(event.data as { commit_sha?: string });
        break;
      case "session_end":
        await this.handleSessionEnd();
        break;
      // tool_call and tool_result are logged but not yet mapped to trail nodes
      default:
        break;
    }
  }

  /**
   * Get the underlying TrailRecorder for manual trail operations.
   */
  get trail(): TrailRecorder {
    return this.recorder;
  }

  // -----------------------------------------------------------------------
  // Event handlers
  // -----------------------------------------------------------------------

  private async handleSessionStart(): Promise<void> {
    await this.recorder.startSession();
    this.sessionActive = true;
    this.resetTurnState();
  }

  private async handleUserPrompt(data: { text: string; author?: string }): Promise<void> {
    if (!this.sessionActive) return;

    // Flush any pending implementation from the previous turn
    await this.flushPendingImplementation();

    // Reset turn state for the new directive
    this.resetTurnState();

    this.currentDirectiveId = await this.recorder.directive(
      data.text,
      data.author ?? "human"
    );
  }

  private async handleAgentPlan(data: { text: string; confidence?: number }): Promise<void> {
    if (!this.sessionActive || !this.currentDirectiveId) return;

    this.currentInterpretationId = await this.recorder.interpretation(
      this.currentDirectiveId,
      data.text,
      { confidence: data.confidence ?? 0.8 }
    );

    // Also scan the plan text for constraints
    if (this.config.detect_constraints) {
      const constraints = detectConstraints(data.text);
      for (const c of constraints) {
        const cId = await this.recorder.constraint(c.text, { source: c.source });
        this.constraintIds.push(cId);
      }
    }
  }

  private async handleAgentReasoning(data: { text: string }): Promise<void> {
    if (!this.sessionActive) return;

    const parentId = this.currentInterpretationId ?? this.currentDirectiveId;
    if (!parentId) return;

    // Detect decisions in the reasoning text
    if (this.config.detect_decisions) {
      const decisions = detectDecisions(data.text);
      for (const d of decisions) {
        if (d.confidence >= (this.config.min_decision_confidence ?? 0.6)) {
          const decId = await this.recorder.decision(parentId, {
            chosen: d.chosen,
            alternatives: d.alternatives,
            rationale: d.rationale,
            domain_tags: d.domain_tags,
            confidence: d.confidence,
          });
          this.decisionIds.push(decId);

          // Link any detected constraints to this decision
          for (const cId of this.constraintIds) {
            await this.recorder.edge(decId, cId, "constrained_by");
          }
        }
      }
    }

    // Also detect constraints in reasoning text
    if (this.config.detect_constraints) {
      const constraints = detectConstraints(data.text);
      for (const c of constraints) {
        const cId = await this.recorder.constraint(c.text, { source: c.source });
        this.constraintIds.push(cId);
      }
    }
  }

  private handleFileChange(data: FileChange): void {
    this.pendingFileChanges.push(data);
  }

  private async handleTestResult(data: {
    passed: number;
    failed: number;
    skipped: number;
    duration_ms: number;
  }): Promise<void> {
    // Test results are stored and attached when the implementation is flushed
    // For now, flush the implementation with the test results
    await this.flushPendingImplementation(undefined, data);
  }

  private async handleAgentComplete(data: { commit_sha?: string }): Promise<void> {
    await this.flushPendingImplementation(data.commit_sha);
  }

  private async handleSessionEnd(): Promise<void> {
    if (!this.sessionActive) return;
    await this.flushPendingImplementation();
    await this.recorder.endSession();
    this.sessionActive = false;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private async flushPendingImplementation(
    commit_sha?: string,
    test_results?: { passed: number; failed: number; skipped: number; duration_ms: number }
  ): Promise<void> {
    if (this.pendingFileChanges.length === 0) return;

    // Parent IDs: decisions if any, otherwise interpretation, otherwise directive
    const parentIds =
      this.decisionIds.length > 0
        ? this.decisionIds
        : this.currentInterpretationId
          ? [this.currentInterpretationId]
          : this.currentDirectiveId
            ? [this.currentDirectiveId]
            : [];

    if (parentIds.length === 0) return;

    const implId = await this.recorder.implementation(parentIds, {
      file_changes: [...this.pendingFileChanges],
      commit_sha,
      test_results: test_results
        ? {
            passed: test_results.passed,
            failed: test_results.failed,
            skipped: test_results.skipped,
            duration_ms: test_results.duration_ms,
          }
        : undefined,
    });

    // If we have test results, also create a verification node
    if (test_results) {
      await this.recorder.verification(implId, {
        verification_type: "test",
        result: test_results.failed === 0 ? "pass" : test_results.failed > 0 ? "fail" : "partial",
        details: `${test_results.passed} passed, ${test_results.failed} failed, ${test_results.skipped} skipped (${test_results.duration_ms}ms)`,
      });
    }

    this.pendingFileChanges = [];
  }

  private resetTurnState(): void {
    this.currentDirectiveId = null;
    this.currentInterpretationId = null;
    this.decisionIds = [];
    this.constraintIds = [];
    this.pendingFileChanges = [];
  }
}

// ---------------------------------------------------------------------------
// Decision detection - pattern-based extraction from agent text
// ---------------------------------------------------------------------------

/**
 * Detect explicit decision statements in agent output text.
 *
 * Phase 2 approach: pattern matching for common phrasings.
 * Post-MVP: LLM-assisted extraction for implicit decisions.
 */
export function detectDecisions(text: string): DetectedDecision[] {
  const decisions: DetectedDecision[] = [];

  // Pattern 1: "I'll use X instead of Y because Z"
  // Pattern 2: "I chose X over Y"
  // Pattern 3: "X rather than Y"
  // Pattern 4: "between X and Y, X is better because Z"
  const patterns = [
    /(?:I'll|I will|I'm going to|Let me|Going to)\s+use\s+(.+?)\s+(?:instead of|rather than|over)\s+(.+?)(?:\s+because\s+(.+?))?[.!,]/gi,
    /(?:I chose|I picked|I selected|choosing|opting for)\s+(.+?)\s+(?:over|instead of|rather than)\s+(.+?)(?:\s+because\s+(.+?))?[.!,]/gi,
    /(?:between|comparing)\s+(.+?)\s+and\s+(.+?),?\s+(.+?)\s+(?:is better|is preferred|makes more sense|is more appropriate)(?:\s+because\s+(.+?))?[.!,]/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const chosen = match[1]?.trim();
      const alternative = match[2]?.trim();
      const rationale = (match[3] || match[4] || "").trim();

      if (chosen && alternative) {
        decisions.push({
          chosen,
          alternatives: [
            {
              description: alternative,
              rejection_reason: rationale || undefined,
            },
          ],
          rationale: rationale || `Chose ${chosen} over ${alternative}`,
          domain_tags: extractDomainTags(text),
          confidence: rationale ? 0.8 : 0.65,
        });
      }
    }
  }

  return decisions;
}

/**
 * Detect constraint statements in agent output text.
 */
export function detectConstraints(text: string): DetectedConstraint[] {
  const constraints: DetectedConstraint[] = [];

  const patterns = [
    { regex: /(?:must|need to|required to|have to)\s+(?:use|follow|maintain|keep)\s+(.+?)(?:\.|$)/gim, source: "agent_inferred" as const },
    { regex: /(?:can't|cannot|shouldn't|must not|not allowed to)\s+(.+?)(?:\.|$)/gim, source: "agent_inferred" as const },
    { regex: /(?:existing|current|project)\s+(?:convention|pattern|rule|standard|requirement)s?\s+(?:require|dictate|specify|mandate)\s+(.+?)(?:\.|$)/gim, source: "project_rule" as const },
    { regex: /(?:per the|according to the|following the)\s+(?:project|team|code)\s+(?:guidelines?|standards?|rules?|conventions?),?\s+(.+?)(?:\.|$)/gim, source: "project_rule" as const },
  ];

  for (const { regex, source } of patterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const constraintText = match[1]?.trim();
      if (constraintText && constraintText.length > 10) {
        constraints.push({ text: constraintText, source });
      }
    }
  }

  return constraints;
}

/**
 * Extract likely domain tags from text based on keyword presence.
 */
function extractDomainTags(text: string): string[] {
  const tagKeywords: Record<string, string[]> = {
    database: ["database", "sql", "query", "schema", "migration", "postgres", "mysql", "mongo", "redis", "elasticsearch"],
    auth: ["auth", "authentication", "authorization", "oauth", "jwt", "token", "session", "login", "password", "saml"],
    api: ["api", "endpoint", "route", "rest", "graphql", "grpc", "http", "request", "response"],
    ui: ["component", "react", "vue", "angular", "css", "style", "layout", "frontend", "button", "form", "modal"],
    performance: ["performance", "cache", "caching", "optimization", "latency", "throughput", "speed", "fast"],
    security: ["security", "vulnerability", "xss", "csrf", "injection", "sanitize", "encrypt", "hash"],
    testing: ["test", "testing", "jest", "mocha", "cypress", "coverage", "assertion", "mock", "stub"],
    infrastructure: ["docker", "kubernetes", "k8s", "deploy", "ci", "cd", "pipeline", "terraform", "aws", "gcp"],
    search: ["search", "elasticsearch", "solr", "lucene", "typeahead", "autocomplete", "fuzzy"],
    architecture: ["architecture", "pattern", "design", "refactor", "modular", "microservice", "monolith"],
  };

  const lower = text.toLowerCase();
  const tags: string[] = [];

  for (const [tag, keywords] of Object.entries(tagKeywords)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      tags.push(tag);
    }
  }

  return tags;
}
