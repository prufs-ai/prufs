/**
 * @prufs/review - types.ts
 *
 * Three type families:
 *
 *   TrailReview          - semantic verdict on a single CausalCommit
 *   PolicyResult         - output from an OPA policy evaluation
 *   ChainVerificationReport - result of a continuous chain integrity sweep
 *
 * Relationship to @prufs/commit's CommitVerification:
 *   CommitVerification asks: "Are the cryptographic proofs intact?"
 *   TrailReview asks:        "Does the trail semantically justify the change?"
 *
 * They are complementary. A commit can be cryptographically valid
 * (CommitVerification.valid === true) but semantically inadequate
 * (TrailReview.verdict === 'rejected') if, for example, it has no
 * Decision node explaining a change to a restricted file.
 */

// ---------------------------------------------------------------------------
// Vendored CausalCommit surface (production: import from @prufs/commit)
// ---------------------------------------------------------------------------

export type NodeType =
  | 'Directive'
  | 'Interpretation'
  | 'Decision'
  | 'Constraint'
  | 'Implementation'
  | 'Verification';

export type EdgeType =
  | 'caused_by'
  | 'constrained_by'
  | 'verified_by'
  | 'supersedes';

export type SensitivityLevel = 'public' | 'internal' | 'restricted';

export interface TrailNode {
  id: string;
  type: NodeType;
  content: string;
  sensitivity: SensitivityLevel;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface TrailEdge {
  from_id: string;
  to_id: string;
  type: EdgeType;
}

export interface TrailSnapshot {
  nodes: TrailNode[];
  edges: TrailEdge[];
  graph_hash: string;
}

export interface AgentAttestation {
  agent_id: string;
  model_id: string;
  session_id: string;
  prompt_hash: string;
  signature: string;
  signer_key_id: string;
}

export interface ContentBlob {
  path: string;
  content_hash: string;
  content?: string;
  change_type: 'added' | 'modified' | 'deleted';
}

export interface FileChangeset {
  changed: ContentBlob[];
  tree_hash: string;
}

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export interface CausalCommit {
  commit_id: string;
  parent_hash: string;
  timestamp: string;
  trail: TrailSnapshot;
  attestation: AgentAttestation;
  changeset: FileChangeset;
  commit_signature: string;
  signer_key_id: string;
  message: string;
  branch?: string;
}

// ---------------------------------------------------------------------------
// TrailReview - semantic verdict on a single CausalCommit
// ---------------------------------------------------------------------------

export type ReviewVerdict = 'approved' | 'rejected' | 'needs_human';

export interface TrailCheck {
  /** Machine-readable check identifier */
  name: string;
  /** Whether this check passed */
  passed: boolean;
  /** Human-readable explanation */
  reason: string;
}

export interface TrailReview {
  /** The commit being reviewed */
  commit_id: string;

  /** Overall verdict */
  verdict: ReviewVerdict;

  /** ISO timestamp of when this review ran */
  reviewed_at: string;

  /** Individual check results */
  checks: TrailCheck[];

  /**
   * Policy evaluation results (one per loaded policy).
   * All policies must allow for verdict to be 'approved'.
   */
  policy_results: PolicyResult[];

  /**
   * Paths that triggered sensitivity escalation.
   * Non-empty when a 'public' or 'internal' file is touched by a
   * 'restricted' trail node - indicating the sensitivity classification
   * may need human review.
   */
  sensitivity_flags: SensitivityFlag[];

  /** Free-text summary for human readers */
  summary: string;
}

export interface SensitivityFlag {
  path: string;
  file_sensitivity: SensitivityLevel;
  trail_sensitivity: SensitivityLevel;
  reason: string;
}

// ---------------------------------------------------------------------------
// PolicyResult - output from OPA policy evaluation
// ---------------------------------------------------------------------------

export type PolicyDecision = 'allow' | 'deny' | 'unknown';

export interface PolicyResult {
  /** Policy identifier (e.g. 'prufs.payments.require_constraint') */
  policy_id: string;

  /** Allow or deny */
  decision: PolicyDecision;

  /**
   * Reasons returned by the policy.
   * For deny: explains why the commit was rejected.
   * For allow: may be empty or carry informational notes.
   */
  reasons: string[];

  /** Raw output from OPA evaluate() - preserved for audit */
  raw_output?: unknown;
}

// ---------------------------------------------------------------------------
// OPA policy input shape
// The object passed as `input` to OPA evaluate().
// Rego policies access this as `input.commit`, `input.commit.trail`, etc.
// ---------------------------------------------------------------------------

export interface PolicyInput {
  commit: CausalCommit;
  /** Prufs-computed metadata passed alongside the raw commit */
  meta: {
    has_decision_node: boolean;
    has_constraint_node: boolean;
    has_verification_node: boolean;
    restricted_node_count: number;
    restricted_paths: string[];
    node_types: NodeType[];
    path_count: number;
  };
}

// ---------------------------------------------------------------------------
// Chain verification
// ---------------------------------------------------------------------------

export type ChainCheckStatus = 'ok' | 'broken' | 'tampered' | 'skipped';

export interface ChainLinkResult {
  commit_id: string;
  parent_hash: string;
  timestamp: string;
  status: ChainCheckStatus;
  errors: string[];
}

export interface ChainVerificationReport {
  /** Branch that was swept */
  branch: string;

  /** ISO timestamp of when this sweep ran */
  swept_at: string;

  /** Number of commits inspected */
  commits_checked: number;

  /** Whether every link in the chain is intact */
  chain_intact: boolean;

  /** Per-commit link results (oldest first) */
  links: ChainLinkResult[];

  /**
   * Commit IDs where tampering was detected.
   * Non-empty means the store has been modified outside of Prufs.
   */
  tampered_commits: string[];

  /**
   * Commit IDs where the parent_hash chain is broken
   * (a commit's parent_hash does not match the prior commit_id).
   */
  broken_links: string[];

  /** Summary message */
  summary: string;
}

// ---------------------------------------------------------------------------
// Reviewer configuration
// ---------------------------------------------------------------------------

export interface ReviewerConfig {
  /**
   * Policies to evaluate against every commit.
   * At least one policy is recommended; zero policies means only
   * semantic checks run (no OPA enforcement).
   */
  policies: PolicyDefinition[];

  /**
   * If true, a commit with any restricted trail node touching a
   * non-restricted file path is escalated to 'needs_human'.
   * Default: true.
   */
  escalate_sensitivity_mismatch?: boolean;

  /**
   * If true, a commit with no Verification node is flagged (but not
   * rejected) in the review output.
   * Default: false.
   */
  warn_missing_verification?: boolean;
}

export interface PolicyDefinition {
  /** Unique identifier for this policy */
  id: string;

  /**
   * Policy implementation.
   * Production: path to a compiled OPA .wasm bundle.
   * Test/dev: a JS function with the PolicyEvaluator interface.
   */
  evaluator: PolicyEvaluator | string;
}

/**
 * PolicyEvaluator - the interface both OPA WASM bundles and JS test
 * policies must satisfy.
 *
 * Returning { allow: true } = commit passes this policy.
 * Returning { allow: false, reasons: [...] } = commit denied.
 */
export interface PolicyEvaluator {
  evaluate(input: PolicyInput): Promise<{ allow: boolean; reasons: string[] }>;
}
