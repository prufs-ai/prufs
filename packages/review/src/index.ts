/**
 * @prufs/review
 *
 * Trail review, OPA policy gates, and continuous chain verification.
 *
 * Entry points:
 *   TrailReviewer   - semantic + policy verdict on a single CausalCommit
 *   ChainVerifier   - continuous tamper-detection sweep over a commit log
 *   PolicyEngine    - evaluates OPA policies against a PolicyInput
 *
 * Built-in policies (ready to use without Rego compilation):
 *   requireDecisionNode
 *   requireConstraintForRestrictedPaths
 *   requireVerificationForPaymentsPaths
 *   denyPublicAgentId
 *
 * Test / dev:
 *   FunctionPolicy  - wrap a JS function as a PolicyEvaluator
 *
 * Production:
 *   OpaWasmPolicy   - load a compiled OPA .wasm bundle
 */

export { TrailReviewer } from './reviewer.js';
export { ChainVerifier } from './chain.js';
export type { ChainStoreAdapter } from './chain.js';

export {
  PolicyEngine,
  FunctionPolicy,
  OpaWasmPolicy,
  requireDecisionNode,
  requireConstraintForRestrictedPaths,
  requireVerificationForPaymentsPaths,
  denyPublicAgentId,
} from './policy.js';
export type { PolicyFn } from './policy.js';

export type {
  // Core commit types (vendored from @prufs/commit)
  CausalCommit,
  TrailNode,
  TrailEdge,
  TrailSnapshot,
  AgentAttestation,
  ContentBlob,
  FileChangeset,
  NodeType,
  EdgeType,
  SensitivityLevel,

  // Review types
  TrailReview,
  TrailCheck,
  ReviewVerdict,
  SensitivityFlag,
  ReviewerConfig,
  PolicyDefinition,
  PolicyEvaluator,
  PolicyInput,
  PolicyResult,
  PolicyDecision,

  // Chain types
  ChainVerificationReport,
  ChainLinkResult,
  ChainCheckStatus,
} from './types.js';

export { GENESIS_HASH } from './types.js';
