/**
 * Prufs SDK - Trail Recorder
 *
 * The main SDK class. Creates a session, records decision trail nodes
 * and edges, and dispatches events to the configured transport.
 *
 * Usage:
 *   const trail = new TrailRecorder({ project_id: "my-project", transport: "local" });
 *   await trail.startSession();
 *   const directiveId = await trail.directive("Add user search to admin panel");
 *   const interpId = await trail.interpretation(directiveId, "Implement search endpoint...", { confidence: 0.9 });
 *   const decisionId = await trail.decision(interpId, { chosen: "Elasticsearch", ... });
 *   await trail.endSession();
 */

import { v4 as uuidv4 } from "uuid";
import type {
  PrufsConfig,
  TrailEvent,
  TrailNode,
  TrailEdge,
  TrailEventType,
  DirectiveNode,
  InterpretationNode,
  DecisionNode,
  ConstraintNode,
  ImplementationNode,
  VerificationNode,
  Alternative,
  FileChange,
  TestResult,
  ConstraintSource,
  SessionPayload,
  EdgeType,
  SensitivityLevel,
} from "./types.js";
import { RESTRICTED_DOMAINS } from "./types.js";
import { LocalTransport } from "./transport-local.js";
import { HttpTransport } from "./transport-http.js";
import { loadOrCreateKeyPair, signEvent, type SigningKeyPair } from "./signing.js";

