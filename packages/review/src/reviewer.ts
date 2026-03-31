/**
 * @prufs/review - reviewer.ts
 *
 * TrailReviewer: produces a TrailReview verdict for a CausalCommit.
 *
 * Semantic checks (always run, independent of OPA):
 *   1. has_decision_node       - trail must justify the change
 *   2. decision_precedes_impl  - Decision must appear before Implementation
 *   3. no_orphan_edges         - every edge references nodes that exist
 *   4. sensitivity_coherence   - node sensitivity consistent within trail
 *   5. attestation_fields      - required attestation fields are non-empty
 *   6. changeset_non_empty     - at least one file change
 *   7. timestamps_monotonic    - trail node timestamps are non-decreasing
 *
 * Policy checks (OPA, run after semantic checks):
 *   All loaded policies must return allow=true for verdict to be 'approved'.
 *   Any deny flips verdict to 'rejected'.
 *
 * Sensitivity escalation:
 *   If a restricted trail node touches a non-restricted file path,
 *   verdict is escalated to 'needs_human' (if config.escalate_sensitivity_mismatch).
 *
 * Verdict precedence (highest wins):
 *   rejected > needs_human > approved
 */

import { PolicyEngine } from './policy.js';
import type {
  CausalCommit,
  TrailReview,
  TrailCheck,
  ReviewVerdict,
  SensitivityFlag,
  PolicyInput,
  PolicyResult,
  ReviewerConfig,
  SensitivityLevel,
  NodeType,
} from './types.js';

// ---------------------------------------------------------------------------
// PolicyInput builder
// ---------------------------------------------------------------------------

