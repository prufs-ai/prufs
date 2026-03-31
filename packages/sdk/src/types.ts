/**
 * Prufs SDK - Core Type Definitions
 *
 * These types define the decision trail data model. Six node types,
 * four edge types, and the event envelope that the SDK emits.
 *
 * Every other component in the system - ingestion, graph store, API,
 * visualizer - consumes these types.
 */

// ---------------------------------------------------------------------------
// Node types
// ---------------------------------------------------------------------------

export type NodeType =
  | "directive"
  | "interpretation"
  | "decision"
  | "constraint"
  | "implementation"
  | "verification";

export interface BaseNode {
  id: string;
  type: NodeType;
  timestamp: string; // ISO 8601
  session_id: string;
  project_id: string;
  metadata?: Record<string, unknown>;
}

/**
 * A human-issued instruction that starts a causal chain.
 * Example: "Add user search to the admin panel with typeahead"
 */
export interface DirectiveNode extends BaseNode {
  type: "directive";
  text: string;
  author: string; // human who issued the directive
}

/**
 * The agent's understanding of a directive.
 * Example: "Implement search endpoint + React component with debounced
 * typeahead using existing Elasticsearch index"
 */
export interface InterpretationNode extends BaseNode {
  type: "interpretation";
  text: string;
  agent_id: string;
  model_id: string; // e.g. "claude-sonnet-4-20250514"
  model_version?: string;
  confidence: number; // 0.0 - 1.0
}

/**
 * A choice point where alternatives existed.
 * Example: "Use Elasticsearch over PostgreSQL full-text search because
 * the index already exists and supports fuzzy matching"
 */
export interface DecisionNode extends BaseNode {
  type: "decision";
  chosen: string; // description of the chosen alternative
  alternatives: Alternative[];
  rationale: string;
  domain_tags: string[]; // e.g. ["search", "database", "performance"]
  confidence: number; // 0.0 - 1.0
  /** Auto-classified sensitivity level based on domain tags.
   *  Decisions tagged with auth, security, or pii domains are
   *  automatically classified as "restricted". The Trail API
   *  enforces RBAC on restricted nodes. */
  sensitivity?: SensitivityLevel;
}

export type SensitivityLevel =
  | "public"      // visible to all project members
  | "internal"    // visible to reviewers and project owners
  | "restricted"; // visible only to project owners and security team

/** Domain tags that auto-classify a decision as restricted */
export const RESTRICTED_DOMAINS = [
  "auth", "authentication", "authorization",
  "security", "encryption", "secrets",
  "pii", "privacy", "compliance",
  "payments", "billing", "financial",
] as const;

export interface Alternative {
  description: string;
  rejection_reason?: string;
}

/**
 * A rule or boundary that shaped the implementation.
 * Example: "Must use existing API authentication middleware;
 * no new auth patterns"
 */
export interface ConstraintNode extends BaseNode {
  type: "constraint";
  text: string;
  source: ConstraintSource;
  scope?: string; // e.g. "auth module" or "project-wide"
}

export type ConstraintSource =
  | "project_rule" // from project config, CLAUDE.md, etc.
  | "agent_inferred" // agent detected from codebase analysis
  | "human_stated"; // human explicitly stated during session

/**
 * The actual code change, linked to its causal parents.
 */
export interface ImplementationNode extends BaseNode {
  type: "implementation";
  file_changes: FileChange[];
  commit_sha?: string;
  lines_added: number;
  lines_removed: number;
  test_results?: TestResult;
}

export interface FileChange {
  path: string;
  change_type: "added" | "modified" | "deleted" | "renamed";
  lines_added: number;
  lines_removed: number;
}

export interface TestResult {
  passed: number;
  failed: number;
  skipped: number;
  duration_ms: number;
}

/**
 * Outcome validation - test results, review outcomes, production metrics.
 */
export interface VerificationNode extends BaseNode {
  type: "verification";
  verification_type: "test" | "review" | "production_metric" | "ci_check";
  result: "pass" | "fail" | "partial";
  details?: string;
}

export type TrailNode =
  | DirectiveNode
  | InterpretationNode
  | DecisionNode
  | ConstraintNode
  | ImplementationNode
  | VerificationNode;

// ---------------------------------------------------------------------------
// Edge types
// ---------------------------------------------------------------------------

export type EdgeType =
  | "caused_by"
  | "constrained_by"
  | "verified_by"
  | "supersedes";

export interface TrailEdge {
  id: string;
  type: EdgeType;
  from_node: string; // node ID
  to_node: string; // node ID
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Event envelope - what the SDK actually emits
// ---------------------------------------------------------------------------

export type TrailEventType = "node_created" | "edge_created" | "session_started" | "session_ended";

export interface TrailEvent {
  event_id: string;
  event_type: TrailEventType;
  timestamp: string;
  session_id: string;
  project_id: string;
  payload: TrailNode | TrailEdge | SessionPayload;
  /** SHA-256 hash of the serialized event (excluding signature fields) */
  content_hash: string;
  /** SHA-256 hash of the previous event in the chain (genesis event uses "0") */
  prev_hash: string;
  /** Ed25519 signature of content_hash, proving the event was created by
   *  the holder of the signing key and has not been tampered with */
  signature: string;
  /** Public key identifier (first 8 hex chars of the public key hash) */
  signer_id: string;
}

export interface SessionPayload {
  session_id: string;
  project_id: string;
  agent_id?: string;
  model_id?: string;
  started_at?: string;
  ended_at?: string;
}

// ---------------------------------------------------------------------------
// Code mapping (separate from the graph - relational data)
// ---------------------------------------------------------------------------

export interface CodeMapping {
  id: string;
  implementation_node_id: string;
  file_path: string;
  line_start: number;
  line_end: number;
  ast_node_hash?: string; // Tree-sitter node identity
  repo_id: string;
  commit_sha: string;
}

// ---------------------------------------------------------------------------
// SDK configuration
// ---------------------------------------------------------------------------

export interface PrufsConfig {
  /** Project identifier */
  project_id: string;

  /** Where to send events: "local" (SQLite queue) or an HTTP endpoint URL */
  transport: "local" | string;

  /** Path for local SQLite queue file (default: .prufs/events.db) */
  local_db_path?: string;

  /** Agent identifier (e.g. "claude-code", "cursor") */
  agent_id?: string;

  /** Model identifier (e.g. "claude-sonnet-4-20250514") */
  model_id?: string;

  /** Flush interval for batched HTTP transport, in ms (default: 5000) */
  flush_interval_ms?: number;

  /** Maximum events to batch before forcing a flush (default: 50) */
  flush_batch_size?: number;

  /** Path to Ed25519 private key for event signing.
   *  If not provided, a keypair is auto-generated and stored at
   *  .prufs/signing-key.pem. The corresponding public key
   *  is written to .prufs/signing-key.pub. */
  signing_key_path?: string;
}
