/**
 * @prufs/commit
 *
 * The CausalCommit primitive for Prufs Phase 2.
 * Git tracks what changed. Prufs commits track why - with proof.
 */

export type {
  CausalCommit,
  CommitInput,
  CommitVerification,
  TrailSnapshot,
  TrailNode,
  TrailEdge,
  AgentAttestation,
  FileChangeset,
  ContentBlob,
  SensitivityLevel,
  EdgeType,
  NodeType,
} from './types.js';

export { GENESIS_HASH } from './types.js';

export {
  buildCommit,
  generateKeypair,
  keypairFromHex,
  keypairToHex,
} from './builder.js';

export type { SigningKeypair } from './builder.js';

export {
  verifyCommit,
  verifyChain,
  validateCommitInput,
} from './validator.js';

export {
  buildTrailSnapshot,
  buildFileChangeset,
  computeBlobHash,
  computeGraphHash,
  computeTreeHash,
  canonicalJson,
  sha256Hex,
} from './hashing.js';
