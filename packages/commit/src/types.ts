/**
 * @prufs/commit - types.ts
 *
 * CausalCommit: the core primitive of Prufs Phase 2.
 *
 * A CausalCommit extends a content-addressed file snapshot with two
 * things Git commits cannot express:
 *   1. AgentAttestation  - who (human + agent + model) drove this change
 *   2. TrailSnapshot     - the causal decision graph that justifies it
 *
 * Invariants enforced at commit time (see validator.ts):
 *   - graph_hash == SHA-256(canonical(nodes + edges))
 *   - trail must contain >= 1 Decision node
 *   - commit_signature covers tree_hash + graph_hash + parent_hash + agent_id
 *   - parent_hash == "genesis" XOR a valid prior commit_id
 */

// ---------------------------------------------------------------------------
// Re-export compatible trail types (Phase 1 @prufs/sdk compatibility)
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

// ---------------------------------------------------------------------------
// TrailSnapshot - the causal graph at commit time
// ---------------------------------------------------------------------------

export interface TrailSnapshot {
  /** All trail nodes recorded during this agent session */
  nodes: TrailNode[];
  /** All causal edges between nodes */
  edges: TrailEdge[];
  /**
   * SHA-256 of canonical JSON of { nodes, edges } (sorted by id).
   * Computed by snapshotHash() - must be verified before accepting a commit.
   */
  graph_hash: string;
}

// ---------------------------------------------------------------------------
// AgentAttestation - cryptographic identity of the agent that made this commit
// ---------------------------------------------------------------------------

export interface AgentAttestation {
  /**
   * Stable identifier for the agent integration (e.g. "claude-code-prufs-hook").
   * Set by the SDK when initialising a session.
   */
  agent_id: string;

  /**
   * Model identifier as reported by the LLM provider
   * (e.g. "claude-sonnet-4-6", "gpt-4o-2024-05-13").
   */
  model_id: string;

  /**
   * Session ID from @prufs/sdk TrailRecorder - links this commit back to
   * the full in-flight trail in Neo4j.
   */
  session_id: string;

  /**
   * SHA-256 of the original human directive that initiated this session.
   * Allows correlation without storing the raw prompt in the commit.
   */
  prompt_hash: string;

  /**
   * Ed25519 signature of:
   *   SHA-256(agent_id + model_id + session_id + prompt_hash)
   * using the agent's signing key (rotated per session).
   */
  signature: string;

  /** Hex fingerprint of the Ed25519 public key used to sign */
  signer_key_id: string;
}

// ---------------------------------------------------------------------------
// FileChangeset - the what (content diff)
// ---------------------------------------------------------------------------

export interface ContentBlob {
  /** Repo-relative path */
  path: string;
  /** SHA-256 of file contents */
  content_hash: string;
  /** Raw file contents as UTF-8 (omitted in lightweight refs) */
  content?: string;
  /** 'added' | 'modified' | 'deleted' */
  change_type: 'added' | 'modified' | 'deleted';
}

export interface FileChangeset {
  changed: ContentBlob[];
  /**
   * SHA-256 of canonical JSON of changed[] sorted by path.
   * The tree_hash is what gets signed - it binds the file changes
   * to the causal trail irrevocably.
   */
  tree_hash: string;
}

// ---------------------------------------------------------------------------
// CausalCommit - the top-level primitive
// ---------------------------------------------------------------------------

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export interface CausalCommit {
  /**
   * SHA-256 of canonical JSON of the full commit (excluding commit_id itself).
   * This is the content-addressed identifier - equal inputs always produce
   * the same commit_id.
   */
  commit_id: string;

  /**
   * commit_id of the parent commit, or GENESIS_HASH for the first commit
   * in a repo. Forms the tamper-evident hash chain.
   */
  parent_hash: string;

  /** ISO 8601 timestamp - monotonically increasing within a branch */
  timestamp: string;

  /** The causal decision graph that justifies this change */
  trail: TrailSnapshot;

  /** Cryptographic identity of the agent (human + LLM + session) */
  attestation: AgentAttestation;

  /** The actual file changes */
  changeset: FileChangeset;

  /**
   * Ed25519 signature over:
   *   SHA-256(tree_hash + graph_hash + parent_hash + agent_id + timestamp)
   *
   * Tamper-evident binding of what changed to why it changed.
   * Verified by verifyCommit() before any commit is accepted into the store.
   */
  commit_signature: string;

  /** Hex fingerprint of the signing key (matches attestation.signer_key_id) */
  signer_key_id: string;

  /** Human-readable summary derived from the first Directive node */
  message: string;

  /** Optional branch name */
  branch?: string;
}

// ---------------------------------------------------------------------------
// Commit builder input (before hashes are computed)
// ---------------------------------------------------------------------------

export interface CommitInput {
  parent_hash: string;
  trail: Omit<TrailSnapshot, 'graph_hash'>;
  attestation: Omit<AgentAttestation, 'signature' | 'signer_key_id' | 'prompt_hash'>;
  changeset: Omit<FileChangeset, 'tree_hash'>;
  message?: string;
  branch?: string;
}

// ---------------------------------------------------------------------------
// Verification result
// ---------------------------------------------------------------------------

export interface CommitVerification {
  valid: boolean;
  commit_id: string;
  checks: {
    graph_hash_valid: boolean;
    tree_hash_valid: boolean;
    attestation_sig_valid: boolean;
    commit_sig_valid: boolean;
    has_decision_node: boolean;
    parent_hash_present: boolean;
  };
  errors: string[];
}
