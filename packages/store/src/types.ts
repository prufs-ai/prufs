/**
 * @prufs/store - types.ts
 *
 * Re-declares the CausalCommit type surface from @prufs/commit.
 * Vendored here to avoid requiring a published npm dep in the sandbox.
 * In production, import directly from @prufs/commit.
 */

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
// Store-specific types
// ---------------------------------------------------------------------------

export type MergeStrategy = 'disjoint_auto' | 'lww_auto' | 'human_gate';
export type MergeOutcome = 'merged' | 'pending_human' | 'conflict';

export interface MergeConflict {
  path: string;
  strategy: MergeStrategy;
  reason: string;
  /** commit_ids that touched this path */
  source_commits: string[];
}

export interface MergeResult {
  outcome: MergeOutcome;
  merged_commit_id?: string;
  conflicts: MergeConflict[];
  strategy_used: MergeStrategy;
  detail: string;
}

export interface StoreStats {
  commit_count: number;
  blob_count: number;
  branch_count: number;
  total_blob_bytes: number;
}
