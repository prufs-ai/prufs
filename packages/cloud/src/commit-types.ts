/**
 * @prufs/cloud - CausalCommit types
 *
 * These mirror the types from @prufs/commit. When the monorepo
 * workspace is wired up, these will be imported directly from
 * @prufs/commit instead of duplicated here.
 *
 * TODO: Replace with `import type { ... } from '@prufs/commit'`
 * once workspace dependencies are configured.
 */

// --- Trail types ---

export type TrailNodeType =
  | 'Directive'
  | 'Interpretation'
  | 'Decision'
  | 'Constraint'
  | 'Implementation'
  | 'Verification';

export type TrailEdgeType =
  | 'caused_by'
  | 'constrained_by'
  | 'verified_by'
  | 'supersedes';

export type Sensitivity = 'public' | 'internal' | 'restricted';

export interface TrailNode {
  id: string;
  type: TrailNodeType;
  text: string;
  timestamp: string;
  sensitivity: Sensitivity;
  metadata?: Record<string, unknown>;
}

export interface TrailEdge {
  source: string;
  target: string;
  type: TrailEdgeType;
}

export interface TrailSnapshot {
  nodes: TrailNode[];
  edges: TrailEdge[];
  graph_hash: string;
}

// --- Agent attestation ---

export interface AgentAttestation {
  agent_id: string;
  model_id: string;
  session_id: string;
  prompt_hash: string;
  signature: string;
  signer_key_id: string;
}

// --- File changeset ---

export type ChangeType = 'add' | 'modify' | 'delete';

export interface FileChange {
  path: string;
  change_type: ChangeType;
  content_hash: string;
  content?: string;     // base64-encoded file content
  size_bytes?: number;
}

export interface FileChangeset {
  files: FileChange[];
  tree_hash: string;
}

// --- The commit itself ---

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

// --- Verification result ---

export type VerificationStep =
  | 'commit_id'
  | 'tree_hash'
  | 'graph_hash'
  | 'attestation_fields'
  | 'trail_structure'
  | 'parent_chain'
  | 'signing_key_registered'
  | 'schema';

export interface VerificationResult {
  valid: boolean;
  step?: VerificationStep;
  expected?: string;
  actual?: string;
  message?: string;
}

export const GENESIS_HASH = '0'.repeat(64);

export const VALID_NODE_TYPES: Set<string> = new Set([
  'Directive', 'Interpretation', 'Decision',
  'Constraint', 'Implementation', 'Verification',
]);

export const VALID_EDGE_TYPES: Set<string> = new Set([
  'caused_by', 'constrained_by', 'verified_by', 'supersedes',
]);
