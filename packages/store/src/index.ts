/**
 * @prufs/store - public API
 */

export { PrufsStore } from './store.js';
export { mergeCommits, overlappingPaths, isCommitRestricted, pathSet } from './merge.js';
export { SqlJsAdapter, BetterSqlite3Adapter, createInMemoryDb, SCHEMA_DDL } from './db.js';
export type {
  CausalCommit,
  TrailNode,
  TrailEdge,
  TrailSnapshot,
  AgentAttestation,
  ContentBlob,
  FileChangeset,
  MergeResult,
  MergeConflict,
  MergeStrategy,
  MergeOutcome,
  StoreStats,
  SensitivityLevel,
} from './types.js';
export { GENESIS_HASH } from './types.js';
