/**
 * @prufs/sdk
 *
 * Decision trail capture SDK for AI coding agents.
 *
 * Quick start:
 *   import { TrailRecorder } from "@prufs/sdk";
 *
 *   const trail = new TrailRecorder({
 *     project_id: "my-project",
 *     transport: "local",
 *     agent_id: "claude-code",
 *     model_id: "claude-sonnet-4-20250514",
 *   });
 *
 *   await trail.startSession();
 *   const d = await trail.directive("Add user search to admin panel");
 *   const i = await trail.interpretation(d, "Implement search endpoint...");
 *   const dec = await trail.decision(i, {
 *     chosen: "Elasticsearch",
 *     alternatives: [{ description: "PostgreSQL FTS", rejection_reason: "No existing index" }],
 *     rationale: "Elasticsearch index already exists and supports fuzzy matching",
 *     domain_tags: ["search", "database"],
 *   });
 *   await trail.endSession();
 */

export { TrailRecorder } from "./recorder.js";
export { LocalTransport } from "./transport-local.js";
export { HttpTransport } from "./transport-http.js";
export { SessionObserver, detectDecisions, detectConstraints } from "./hooks/session-observer.js";
export { ClaudeCodeHook } from "./hooks/claude-code.js";
export {
  loadOrCreateKeyPair,
  signEvent,
  computeContentHash,
  verifyEvent,
  verifyChain,
} from "./signing.js";
export { RESTRICTED_DOMAINS } from "./types.js";

export type {
  // Node types
  TrailNode,
  DirectiveNode,
  InterpretationNode,
  DecisionNode,
  ConstraintNode,
  ImplementationNode,
  VerificationNode,
  NodeType,
  Alternative,
  FileChange,
  TestResult,
  ConstraintSource,
  SensitivityLevel,
  // Edge types
  TrailEdge,
  EdgeType,
  // Events
  TrailEvent,
  TrailEventType,
  SessionPayload,
  // Code mapping
  CodeMapping,
  // Config
  PrufsConfig,
} from "./types.js";

export type {
  SigningKeyPair,
  SignedEvent,
  VerificationResult,
} from "./signing.js";

export type {
  AgentEvent,
  AgentEventType,
  DetectedDecision,
  DetectedConstraint,
  SessionObserverConfig,
} from "./hooks/session-observer.js";