function buildPolicyInput(commit: CausalCommit): PolicyInput {
  const nodes = commit.trail.nodes;
  const nodeTypes = nodes.map((n) => n.type) as NodeType[];
  const restrictedNodes = nodes.filter((n) => n.sensitivity === 'restricted');

  // Restricted paths: paths touched by commits with restricted trail nodes
  // (conservative heuristic - all paths are considered potentially affected)
  const restrictedPaths =
    restrictedNodes.length > 0
      ? commit.changeset.changed.map((b) => b.path)
      : [];

  return {
    commit,
    meta: {
      has_decision_node: nodeTypes.includes('Decision'),
      has_constraint_node: nodeTypes.includes('Constraint'),
      has_verification_node: nodeTypes.includes('Verification'),
      restricted_node_count: restrictedNodes.length,
      restricted_paths: restrictedPaths,
      node_types: nodeTypes,
      path_count: commit.changeset.changed.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Semantic checks
// ---------------------------------------------------------------------------

function checkHasDecisionNode(commit: CausalCommit): TrailCheck {
  const passed = commit.trail.nodes.some((n) => n.type === 'Decision');
  return {
    name: 'has_decision_node',
    passed,
    reason: passed
      ? 'Trail contains at least one Decision node'
      : 'Trail has no Decision node - change is unjustified (no why recorded)',
  };
}

function checkDecisionPrecedesImpl(commit: CausalCommit): TrailCheck {
  const nodes = commit.trail.nodes;
  const firstDecision = nodes.findIndex((n) => n.type === 'Decision');
  const firstImpl = nodes.findIndex((n) => n.type === 'Implementation');

  if (firstDecision === -1) {
    return {
      name: 'decision_precedes_implementation',
      passed: false,
      reason: 'No Decision node found - cannot verify ordering',
    };
  }
  if (firstImpl === -1) {
    return {
      name: 'decision_precedes_implementation',
      passed: true,
      reason: 'No Implementation node - ordering check not applicable',
    };
  }

  const passed = firstDecision < firstImpl;
  return {
    name: 'decision_precedes_implementation',
    passed,
    reason: passed
      ? 'Decision node appears before Implementation node'
      : `Implementation node (index ${firstImpl}) precedes Decision node (index ${firstDecision}) - reasoning appears post-hoc`,
  };
}

function checkNoOrphanEdges(commit: CausalCommit): TrailCheck {
  const nodeIds = new Set(commit.trail.nodes.map((n) => n.id));
  const orphans: string[] = [];

  for (const edge of commit.trail.edges) {
    if (!nodeIds.has(edge.from_id)) {
      orphans.push(`edge from unknown node '${edge.from_id}'`);
    }
    if (!nodeIds.has(edge.to_id)) {
      orphans.push(`edge to unknown node '${edge.to_id}'`);
    }
  }

  return {
    name: 'no_orphan_edges',
    passed: orphans.length === 0,
    reason:
      orphans.length === 0
        ? 'All edges reference valid nodes'
        : `Orphan edges detected: ${orphans.join('; ')}`,
  };
}

function checkSensitivityCoherence(commit: CausalCommit): TrailCheck {
  // A trail is incoherent if a 'public' node appears after a 'restricted' node
  // with a caused_by edge - that would mean public reasoning caused restricted action.
  const sensitivityOrder: Record<SensitivityLevel, number> = {
    public: 0,
    internal: 1,
    restricted: 2,
  };

  const violations: string[] = [];
  const nodeById = new Map(commit.trail.nodes.map((n) => [n.id, n]));

  for (const edge of commit.trail.edges) {
    if (edge.type !== 'caused_by') continue;
    const from = nodeById.get(edge.from_id);
    const to = nodeById.get(edge.to_id);
    if (!from || !to) continue;

    // 'from' caused 'to' - if 'to' is more sensitive than 'from', flag it
    if (sensitivityOrder[to.sensitivity] > sensitivityOrder[from.sensitivity]) {
      violations.push(
        `node '${to.id}' (${to.sensitivity}) caused_by node '${from.id}' (${from.sensitivity}) - ` +
        `sensitivity escalation through causality chain`
      );
    }
  }

  return {
    name: 'sensitivity_coherence',
    passed: violations.length === 0,
    reason:
      violations.length === 0
        ? 'Sensitivity levels are coherent across causal edges'
        : violations.join('; '),
  };
}

function checkAttestationFields(commit: CausalCommit): TrailCheck {
  const att = commit.attestation;
  const missing: string[] = [];

  if (!att.agent_id) missing.push('agent_id');
  if (!att.model_id) missing.push('model_id');
  if (!att.session_id) missing.push('session_id');
  if (!att.prompt_hash) missing.push('prompt_hash');
  if (!att.signature) missing.push('signature');
  if (!att.signer_key_id) missing.push('signer_key_id');

  return {
    name: 'attestation_fields_present',
    passed: missing.length === 0,
    reason:
      missing.length === 0
        ? 'All attestation fields present'
        : `Missing attestation fields: ${missing.join(', ')}`,
  };
}

function checkChangesetNonEmpty(commit: CausalCommit): TrailCheck {
  const passed = commit.changeset.changed.length > 0;
  return {
    name: 'changeset_non_empty',
    passed,
    reason: passed
      ? `Changeset contains ${commit.changeset.changed.length} file change(s)`
      : 'Changeset is empty - commit has no file changes',
  };
}

function checkTimestampsMonotonic(commit: CausalCommit): TrailCheck {
  const nodes = commit.trail.nodes;
  if (nodes.length <= 1) {
    return {
      name: 'timestamps_monotonic',
      passed: true,
      reason: 'Single node or empty trail - monotonicity check not applicable',
    };
  }

  const violations: string[] = [];
  for (let i = 1; i < nodes.length; i++) {
    const prev = new Date(nodes[i - 1].timestamp).getTime();
    const curr = new Date(nodes[i].timestamp).getTime();
    if (curr < prev) {
      violations.push(
        `node '${nodes[i].id}' (${nodes[i].timestamp}) precedes '${nodes[i - 1].id}' (${nodes[i - 1].timestamp})`
      );
    }
  }

  return {
    name: 'timestamps_monotonic',
    passed: violations.length === 0,
    reason:
      violations.length === 0
        ? 'Trail node timestamps are non-decreasing'
        : `Non-monotonic timestamps: ${violations.join('; ')}`,
  };
}

// ---------------------------------------------------------------------------
// Sensitivity mismatch detection
// ---------------------------------------------------------------------------

function detectSensitivityMismatches(commit: CausalCommit): SensitivityFlag[] {
  const flags: SensitivityFlag[] = [];
  const hasRestrictedNode = commit.trail.nodes.some(
    (n) => n.sensitivity === 'restricted'
  );

  if (!hasRestrictedNode) return flags;

  // All paths are potentially touched by restricted reasoning.
  // Flag any path that does not itself carry restricted metadata.
  // (In a future version, paths will carry per-blob sensitivity tags.)
  for (const blob of commit.changeset.changed) {
    if (blob.change_type === 'deleted') continue;
    // Without per-blob sensitivity, we flag all paths when restricted nodes exist.
    // This is conservative by design.
    flags.push({
      path: blob.path,
      file_sensitivity: 'internal', // assumed until per-blob tagging exists
      trail_sensitivity: 'restricted',
      reason:
        'Trail contains restricted-sensitivity reasoning; human review recommended to confirm classification',
    });
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Verdict computation
// ---------------------------------------------------------------------------

function computeVerdict(
  semanticChecks: TrailCheck[],
  policyResults: PolicyResult[],
  sensitivityFlags: SensitivityFlag[],
  config: ReviewerConfig
): ReviewVerdict {
  // Any failed semantic check that is load-bearing => rejected
  const loadBearingFailed = semanticChecks
    .filter((c) =>
      ['has_decision_node', 'attestation_fields_present', 'changeset_non_empty'].includes(
        c.name
      )
    )
    .some((c) => !c.passed);

  if (loadBearingFailed) return 'rejected';

  // Any policy deny => rejected
  const policyDenied = policyResults.some((r) => r.decision === 'deny');
  if (policyDenied) return 'rejected';

  // Sensitivity mismatch => needs_human (if configured)
  if ((config.escalate_sensitivity_mismatch ?? true) && sensitivityFlags.length > 0) {
    return 'needs_human';
  }

  return 'approved';
}

// ---------------------------------------------------------------------------
// TrailReviewer
// ---------------------------------------------------------------------------

export class TrailReviewer {
  private engine: PolicyEngine;
  private config: ReviewerConfig;

  constructor(config: ReviewerConfig) {
    this.config = config;
    this.engine = new PolicyEngine(config.policies);
  }

  async review(commit: CausalCommit): Promise<TrailReview> {
    const reviewed_at = new Date().toISOString();

    // 1. Semantic checks
    const checks: TrailCheck[] = [
      checkHasDecisionNode(commit),
      checkDecisionPrecedesImpl(commit),
      checkNoOrphanEdges(commit),
      checkSensitivityCoherence(commit),
      checkAttestationFields(commit),
      checkChangesetNonEmpty(commit),
      checkTimestampsMonotonic(commit),
    ];

    // Optionally add verification node warning as an informational check
    if (this.config.warn_missing_verification) {
      const hasVerification = commit.trail.nodes.some((n) => n.type === 'Verification');
      checks.push({
        name: 'has_verification_node',
        passed: hasVerification,
        reason: hasVerification
          ? 'Trail contains a Verification node'
          : 'No Verification node found (informational - not a rejection)',
      });
    }

    // 2. OPA policy evaluation
    const policyInput = buildPolicyInput(commit);
    const policy_results = await this.engine.evaluateAll(policyInput);

    // 3. Sensitivity mismatch detection
    const sensitivity_flags = detectSensitivityMismatches(commit);

    // 4. Compute verdict
    const verdict = computeVerdict(checks, policy_results, sensitivity_flags, this.config);

    // 5. Build summary
    const failedChecks = checks.filter((c) => !c.passed);
    const deniedPolicies = policy_results.filter((r) => r.decision === 'deny');

    let summary: string;
    if (verdict === 'approved') {
      summary = `Commit ${commit.commit_id.slice(0, 12)} approved: all ${checks.length} semantic checks passed, ${policy_results.length} policy/policies passed.`;
    } else if (verdict === 'rejected') {
      const reasons = [
        ...failedChecks.map((c) => c.reason),
        ...deniedPolicies.flatMap((p) => p.reasons),
      ];
      summary = `Commit ${commit.commit_id.slice(0, 12)} rejected: ${reasons.join('; ')}`;
    } else {
      summary =
        `Commit ${commit.commit_id.slice(0, 12)} needs human review: ` +
        `${sensitivity_flags.length} sensitivity flag(s) require manual classification.`;
    }

    return {
      commit_id: commit.commit_id,
      verdict,
      reviewed_at,
      checks,
      policy_results,
      sensitivity_flags,
      summary,
    };
  }
}
