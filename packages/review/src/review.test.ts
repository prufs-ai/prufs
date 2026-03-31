/**
 * @prufs/review - review.test.ts
 *
 * Suite 1: Semantic checks     - each check passes and fails correctly
 * Suite 2: PolicyEngine        - FunctionPolicy evaluation, multi-policy, deny
 * Suite 3: Built-in policies   - requireDecision, requireConstraint, requireVerification, denyPublicAgent
 * Suite 4: TrailReviewer       - approved / rejected / needs_human verdicts, summary text
 * Suite 5: ChainVerifier       - intact chain, empty branch, single commit
 * Suite 6: ChainVerifier       - tampered graph_hash, tampered tree_hash, broken parent link
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { TrailReviewer } from './reviewer.js';
import { ChainVerifier } from './chain.js';
import {
  FunctionPolicy,
  PolicyEngine,
  requireDecisionNode,
  requireConstraintForRestrictedPaths,
  requireVerificationForPaymentsPaths,
  denyPublicAgentId,
} from './policy.js';
import type {
  CausalCommit,
  TrailNode,
  ReviewerConfig,
  PolicyInput,
} from './types.js';
import { GENESIS_HASH } from './types.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const sorted = Object.keys(obj).sort()
    .map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',');
  return '{' + sorted + '}';
}

function computeGraphHash(nodes: TrailNode[], edges: unknown[]): string {
  const sortedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  return sha256(canonicalJson({ nodes: sortedNodes, edges }));
}

function computeTreeHash(blobs: unknown[]): string {
  const sorted = [...(blobs as {path:string}[])].sort((a, b) => a.path.localeCompare(b.path));
  return sha256(canonicalJson({ changed: sorted }));
}

function computeCommitId(commit: Omit<CausalCommit, 'commit_id'>): string {
  return sha256(canonicalJson(commit));
}

/**
 * Build a fully self-consistent CausalCommit whose hashes are correct.
 * This lets ChainVerifier tests work without crypto stubs.
 */
function makeCommit(
  id: string,
  opts: {
    parentHash?: string;
    nodes?: TrailNode[];
    paths?: Array<{ path: string; content: string; change_type?: 'added' | 'modified' | 'deleted' }>;
    branch?: string;
    timestamp?: string;
    agentId?: string;
  } = {}
): CausalCommit {
  const ts = opts.timestamp ?? new Date().toISOString();
  const nodes: TrailNode[] = opts.nodes ?? [
    { id: 'n-dir', type: 'Directive', content: 'Do X', sensitivity: 'internal', timestamp: ts },
    { id: 'n-dec', type: 'Decision', content: 'Use Y', sensitivity: 'internal', timestamp: ts },
  ];
  const edges: never[] = [];
  const graph_hash = computeGraphHash(nodes, edges);

  const rawBlobs = (opts.paths ?? [{ path: 'src/main.ts', content: 'code', change_type: 'added' }]).map(
    (p) => ({
      path: p.path,
      content_hash: sha256(p.content ?? ''),
      content: p.content,
      change_type: (p.change_type ?? 'added') as 'added' | 'modified' | 'deleted',
    })
  );
  const tree_hash = computeTreeHash(rawBlobs);

  const partial: Omit<CausalCommit, 'commit_id'> = {
    parent_hash: opts.parentHash ?? GENESIS_HASH,
    timestamp: ts,
    trail: { nodes, edges, graph_hash },
    attestation: {
      agent_id: opts.agentId ?? 'test-agent',
      model_id: 'claude-sonnet-4-6',
      session_id: `sess-${id}`,
      prompt_hash: sha256('prompt'),
      signature: 'fakesig',
      signer_key_id: 'key001',
    },
    changeset: { changed: rawBlobs, tree_hash },
    commit_signature: 'fakecommitsig',
    signer_key_id: 'key001',
    message: `commit ${id}`,
    branch: opts.branch ?? 'main',
  };

  return { commit_id: computeCommitId(partial), ...partial };
}