export interface Transport {
  emit(event: TrailEvent): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export class TrailRecorder {
  private config: Required<
    Pick<PrufsConfig, "project_id" | "transport" | "agent_id" | "model_id">
  > &
    PrufsConfig;
  private transport: Transport;
  private session_id: string;
  private started = false;
  private keyPair: SigningKeyPair;
  private prevHash = "0"; // genesis hash

  constructor(config: PrufsConfig) {
    this.config = {
      agent_id: "unknown",
      model_id: "unknown",
      local_db_path: ".prufs/events.db",
      flush_interval_ms: 5000,
      flush_batch_size: 50,
      signing_key_path: ".prufs/signing-key.pem",
      ...config,
    };

    this.session_id = uuidv4();

    // Initialize signing keypair
    this.keyPair = loadOrCreateKeyPair(this.config.signing_key_path!);

    if (this.config.transport === "local") {
      this.transport = new LocalTransport(this.config.local_db_path!);
    } else {
      this.transport = new HttpTransport(
        this.config.transport,
        this.config.flush_interval_ms!,
        this.config.flush_batch_size!
      );
    }
  }

  // -----------------------------------------------------------------------
  // Session lifecycle
  // -----------------------------------------------------------------------

  async startSession(): Promise<string> {
    this.started = true;
    const payload: SessionPayload = {
      session_id: this.session_id,
      project_id: this.config.project_id,
      agent_id: this.config.agent_id,
      model_id: this.config.model_id,
      started_at: new Date().toISOString(),
    };
    await this.emitEvent("session_started", payload);
    return this.session_id;
  }

  async endSession(): Promise<void> {
    this.assertStarted();
    const payload: SessionPayload = {
      session_id: this.session_id,
      project_id: this.config.project_id,
      ended_at: new Date().toISOString(),
    };
    await this.emitEvent("session_ended", payload);
    await this.transport.flush();
    await this.transport.close();
    this.started = false;
  }

  get sessionId(): string {
    return this.session_id;
  }

  // -----------------------------------------------------------------------
  // Node creation methods
  // -----------------------------------------------------------------------

  /**
   * Record a human directive - the starting point of a causal chain.
   */
  async directive(
    text: string,
    author: string = "human"
  ): Promise<string> {
    this.assertStarted();
    const node: DirectiveNode = {
      id: uuidv4(),
      type: "directive",
      timestamp: new Date().toISOString(),
      session_id: this.session_id,
      project_id: this.config.project_id,
      text,
      author,
    };
    await this.emitNode(node);
    return node.id;
  }

  /**
   * Record the agent's interpretation of a directive.
   * Automatically creates a caused_by edge to the parent directive.
   */
  async interpretation(
    directive_id: string,
    text: string,
    options: { confidence?: number; model_id?: string } = {}
  ): Promise<string> {
    this.assertStarted();
    const node: InterpretationNode = {
      id: uuidv4(),
      type: "interpretation",
      timestamp: new Date().toISOString(),
      session_id: this.session_id,
      project_id: this.config.project_id,
      text,
      agent_id: this.config.agent_id!,
      model_id: options.model_id ?? this.config.model_id!,
      confidence: options.confidence ?? 0.8,
    };
    await this.emitNode(node);
    await this.edge(node.id, directive_id, "caused_by");
    return node.id;
  }

  /**
   * Record a decision point with alternatives.
   * Automatically creates a caused_by edge to the parent node.
   */
  async decision(
    parent_id: string,
    options: {
      chosen: string;
      alternatives?: Alternative[];
      rationale: string;
      domain_tags?: string[];
      confidence?: number;
    }
  ): Promise<string> {
    this.assertStarted();
    const node: DecisionNode = {
      id: uuidv4(),
      type: "decision",
      timestamp: new Date().toISOString(),
      session_id: this.session_id,
      project_id: this.config.project_id,
      chosen: options.chosen,
      alternatives: options.alternatives ?? [],
      rationale: options.rationale,
      domain_tags: options.domain_tags ?? [],
      confidence: options.confidence ?? 0.8,
      sensitivity: classifySensitivity(options.domain_tags ?? []),
    };
    await this.emitNode(node);
    await this.edge(node.id, parent_id, "caused_by");
    return node.id;
  }

  /**
   * Record a constraint that shaped a decision.
   * Optionally link to the decision it constrained.
   */
  async constraint(
    text: string,
    options: {
      source?: ConstraintSource;
      scope?: string;
      constrains_decision_id?: string;
    } = {}
  ): Promise<string> {
    this.assertStarted();
    const node: ConstraintNode = {
      id: uuidv4(),
      type: "constraint",
      timestamp: new Date().toISOString(),
      session_id: this.session_id,
      project_id: this.config.project_id,
      text,
      source: options.source ?? "agent_inferred",
      scope: options.scope,
    };
    await this.emitNode(node);
    if (options.constrains_decision_id) {
      await this.edge(
        options.constrains_decision_id,
        node.id,
        "constrained_by"
      );
    }
    return node.id;
  }

  /**
   * Record an implementation (code change).
   * Automatically creates caused_by edges to all parent node IDs.
   */
  async implementation(
    parent_ids: string[],
    options: {
      file_changes: FileChange[];
      commit_sha?: string;
      lines_added?: number;
      lines_removed?: number;
      test_results?: TestResult;
    }
  ): Promise<string> {
    this.assertStarted();
    const node: ImplementationNode = {
      id: uuidv4(),
      type: "implementation",
      timestamp: new Date().toISOString(),
      session_id: this.session_id,
      project_id: this.config.project_id,
      file_changes: options.file_changes,
      commit_sha: options.commit_sha,
      lines_added:
        options.lines_added ??
        options.file_changes.reduce((s, f) => s + f.lines_added, 0),
      lines_removed:
        options.lines_removed ??
        options.file_changes.reduce((s, f) => s + f.lines_removed, 0),
      test_results: options.test_results,
    };
    await this.emitNode(node);
    for (const pid of parent_ids) {
      await this.edge(node.id, pid, "caused_by");
    }
    return node.id;
  }

  /**
   * Record a verification result.
   * Automatically creates verified_by edge from the implementation.
   */
  async verification(
    implementation_id: string,
    options: {
      verification_type: "test" | "review" | "production_metric" | "ci_check";
      result: "pass" | "fail" | "partial";
      details?: string;
    }
  ): Promise<string> {
    this.assertStarted();
    const node: VerificationNode = {
      id: uuidv4(),
      type: "verification",
      timestamp: new Date().toISOString(),
      session_id: this.session_id,
      project_id: this.config.project_id,
      verification_type: options.verification_type,
      result: options.result,
      details: options.details,
    };
    await this.emitNode(node);
    await this.edge(implementation_id, node.id, "verified_by");
    return node.id;
  }

  // -----------------------------------------------------------------------
  // Edge creation
  // -----------------------------------------------------------------------

  /**
   * Create an explicit edge between two nodes.
   * Most edges are created automatically by the node methods above,
   * but this is available for custom relationships.
   */
  async edge(
    from_node: string,
    to_node: string,
    type: EdgeType
  ): Promise<string> {
    this.assertStarted();
    const edge: TrailEdge = {
      id: uuidv4(),
      type,
      from_node,
      to_node,
      timestamp: new Date().toISOString(),
    };
    await this.emitEvent("edge_created", edge);
    return edge.id;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async emitNode(node: TrailNode): Promise<void> {
    await this.emitEvent("node_created", node);
  }

  private async emitEvent(
    event_type: TrailEventType,
    payload: TrailNode | TrailEdge | SessionPayload
  ): Promise<void> {
    const unsigned = {
      event_id: uuidv4(),
      event_type,
      timestamp: new Date().toISOString(),
      session_id: this.session_id,
      project_id: this.config.project_id,
      payload,
    };

    // Sign and chain
    const sigFields = signEvent(unsigned, this.keyPair, this.prevHash);

    const event: TrailEvent = {
      ...unsigned,
      ...sigFields,
    };

    // Update chain state
    this.prevHash = sigFields.content_hash;

    await this.transport.emit(event);
  }

  private assertStarted(): void {
    if (!this.started) {
      throw new Error(
        "TrailRecorder session not started. Call startSession() first."
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Sensitivity classification
// ---------------------------------------------------------------------------

/**
 * Auto-classify decision sensitivity based on domain tags.
 * Any decision touching auth, security, PII, payments, or compliance
 * is automatically restricted.
 */
function classifySensitivity(domainTags: string[]): SensitivityLevel {
  const lower = domainTags.map((t) => t.toLowerCase());
  const isRestricted = lower.some((tag) =>
    (RESTRICTED_DOMAINS as readonly string[]).includes(tag)
  );
  return isRestricted ? "restricted" : "public";
}
