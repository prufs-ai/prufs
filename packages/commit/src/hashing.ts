/**
 * @prufs/commit - hashing.ts
 *
 * Canonical JSON hashing for deterministic, tamper-evident content addressing.
 *
 * "Canonical" means keys are sorted recursively so two objects with the same
 * fields in different insertion order produce identical bytes - and therefore
 * identical hashes.
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type {
  TrailSnapshot,
  FileChangeset,
  CausalCommit,
  TrailNode,
  TrailEdge,
  ContentBlob,
} from './types.js';

// ---------------------------------------------------------------------------
// Canonical JSON
// ---------------------------------------------------------------------------

/**
 * Produce a deterministic JSON string: keys sorted at every level,
 * arrays preserved in order (order matters for edges and blobs).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const sorted = Object.keys(obj)
    .sort()
    .map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k]))
    .join(',');
  return '{' + sorted + '}';
}

// ---------------------------------------------------------------------------
// Core hash primitive
// ---------------------------------------------------------------------------

export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  return bytesToHex(sha256(bytes));
}

// ---------------------------------------------------------------------------
// TrailSnapshot hash
// Nodes sorted by id, edges sorted by from_id then to_id for determinism.
// ---------------------------------------------------------------------------

function sortedNodes(nodes: TrailNode[]): TrailNode[] {
  return [...nodes].sort((a, b) => a.id.localeCompare(b.id));
}

function sortedEdges(edges: TrailEdge[]): TrailEdge[] {
  return [...edges].sort((a, b) => {
    const f = a.from_id.localeCompare(b.from_id);
    return f !== 0 ? f : a.to_id.localeCompare(b.to_id);
  });
}

export function computeGraphHash(
  nodes: TrailNode[],
  edges: TrailEdge[]
): string {
  const canonical = canonicalJson({
    nodes: sortedNodes(nodes),
    edges: sortedEdges(edges),
  });
  return sha256Hex(canonical);
}

export function buildTrailSnapshot(
  nodes: TrailNode[],
  edges: TrailEdge[]
): TrailSnapshot {
  return {
    nodes: sortedNodes(nodes),
    edges: sortedEdges(edges),
    graph_hash: computeGraphHash(nodes, edges),
  };
}

// ---------------------------------------------------------------------------
// FileChangeset hash
// Blobs sorted by path for determinism.
// ---------------------------------------------------------------------------

function sortedBlobs(blobs: ContentBlob[]): ContentBlob[] {
  return [...blobs].sort((a, b) => a.path.localeCompare(b.path));
}

export function computeTreeHash(blobs: ContentBlob[]): string {
  const canonical = canonicalJson({ changed: sortedBlobs(blobs) });
  return sha256Hex(canonical);
}

export function buildFileChangeset(blobs: ContentBlob[]): FileChangeset {
  return {
    changed: sortedBlobs(blobs),
    tree_hash: computeTreeHash(blobs),
  };
}

export function computeBlobHash(content: string): string {
  return sha256Hex(content);
}

// ---------------------------------------------------------------------------
// Attestation preimage
// What gets signed by the agent's Ed25519 key in AgentAttestation.
// ---------------------------------------------------------------------------

export function attestationPreimage(
  agent_id: string,
  model_id: string,
  session_id: string,
  prompt_hash: string
): string {
  return sha256Hex(
    canonicalJson({ agent_id, model_id, session_id, prompt_hash })
  );
}

// ---------------------------------------------------------------------------
// Commit signature preimage
// Binds the what (tree_hash) to the why (graph_hash) with identity + time.
// ---------------------------------------------------------------------------

export function commitSignaturePreimage(
  tree_hash: string,
  graph_hash: string,
  parent_hash: string,
  agent_id: string,
  timestamp: string
): string {
  return sha256Hex(
    canonicalJson({ tree_hash, graph_hash, parent_hash, agent_id, timestamp })
  );
}

// ---------------------------------------------------------------------------
// commit_id
// SHA-256 of the full commit minus the commit_id field itself.
// ---------------------------------------------------------------------------

export function computeCommitId(commit: Omit<CausalCommit, 'commit_id'>): string {
  return sha256Hex(canonicalJson(commit));
}