function baseConfig(overrides: Partial<ReviewerConfig> = {}): ReviewerConfig {
  return {
    policies: [],
    escalate_sensitivity_mismatch: true,
    warn_missing_verification: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite 1: Semantic checks
// ---------------------------------------------------------------------------

describe('Suite 1: Semantic checks', async () => {
  it('approved commit with valid trail passes all load-bearing checks', async () => {
    const commit = makeCommit('sem-ok');
    const reviewer = new TrailReviewer(baseConfig());
    const review = await reviewer.review(commit);

    const loadBearing = review.checks.filter((c) =>
      ['has_decision_node', 'attestation_fields_present', 'changeset_non_empty'].includes(c.name)
    );
    assert.ok(loadBearing.every((c) => c.passed), 'All load-bearing checks should pass');
  });

  it('has_decision_node fails when trail has no Decision node', async () => {
    const ts = new Date().toISOString();
    const commit = makeCommit('sem-no-dec', {
      nodes: [
        { id: 'n1', type: 'Directive', content: 'Do X', sensitivity: 'internal', timestamp: ts },
      ],
    });
    const reviewer = new TrailReviewer(baseConfig());
    const review = await reviewer.review(commit);

    const check = review.checks.find((c) => c.name === 'has_decision_node')!;
    assert.equal(check.passed, false);
    assert.equal(review.verdict, 'rejected');
  });

  it('decision_precedes_implementation fails when Implementation appears before Decision', async () => {
    const ts = new Date().toISOString();
    const commit = makeCommit('sem-order', {
      nodes: [
        { id: 'n-impl', type: 'Implementation', content: 'wrote code', sensitivity: 'internal', timestamp: ts },
        { id: 'n-dec', type: 'Decision', content: 'decided after', sensitivity: 'internal', timestamp: ts },
      ],
    });
    const reviewer = new TrailReviewer(baseConfig());
    const review = await reviewer.review(commit);

    const check = review.checks.find((c) => c.name === 'decision_precedes_implementation')!;
    assert.equal(check.passed, false);
    assert.ok(check.reason.includes('post-hoc'));
  });

  it('no_orphan_edges fails when edge references missing node', async () => {
    const ts = new Date().toISOString();
    const commit = makeCommit('sem-orphan', {
      nodes: [
        { id: 'n-dir', type: 'Directive', content: 'X', sensitivity: 'internal', timestamp: ts },
        { id: 'n-dec', type: 'Decision', content: 'Y', sensitivity: 'internal', timestamp: ts },
      ],
    });
    // Manually inject a bad edge
    (commit.trail.edges as unknown[]).push({ from_id: 'ghost-node', to_id: 'n-dec', type: 'caused_by' });

    const reviewer = new TrailReviewer(baseConfig());
    const review = await reviewer.review(commit);

    const check = review.checks.find((c) => c.name === 'no_orphan_edges')!;
    assert.equal(check.passed, false);
    assert.ok(check.reason.includes('ghost-node'));
  });

  it('timestamps_monotonic fails when node timestamps go backward', async () => {
    const earlier = new Date(Date.now() - 5000).toISOString();
    const later = new Date().toISOString();
    const commit = makeCommit('sem-time', {
      nodes: [
        { id: 'n-dir', type: 'Directive', content: 'X', sensitivity: 'internal', timestamp: later },
        { id: 'n-dec', type: 'Decision', content: 'Y', sensitivity: 'internal', timestamp: earlier },
      ],
    });
    const reviewer = new TrailReviewer(baseConfig());
    const review = await reviewer.review(commit);

    const check = review.checks.find((c) => c.name === 'timestamps_monotonic')!;
    assert.equal(check.passed, false);
  });

  it('changeset_non_empty fails when no files changed', async () => {
    const commit = makeCommit('sem-empty', { paths: [] });
    // Override changeset to empty
    (commit.changeset as { changed: unknown[] }).changed = [];
    const reviewer = new TrailReviewer(baseConfig());
    const review = await reviewer.review(commit);

    const check = review.checks.find((c) => c.name === 'changeset_non_empty')!;
    assert.equal(check.passed, false);
    assert.equal(review.verdict, 'rejected');
  });

  it('warn_missing_verification adds informational check when configured', async () => {
    const commit = makeCommit('sem-verify-warn');
    const reviewer = new TrailReviewer(baseConfig({ warn_missing_verification: true }));
    const review = await reviewer.review(commit);

    const check = review.checks.find((c) => c.name === 'has_verification_node');
    assert.ok(check, 'has_verification_node check should appear');
    assert.equal(check!.passed, false);
    // Should not cause rejection on its own
    assert.equal(review.verdict, 'approved');
  });
});

// ---------------------------------------------------------------------------
// Suite 2: PolicyEngine
// ---------------------------------------------------------------------------

describe('Suite 2: PolicyEngine', async () => {
  it('returns empty results when no policies configured', async () => {
    const engine = new PolicyEngine([]);
    const commit = makeCommit('pe-empty');
    const input: PolicyInput = {
      commit,
      meta: {
        has_decision_node: true,
        has_constraint_node: false,
        has_verification_node: false,
        restricted_node_count: 0,
        restricted_paths: [],
        node_types: ['Decision'],
        path_count: 1,
      },
    };
    const results = await engine.evaluateAll(input);
    assert.equal(results.length, 0);
  });

  it('FunctionPolicy allow returns decision=allow', async () => {
    const policy = new FunctionPolicy(() => ({ allow: true, reasons: [] }));
    const commit = makeCommit('pe-allow');
    const result = await policy.evaluate({
      commit,
      meta: { has_decision_node: true, has_constraint_node: false, has_verification_node: false, restricted_node_count: 0, restricted_paths: [], node_types: ['Decision'], path_count: 1 },
    });
    assert.equal(result.allow, true);
  });

  it('FunctionPolicy deny returns decision=deny with reasons', async () => {
    const policy = new FunctionPolicy(() => ({
      allow: false,
      reasons: ['test denial reason'],
    }));
    const commit = makeCommit('pe-deny');
    const result = await policy.evaluate({
      commit,
      meta: { has_decision_node: true, has_constraint_node: false, has_verification_node: false, restricted_node_count: 0, restricted_paths: [], node_types: ['Decision'], path_count: 1 },
    });
    assert.equal(result.allow, false);
    assert.ok(result.reasons.includes('test denial reason'));
  });

  it('all policies must allow for engine to return all-allow', async () => {
    const engine = new PolicyEngine([
      { id: 'p1', evaluator: new FunctionPolicy(() => ({ allow: true, reasons: [] })) },
      { id: 'p2', evaluator: new FunctionPolicy(() => ({ allow: true, reasons: [] })) },
    ]);
    const commit = makeCommit('pe-all-allow');
    const input: PolicyInput = {
      commit,
      meta: { has_decision_node: true, has_constraint_node: false, has_verification_node: false, restricted_node_count: 0, restricted_paths: [], node_types: ['Decision'], path_count: 1 },
    };
    const results = await engine.evaluateAll(input);
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.decision === 'allow'));
  });

  it('one denying policy causes that result to be deny', async () => {
    const engine = new PolicyEngine([
      { id: 'p-ok', evaluator: new FunctionPolicy(() => ({ allow: true, reasons: [] })) },
      { id: 'p-deny', evaluator: new FunctionPolicy(() => ({ allow: false, reasons: ['nope'] })) },
    ]);
    const commit = makeCommit('pe-one-deny');
    const input: PolicyInput = {
      commit,
      meta: { has_decision_node: true, has_constraint_node: false, has_verification_node: false, restricted_node_count: 0, restricted_paths: [], node_types: ['Decision'], path_count: 1 },
    };
    const results = await engine.evaluateAll(input);
    const denyResult = results.find((r) => r.policy_id === 'p-deny')!;
    assert.equal(denyResult.decision, 'deny');
    assert.ok(denyResult.reasons.includes('nope'));
  });

  it('async policy evaluator is supported', async () => {
    const policy = new FunctionPolicy(async () => {
      await new Promise((r) => setTimeout(r, 1));
      return { allow: true, reasons: ['async ok'] };
    });
    const result = await policy.evaluate({
      commit: makeCommit('pe-async'),
      meta: { has_decision_node: true, has_constraint_node: false, has_verification_node: false, restricted_node_count: 0, restricted_paths: [], node_types: [], path_count: 0 },
    });
    assert.equal(result.allow, true);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Built-in policies
// ---------------------------------------------------------------------------

describe('Suite 3: Built-in policies', async () => {
  function makeInput(overrides: Partial<PolicyInput['meta']>): PolicyInput {
    const commit = makeCommit('bp-commit');
    return {
      commit,
      meta: {
        has_decision_node: true,
        has_constraint_node: false,
        has_verification_node: false,
        restricted_node_count: 0,
        restricted_paths: [],
        node_types: ['Decision'],
        path_count: 1,
        ...overrides,
      },
    };
  }

  it('requireDecisionNode: allows when Decision node present', async () => {
    const result = await requireDecisionNode().evaluate(makeInput({ has_decision_node: true }));
    assert.equal(result.allow, true);
  });

  it('requireDecisionNode: denies when no Decision node', async () => {
    const result = await requireDecisionNode().evaluate(makeInput({ has_decision_node: false }));
    assert.equal(result.allow, false);
    assert.ok(result.reasons[0].includes('Decision node'));
  });

  it('requireConstraintForRestrictedPaths: allows when no restricted nodes', async () => {
    const result = await requireConstraintForRestrictedPaths().evaluate(
      makeInput({ restricted_node_count: 0 })
    );
    assert.equal(result.allow, true);
  });

  it('requireConstraintForRestrictedPaths: denies when restricted without Constraint', async () => {
    const result = await requireConstraintForRestrictedPaths().evaluate(
      makeInput({ restricted_node_count: 2, has_constraint_node: false })
    );
    assert.equal(result.allow, false);
    assert.ok(result.reasons[0].includes('Constraint node'));
  });

  it('requireConstraintForRestrictedPaths: allows when restricted with Constraint', async () => {
    const result = await requireConstraintForRestrictedPaths().evaluate(
      makeInput({ restricted_node_count: 1, has_constraint_node: true })
    );
    assert.equal(result.allow, true);
  });

  it('requireVerificationForPaymentsPaths: allows non-payments paths without Verification', async () => {
    const input = makeInput({ restricted_paths: ['src/utils.ts'], has_verification_node: false });
    const result = await requireVerificationForPaymentsPaths().evaluate(input);
    assert.equal(result.allow, true);
  });

  it('requireVerificationForPaymentsPaths: denies payments path without Verification', async () => {
    const input = makeInput({
      restricted_paths: ['payments/transfer.ts'],
      has_verification_node: false,
    });
    const result = await requireVerificationForPaymentsPaths().evaluate(input);
    assert.equal(result.allow, false);
    assert.ok(result.reasons[0].includes('payments'));
  });

  it('requireVerificationForPaymentsPaths: allows payments path with Verification', async () => {
    const input = makeInput({
      restricted_paths: ['payments/transfer.ts'],
      has_verification_node: true,
    });
    const result = await requireVerificationForPaymentsPaths().evaluate(input);
    assert.equal(result.allow, true);
  });

  it('denyPublicAgentId: allows normal agent_id', async () => {
    const commit = makeCommit('bp-agent-ok', { agentId: 'claude-code-prufs-hook' });
    const result = await denyPublicAgentId().evaluate({
      commit,
      meta: { has_decision_node: true, has_constraint_node: false, has_verification_node: false, restricted_node_count: 0, restricted_paths: [], node_types: ['Decision'], path_count: 1 },
    });
    assert.equal(result.allow, true);
  });

  it('denyPublicAgentId: denies agent_id containing "anonymous"', async () => {
    const commit = makeCommit('bp-agent-anon', { agentId: 'anonymous-agent' });
    const result = await denyPublicAgentId().evaluate({
      commit,
      meta: { has_decision_node: true, has_constraint_node: false, has_verification_node: false, restricted_node_count: 0, restricted_paths: [], node_types: ['Decision'], path_count: 1 },
    });
    assert.equal(result.allow, false);
    assert.ok(result.reasons[0].includes('anonymous-agent'));
  });
});

// ---------------------------------------------------------------------------
// Suite 4: TrailReviewer verdicts
// ---------------------------------------------------------------------------

describe('Suite 4: TrailReviewer verdicts', async () => {
  it('clean commit with no policies returns approved', async () => {
    const commit = makeCommit('rv-approved');
    const reviewer = new TrailReviewer(baseConfig());
    const review = await reviewer.review(commit);
    assert.equal(review.verdict, 'approved');
    assert.ok(review.summary.includes('approved'));
  });

  it('missing Decision node returns rejected', async () => {
    const ts = new Date().toISOString();
    const commit = makeCommit('rv-reject-nodec', {
      nodes: [{ id: 'n1', type: 'Directive', content: 'X', sensitivity: 'internal', timestamp: ts }],
    });
    const reviewer = new TrailReviewer(baseConfig());
    const review = await reviewer.review(commit);
    assert.equal(review.verdict, 'rejected');
    assert.ok(review.summary.includes('rejected'));
  });

  it('policy denial returns rejected', async () => {
    const commit = makeCommit('rv-reject-policy');
    const reviewer = new TrailReviewer(baseConfig({
      policies: [
        { id: 'deny-all', evaluator: new FunctionPolicy(() => ({ allow: false, reasons: ['denied by test policy'] })) },
      ],
    }));
    const review = await reviewer.review(commit);
    assert.equal(review.verdict, 'rejected');
    assert.ok(review.policy_results[0].decision === 'deny');
  });

  it('restricted trail node with files escalates to needs_human', async () => {
    const ts = new Date().toISOString();
    const commit = makeCommit('rv-needs-human', {
      nodes: [
        { id: 'n-dir', type: 'Directive', content: 'X', sensitivity: 'restricted', timestamp: ts },
        { id: 'n-dec', type: 'Decision', content: 'Y', sensitivity: 'restricted', timestamp: ts },
      ],
      paths: [{ path: 'auth/secret.ts', content: 'secret', change_type: 'modified' }],
    });
    const reviewer = new TrailReviewer(baseConfig({ escalate_sensitivity_mismatch: true }));
    const review = await reviewer.review(commit);
    assert.equal(review.verdict, 'needs_human');
    assert.ok(review.sensitivity_flags.length >= 1);
  });

  it('escalate_sensitivity_mismatch=false leaves verdict as approved despite flags', async () => {
    const ts = new Date().toISOString();
    const commit = makeCommit('rv-no-escalate', {
      nodes: [
        { id: 'n-dir', type: 'Directive', content: 'X', sensitivity: 'restricted', timestamp: ts },
        { id: 'n-dec', type: 'Decision', content: 'Y', sensitivity: 'restricted', timestamp: ts },
      ],
    });
    const reviewer = new TrailReviewer(baseConfig({ escalate_sensitivity_mismatch: false }));
    const review = await reviewer.review(commit);
    assert.equal(review.verdict, 'approved');
  });

  it('review output carries policy_results from all configured policies', async () => {
    const commit = makeCommit('rv-multi-policy');
    const reviewer = new TrailReviewer(baseConfig({
      policies: [
        { id: 'p1', evaluator: requireDecisionNode() },
        { id: 'p2', evaluator: new FunctionPolicy(() => ({ allow: true, reasons: [] })) },
      ],
    }));
    const review = await reviewer.review(commit);
    assert.equal(review.policy_results.length, 2);
    assert.ok(review.policy_results.every((r) => r.decision === 'allow'));
  });

  it('review verdict is rejected takes precedence over needs_human', async () => {
    const ts = new Date().toISOString();
    // No Decision node (rejected) AND restricted nodes (needs_human) - rejected wins
    const commit = makeCommit('rv-precedence', {
      nodes: [
        { id: 'n-dir', type: 'Directive', content: 'X', sensitivity: 'restricted', timestamp: ts },
      ],
    });
    const reviewer = new TrailReviewer(baseConfig({ escalate_sensitivity_mismatch: true }));
    const review = await reviewer.review(commit);
    assert.equal(review.verdict, 'rejected');
  });
});

// ---------------------------------------------------------------------------
// Suite 5: ChainVerifier - intact chains
// ---------------------------------------------------------------------------

describe('Suite 5: ChainVerifier - intact chains', () => {
  function makeStore(commits: CausalCommit[]) {
    return {
      head: (branch = 'main') => {
        const bc = commits.filter((c) => (c.branch ?? 'main') === branch);
        return bc[bc.length - 1];
      },
      log: (branch = 'main', limit = 1000) =>
        [...commits]
          .filter((c) => (c.branch ?? 'main') === branch)
          .slice(-limit)
          .reverse(),
    };
  }

  it('empty branch returns chain_intact=true and 0 commits_checked', () => {
    const verifier = new ChainVerifier(makeStore([]));
    const report = verifier.verify('main');
    assert.equal(report.chain_intact, true);
    assert.equal(report.commits_checked, 0);
    assert.equal(report.tampered_commits.length, 0);
    assert.equal(report.broken_links.length, 0);
  });

  it('single commit with correct hashes passes', () => {
    const c1 = makeCommit('chain-single');
    const verifier = new ChainVerifier(makeStore([c1]));
    const report = verifier.verify('main');
    assert.equal(report.chain_intact, true);
    assert.equal(report.commits_checked, 1);
    assert.equal(report.links[0].status, 'ok');
  });

  it('two-commit chain with correct parent_hash passes', () => {
    const t1 = new Date(Date.now() - 2000).toISOString();
    const t2 = new Date().toISOString();
    const c1 = makeCommit('chain-two-1', { timestamp: t1 });
    const c2 = makeCommit('chain-two-2', { parentHash: c1.commit_id, timestamp: t2 });

    const verifier = new ChainVerifier(makeStore([c1, c2]));
    const report = verifier.verify('main');
    assert.equal(report.chain_intact, true);
    assert.equal(report.commits_checked, 2);
    assert.ok(report.links.every((l) => l.status === 'ok'));
  });

  it('three-commit chain passes end-to-end', () => {
    const t1 = new Date(Date.now() - 4000).toISOString();
    const t2 = new Date(Date.now() - 2000).toISOString();
    const t3 = new Date().toISOString();
    const c1 = makeCommit('chain-three-1', { timestamp: t1 });
    const c2 = makeCommit('chain-three-2', { parentHash: c1.commit_id, timestamp: t2 });
    const c3 = makeCommit('chain-three-3', { parentHash: c2.commit_id, timestamp: t3 });

    const verifier = new ChainVerifier(makeStore([c1, c2, c3]));
    const report = verifier.verify('main');
    assert.equal(report.chain_intact, true);
    assert.equal(report.commits_checked, 3);
    assert.ok(report.summary.includes('intact'));
  });

  it('verify() respects limit parameter', () => {
    const commits: CausalCommit[] = [];
    let prev = GENESIS_HASH;
    for (let i = 0; i < 10; i++) {
      const ts = new Date(Date.now() - (10 - i) * 1000).toISOString();
      const c = makeCommit(`chain-limit-${i}`, { parentHash: prev, timestamp: ts });
      commits.push(c);
      prev = c.commit_id;
    }
    const verifier = new ChainVerifier(makeStore(commits));
    const report = verifier.verify('main', 5);
    assert.equal(report.commits_checked, 5);
  });
});

// ---------------------------------------------------------------------------
// Suite 6: ChainVerifier - tampered and broken chains
// ---------------------------------------------------------------------------

describe('Suite 6: ChainVerifier - tampering detection', () => {
  function makeStore(commits: CausalCommit[]) {
    return {
      head: (branch = 'main') => commits[commits.length - 1],
      log: (branch = 'main', limit = 1000) => [...commits].slice(-limit).reverse(),
    };
  }

  it('mutated graph_hash is detected as tampered', () => {
    const c1 = makeCommit('tamp-graph');
    // Mutate stored graph_hash after the fact
    (c1.trail as { graph_hash: string }).graph_hash = 'deadbeef' + '0'.repeat(56);

    const verifier = new ChainVerifier(makeStore([c1]));
    const report = verifier.verify('main');
    assert.equal(report.chain_intact, false);
    assert.ok(report.tampered_commits.includes(c1.commit_id));
    assert.ok(report.links[0].errors.some((e) => e.includes('graph_hash')));
  });

  it('mutated tree_hash is detected as tampered', () => {
    const c1 = makeCommit('tamp-tree');
    (c1.changeset as { tree_hash: string }).tree_hash = 'cafebabe' + '0'.repeat(56);

    const verifier = new ChainVerifier(makeStore([c1]));
    const report = verifier.verify('main');
    assert.equal(report.chain_intact, false);
    assert.ok(report.tampered_commits.includes(c1.commit_id));
    assert.ok(report.links[0].errors.some((e) => e.includes('tree_hash')));
  });

  it('mutated commit_id is detected as tampered', () => {
    const c1 = makeCommit('tamp-id');
    // Replace commit_id with something wrong
    (c1 as { commit_id: string }).commit_id = 'badc0de' + '0'.repeat(57);

    const verifier = new ChainVerifier(makeStore([c1]));
    const report = verifier.verify('main');
    assert.equal(report.chain_intact, false);
    assert.ok(report.links[0].errors.some((e) => e.includes('commit_id')));
  });

  it('broken parent_hash link is detected', () => {
    const t1 = new Date(Date.now() - 2000).toISOString();
    const t2 = new Date().toISOString();
    const c1 = makeCommit('broken-c1', { timestamp: t1 });
    const c2 = makeCommit('broken-c2', { parentHash: c1.commit_id, timestamp: t2 });

    // Sever the link: change c2's parent_hash to something random
    (c2 as { parent_hash: string }).parent_hash = 'ffffffff' + '0'.repeat(56);

    const verifier = new ChainVerifier(makeStore([c1, c2]));
    const report = verifier.verify('main');
    assert.equal(report.chain_intact, false);
    assert.ok(report.broken_links.length >= 1 || report.tampered_commits.length >= 1,
      'Should detect broken link or tampered commit');
  });

  it('intact commit before tampered one still shows ok', () => {
    const t1 = new Date(Date.now() - 2000).toISOString();
    const t2 = new Date().toISOString();
    const c1 = makeCommit('partial-ok-c1', { timestamp: t1 });
    const c2 = makeCommit('partial-ok-c2', { parentHash: c1.commit_id, timestamp: t2 });

    // Only tamper c2's graph_hash
    (c2.trail as { graph_hash: string }).graph_hash = 'badhash' + '0'.repeat(57);

    const verifier = new ChainVerifier(makeStore([c1, c2]));
    const report = verifier.verify('main');
    assert.equal(report.chain_intact, false);
    assert.equal(report.links[0].status, 'ok');   // c1 intact
    assert.equal(report.links[1].status, 'tampered'); // c2 tampered
  });

  it('summary message contains INTEGRITY VIOLATION when chain is broken', () => {
    const c1 = makeCommit('summ-tamp');
    (c1.trail as { graph_hash: string }).graph_hash = 'bad' + '0'.repeat(61);

    const verifier = new ChainVerifier(makeStore([c1]));
    const report = verifier.verify('main');
    assert.ok(report.summary.includes('INTEGRITY VIOLATION'));
  });
});
