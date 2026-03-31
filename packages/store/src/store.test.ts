/**
 * @prufs/store - store.test.ts
 *
 * 6 test suites using Node.js built-in test runner.
 *
 * Suite 1: Schema init       - tables + indexes created correctly
 * Suite 2: Blob deduplication - identical content stored exactly once
 * Suite 3: put/get roundtrip  - verify + store + retrieve a commit
 * Suite 4: CRDT disjoint merge - different files, auto-merge
 * Suite 5: CRDT LWW merge     - overlapping files, timestamp winner
 * Suite 6: Human gate         - restricted trail node blocks auto-merge
 *
 * All tests use the SqlJsAdapter (WASM, zero native deps).
 * Never attempt to instantiate BetterSqlite3Adapter in this test file.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import type { DbAdapter } from './db.js';
import { createInMemoryDb } from './db.js';
import { PrufsStore } from './store.js';
import { mergeCommits } from './merge.js';
import type { CausalCommit, TrailNode } from './types.js';
import { GENESIS_HASH } from './types.js';

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

let _dbAdapter: DbAdapter;

/**
 * Build a minimal valid CausalCommit for testing.
 * Bypasses @prufs/commit builder (no crypto) so tests are fast and
 * have no external deps. The store does not re-verify signatures.
 */
function makeCommit(overrides: Partial<CausalCommit> & { commit_id: string }): CausalCommit {
  const branch = overrides.branch ?? 'main';
  const parentHash = overrides.parent_hash ?? GENESIS_HASH;
  const timestamp = overrides.timestamp ?? new Date().toISOString();

  const nodes: TrailNode[] = overrides.trail?.nodes ?? [
    {
      id: 'node-directive-1',
      type: 'Directive',
      content: 'Implement feature X',
      sensitivity: 'internal',
      timestamp,
    },
    {
      id: 'node-decision-1',
      type: 'Decision',
      content: 'Use TypeScript for type safety',
      sensitivity: 'internal',
      timestamp,
    },
  ];

  const changed = overrides.changeset?.changed ?? [
    {
      path: 'src/feature.ts',
      content_hash: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
      content: 'export const feature = () => "hello";',
      change_type: 'added' as const,
    },
  ];

  return {
    commit_id: overrides.commit_id,
    parent_hash: parentHash,
    timestamp,
    trail: overrides.trail ?? {
      nodes,
      edges: [],
      graph_hash: 'fakegraphhash0000000000000000000000000000000000000000000000000000',
    },
    attestation: overrides.attestation ?? {
      agent_id: 'test-agent',
      model_id: 'claude-sonnet-4-6',
      session_id: 'session-001',
      prompt_hash: 'prompthash00000000000000000000000000000000000000000000000000000000',
      signature: 'fakesig00000000000000000000000000000000000000000000000000000000',
      signer_key_id: 'testkey001',
    },
    changeset: {
      changed,
      tree_hash: overrides.changeset?.tree_hash ??
        'faketreehash000000000000000000000000000000000000000000000000000000',
    },
    commit_signature: overrides.commit_signature ??
      'fakecommitsig0000000000000000000000000000000000000000000000000000',
    signer_key_id: overrides.signer_key_id ?? 'testkey001',
    message: overrides.message ?? 'Test commit',
    branch,
  };
}

/** Minimal restricted commit - trail has a 'restricted' node */
function makeRestrictedCommit(id: string, path: string, ts?: string): CausalCommit {
  const timestamp = ts ?? new Date().toISOString();
  return makeCommit({
    commit_id: id,
    timestamp,
    trail: {
      nodes: [
        {
          id: 'node-directive-r',
          type: 'Directive',
          content: 'Update auth module',
          sensitivity: 'restricted',
          timestamp,
        },
        {
          id: 'node-decision-r',
          type: 'Decision',
          content: 'Rotate signing keys',
          sensitivity: 'restricted',
          timestamp,
        },
      ],
      edges: [],
      graph_hash: 'restrictedgraphhash000000000000000000000000000000000000000000000',
    },
    changeset: {
      changed: [
        {
          path,
          content_hash: `hash-restricted-${id}`,
          content: `// restricted: ${id}`,
          change_type: 'modified',
        },
      ],
      tree_hash: `treehash-restricted-${id}`,
    },
  });
}

// ---------------------------------------------------------------------------
// Suite 1: Schema init
// ---------------------------------------------------------------------------

describe('Suite 1: Schema init', async () => {
  let db: DbAdapter;

  before(async () => {
    db = await createInMemoryDb();
    // PrufsStore constructor calls initSchema()
    new PrufsStore(db);
  });

  it('creates the blobs table', () => {
    const row = db.get<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='blobs'`
    );
    assert.equal(row?.name, 'blobs');
  });

  it('creates the commits table', () => {
    const row = db.get<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='commits'`
    );
    assert.equal(row?.name, 'commits');
  });

  it('creates the commit_blobs table', () => {
    const row = db.get<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='commit_blobs'`
    );
    assert.equal(row?.name, 'commit_blobs');
  });

  it('creates the branch_heads table', () => {
    const row = db.get<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='branch_heads'`
    );
    assert.equal(row?.name, 'branch_heads');
  });

  it('creates the merge_log table', () => {
    const row = db.get<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='merge_log'`
    );
    assert.equal(row?.name, 'merge_log');
  });

  it('creates indexes on commits table', () => {
    const indexes = db.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='commits'`
    );
    const names = indexes.map((r) => r.name);
    assert.ok(names.includes('idx_commits_branch'), 'idx_commits_branch missing');
    assert.ok(names.includes('idx_commits_parent'), 'idx_commits_parent missing');
    assert.ok(names.includes('idx_commits_timestamp'), 'idx_commits_timestamp missing');
  });

  it('is idempotent - re-running schema DDL does not throw', async () => {
    const db2 = await createInMemoryDb();
    const store = new PrufsStore(db2);
    // Call initSchema again by creating a second store on same db - no throw
    assert.doesNotThrow(() => new PrufsStore(db2));
    db2.close();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Blob deduplication
// ---------------------------------------------------------------------------

describe('Suite 2: Blob deduplication', async () => {
  let store: PrufsStore;

  before(async () => {
    const db = await createInMemoryDb();
    store = new PrufsStore(db);
  });

  it('stores a blob on first put()', () => {
    const commit = makeCommit({
      commit_id: 'dedup-commit-1',
      changeset: {
        changed: [
          {
            path: 'src/hello.ts',
            content_hash: 'dedup-hash-aaa',
            content: 'export const hello = "world";',
            change_type: 'added',
          },
        ],
        tree_hash: 'dedup-tree-1',
      },
    });
    store.put(commit);
    const blobs = store.blobs('dedup-commit-1');
    assert.equal(blobs.length, 1);
    assert.equal(blobs[0].content, 'export const hello = "world";');
  });

  it('deduplicates: second commit with identical content_hash does not add a new blob row', () => {
    const commit2 = makeCommit({
      commit_id: 'dedup-commit-2',
      parent_hash: 'dedup-commit-1',
      timestamp: new Date(Date.now() + 1000).toISOString(),
      changeset: {
        changed: [
          {
            // Same content_hash as commit-1 blob - should INSERT OR IGNORE
            path: 'src/hello-copy.ts',
            content_hash: 'dedup-hash-aaa',
            content: 'export const hello = "world";',
            change_type: 'added',
          },
        ],
        tree_hash: 'dedup-tree-2',
      },
    });
    store.put(commit2);

    const stats = store.stats();
    // Only 1 blob row because content_hash is identical
    assert.equal(stats.blob_count, 1, 'Expected exactly 1 blob (dedup)');
    assert.equal(stats.commit_count, 2);
  });

  it('stores a new blob when content_hash differs', () => {
    const commit3 = makeCommit({
      commit_id: 'dedup-commit-3',
      parent_hash: 'dedup-commit-2',
      timestamp: new Date(Date.now() + 2000).toISOString(),
      changeset: {
        changed: [
          {
            path: 'src/other.ts',
            content_hash: 'dedup-hash-bbb',
            content: 'export const other = 42;',
            change_type: 'added',
          },
        ],
        tree_hash: 'dedup-tree-3',
      },
    });
    store.put(commit3);

    const stats = store.stats();
    assert.equal(stats.blob_count, 2, 'Expected 2 blobs after new content_hash');
  });

  it('put() is idempotent - storing same commit twice does not duplicate', () => {
    const commit = makeCommit({
      commit_id: 'dedup-idempotent',
      changeset: {
        changed: [
          {
            path: 'src/idempotent.ts',
            content_hash: 'hash-idempotent-111',
            content: 'export const x = 1;',
            change_type: 'added',
          },
        ],
        tree_hash: 'tree-idempotent',
      },
    });

    const db2Adapter = store['db']; // access private for count check
    store.put(commit);
    store.put(commit); // second call should be no-op

    const stats = store.stats();
    // blob_count should include previous 2 + 1 new = 3, not 4
    assert.equal(stats.blob_count, 3);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: put/get roundtrip
// ---------------------------------------------------------------------------

describe('Suite 3: put/get roundtrip', async () => {
  let store: PrufsStore;

  before(async () => {
    const db = await createInMemoryDb();
    store = new PrufsStore(db);
  });

  it('get() returns undefined for unknown commit_id', () => {
    const result = store.get('nonexistent-id');
    assert.equal(result, undefined);
  });

  it('put() then get() returns the original commit', () => {
    const original = makeCommit({
      commit_id: 'roundtrip-commit-1',
      message: 'Roundtrip test commit',
    });
    store.put(original);
    const retrieved = store.get('roundtrip-commit-1');
    assert.ok(retrieved, 'commit should exist');
    assert.equal(retrieved.commit_id, original.commit_id);
    assert.equal(retrieved.message, 'Roundtrip test commit');
    assert.equal(retrieved.attestation.agent_id, original.attestation.agent_id);
  });

  it('retrieved commit has correct trail nodes', () => {
    const commit = store.get('roundtrip-commit-1')!;
    assert.equal(commit.trail.nodes.length, 2);
    assert.ok(commit.trail.nodes.some((n) => n.type === 'Decision'));
    assert.ok(commit.trail.nodes.some((n) => n.type === 'Directive'));
  });

  it('head() returns the HEAD commit for a branch', () => {
    const commit = makeCommit({
      commit_id: 'roundtrip-head-1',
      branch: 'feature-x',
      timestamp: new Date().toISOString(),
    });
    store.put(commit);
    const head = store.head('feature-x');
    assert.ok(head, 'HEAD should exist');
    assert.equal(head.commit_id, 'roundtrip-head-1');
  });

  it('head() returns undefined for unknown branch', () => {
    const result = store.head('no-such-branch');
    assert.equal(result, undefined);
  });

  it('log() returns commits in reverse-chronological order', () => {
    const t1 = new Date(Date.now() - 2000).toISOString();
    const t2 = new Date(Date.now() - 1000).toISOString();
    const t3 = new Date().toISOString();

    store.put(makeCommit({ commit_id: 'log-c1', branch: 'log-branch', timestamp: t1 }));
    store.put(makeCommit({ commit_id: 'log-c2', branch: 'log-branch', timestamp: t2, parent_hash: 'log-c1' }));
    store.put(makeCommit({ commit_id: 'log-c3', branch: 'log-branch', timestamp: t3, parent_hash: 'log-c2' }));

    const log = store.log('log-branch', 10);
    assert.equal(log.length, 3);
    // Newest first
    assert.equal(log[0].commit_id, 'log-c3');
    assert.equal(log[2].commit_id, 'log-c1');
  });

  it('blobs() returns all file blobs for a commit', () => {
    const commit = makeCommit({
      commit_id: 'blob-listing-1',
      changeset: {
        changed: [
          { path: 'a.ts', content_hash: 'hash-a', content: 'a', change_type: 'added' },
          { path: 'b.ts', content_hash: 'hash-b', content: 'b', change_type: 'modified' },
        ],
        tree_hash: 'tree-blob-listing',
      },
    });
    store.put(commit);
    const blobs = store.blobs('blob-listing-1');
    assert.equal(blobs.length, 2);
    const paths = blobs.map((b) => b.path).sort();
    assert.deepEqual(paths, ['a.ts', 'b.ts']);
  });

  it('resolve() returns latest content for a path on a branch', () => {
    const t1 = new Date(Date.now() - 1000).toISOString();
    const t2 = new Date().toISOString();

    store.put(makeCommit({
      commit_id: 'resolve-c1',
      branch: 'resolve-branch',
      timestamp: t1,
      changeset: {
        changed: [{ path: 'main.ts', content_hash: 'hash-v1', content: 'v1', change_type: 'added' }],
        tree_hash: 'tree-r1',
      },
    }));
    store.put(makeCommit({
      commit_id: 'resolve-c2',
      branch: 'resolve-branch',
      timestamp: t2,
      parent_hash: 'resolve-c1',
      changeset: {
        changed: [{ path: 'main.ts', content_hash: 'hash-v2', content: 'v2', change_type: 'modified' }],
        tree_hash: 'tree-r2',
      },
    }));

    const content = store.resolve('main.ts', 'resolve-branch');
    assert.equal(content, 'v2', 'resolve() should return latest version');
  });
});

// ---------------------------------------------------------------------------
// Suite 4: CRDT disjoint merge
// ---------------------------------------------------------------------------

describe('Suite 4: CRDT disjoint merge', async () => {
  let store: PrufsStore;

  before(async () => {
    const db = await createInMemoryDb();
    store = new PrufsStore(db);
  });

  it('two commits touching different paths produce outcome=merged', () => {
    const base = makeCommit({
      commit_id: 'disjoint-base',
      changeset: {
        changed: [{ path: 'src/alpha.ts', content_hash: 'hash-alpha', content: 'alpha', change_type: 'added' }],
        tree_hash: 'tree-alpha',
      },
    });
    const incoming = makeCommit({
      commit_id: 'disjoint-incoming',
      changeset: {
        changed: [{ path: 'src/beta.ts', content_hash: 'hash-beta', content: 'beta', change_type: 'added' }],
        tree_hash: 'tree-beta',
      },
    });

    store.put(base);
    store.put(incoming);

    const result = store.merge(base, incoming);
    assert.equal(result.outcome, 'merged');
    assert.equal(result.strategy_used, 'disjoint_auto');
    assert.equal(result.conflicts.length, 0);
  });

  it('merge result detail mentions disjoint', () => {
    const base = makeCommit({
      commit_id: 'disjoint2-base',
      changeset: {
        changed: [{ path: 'x.ts', content_hash: 'hash-x', content: 'x', change_type: 'added' }],
        tree_hash: 'tree-x',
      },
    });
    const incoming = makeCommit({
      commit_id: 'disjoint2-incoming',
      changeset: {
        changed: [{ path: 'y.ts', content_hash: 'hash-y', content: 'y', change_type: 'added' }],
        tree_hash: 'tree-y',
      },
    });

    store.put(base);
    store.put(incoming);

    const result = store.merge(base, incoming);
    assert.ok(
      result.detail.toLowerCase().includes('disjoint'),
      `Expected "disjoint" in detail, got: ${result.detail}`
    );
  });

  it('merge_log records disjoint merge', () => {
    const db = store['db'];
    const rows = db.all<{ strategy: string; outcome: string }>(
      `SELECT strategy, outcome FROM merge_log WHERE strategy = 'disjoint_auto'`
    );
    assert.ok(rows.length >= 2, 'Expected at least 2 disjoint_auto merge log entries');
    assert.ok(rows.every((r) => r.outcome === 'merged'));
  });

  it('pure mergeCommits() function returns disjoint_auto without a store', () => {
    const a = makeCommit({
      commit_id: 'pure-a',
      changeset: {
        changed: [{ path: 'pure/a.ts', content_hash: 'hash-pa', content: 'a', change_type: 'added' }],
        tree_hash: 'tree-pa',
      },
    });
    const b = makeCommit({
      commit_id: 'pure-b',
      changeset: {
        changed: [{ path: 'pure/b.ts', content_hash: 'hash-pb', content: 'b', change_type: 'added' }],
        tree_hash: 'tree-pb',
      },
    });
    const result = mergeCommits(a, b);
    assert.equal(result.strategy_used, 'disjoint_auto');
    assert.equal(result.outcome, 'merged');
  });
});

// ---------------------------------------------------------------------------
// Suite 5: CRDT LWW merge
// ---------------------------------------------------------------------------

describe('Suite 5: CRDT LWW merge', async () => {
  let store: PrufsStore;

  before(async () => {
    const db = await createInMemoryDb();
    store = new PrufsStore(db);
  });

  it('two commits touching the same non-restricted path produce outcome=merged with lww_auto', () => {
    const tEarlier = new Date(Date.now() - 5000).toISOString();
    const tLater = new Date().toISOString();

    const base = makeCommit({
      commit_id: 'lww-base',
      timestamp: tEarlier,
      changeset: {
        changed: [{ path: 'shared.ts', content_hash: 'hash-v-old', content: 'old', change_type: 'modified' }],
        tree_hash: 'tree-lww-base',
      },
    });
    const incoming = makeCommit({
      commit_id: 'lww-incoming',
      timestamp: tLater,
      changeset: {
        changed: [{ path: 'shared.ts', content_hash: 'hash-v-new', content: 'new', change_type: 'modified' }],
        tree_hash: 'tree-lww-incoming',
      },
    });

    store.put(base);
    store.put(incoming);

    const result = store.merge(base, incoming);
    assert.equal(result.outcome, 'merged');
    assert.equal(result.strategy_used, 'lww_auto');
  });

  it('LWW winner is the commit with the later timestamp', () => {
    const tEarlier = new Date(Date.now() - 5000).toISOString();
    const tLater = new Date().toISOString();

    const older = makeCommit({
      commit_id: 'lww-older',
      timestamp: tEarlier,
      changeset: {
        changed: [{ path: 'contested.ts', content_hash: 'hash-old', content: 'old', change_type: 'modified' }],
        tree_hash: 'tree-older',
      },
    });
    const newer = makeCommit({
      commit_id: 'lww-newer',
      timestamp: tLater,
      changeset: {
        changed: [{ path: 'contested.ts', content_hash: 'hash-new', content: 'new', change_type: 'modified' }],
        tree_hash: 'tree-newer',
      },
    });

    const result = mergeCommits(older, newer);
    assert.equal(result.merged_commit_id, 'lww-newer', 'Newer timestamp should win');
  });

  it('LWW winner when base is newer than incoming', () => {
    const tEarlier = new Date(Date.now() - 5000).toISOString();
    const tLater = new Date().toISOString();

    const older = makeCommit({
      commit_id: 'lww-base-wins-a',
      timestamp: tEarlier,
      changeset: {
        changed: [{ path: 'flip.ts', content_hash: 'hash-flip-a', content: 'a', change_type: 'added' }],
        tree_hash: 'tree-flip-a',
      },
    });
    const newer = makeCommit({
      commit_id: 'lww-base-wins-b',
      timestamp: tLater,
      changeset: {
        changed: [{ path: 'flip.ts', content_hash: 'hash-flip-b', content: 'b', change_type: 'modified' }],
        tree_hash: 'tree-flip-b',
      },
    });

    // Pass newer as base, older as incoming - base should still win (it's newer)
    const result = mergeCommits(newer, older);
    assert.equal(result.merged_commit_id, 'lww-base-wins-b', 'newer (base) should win');
  });

  it('LWW surfaces conflict records for overlapping paths', () => {
    const t1 = new Date(Date.now() - 2000).toISOString();
    const t2 = new Date().toISOString();

    const a = makeCommit({
      commit_id: 'lww-conflict-a',
      timestamp: t1,
      changeset: {
        changed: [
          { path: 'p1.ts', content_hash: 'ha1', content: 'a', change_type: 'added' },
          { path: 'p2.ts', content_hash: 'ha2', content: 'a', change_type: 'added' },
        ],
        tree_hash: 'tree-a',
      },
    });
    const b = makeCommit({
      commit_id: 'lww-conflict-b',
      timestamp: t2,
      changeset: {
        changed: [
          { path: 'p1.ts', content_hash: 'hb1', content: 'b', change_type: 'modified' },
          { path: 'p3.ts', content_hash: 'hb3', content: 'b', change_type: 'added' },
        ],
        tree_hash: 'tree-b',
      },
    });

    const result = mergeCommits(a, b);
    assert.equal(result.strategy_used, 'lww_auto');
    // Only p1.ts overlaps
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].path, 'p1.ts');
  });
});

// ---------------------------------------------------------------------------
// Suite 6: Human gate
// ---------------------------------------------------------------------------

describe('Suite 6: Human gate', async () => {
  let store: PrufsStore;

  before(async () => {
    const db = await createInMemoryDb();
    store = new PrufsStore(db);
  });

  it('restricted trail node on overlapping path blocks auto-merge', () => {
    const ts = new Date().toISOString();
    const restricted = makeRestrictedCommit('gate-restricted-1', 'auth/keys.ts', ts);
    const normal = makeCommit({
      commit_id: 'gate-normal-1',
      timestamp: ts,
      changeset: {
        changed: [{ path: 'auth/keys.ts', content_hash: 'hash-normal-keys', content: 'normal', change_type: 'modified' }],
        tree_hash: 'tree-normal-gate',
      },
    });

    store.put(restricted);
    store.put(normal);

    const result = store.merge(restricted, normal);
    assert.equal(result.outcome, 'pending_human');
    assert.equal(result.strategy_used, 'human_gate');
  });

  it('human gate produces conflicts for each restricted path', () => {
    const ts = new Date().toISOString();
    const restricted = makeRestrictedCommit('gate-multi-restricted', 'payments/secret.ts', ts);
    const normal = makeCommit({
      commit_id: 'gate-multi-normal',
      timestamp: ts,
      changeset: {
        changed: [
          { path: 'payments/secret.ts', content_hash: 'hash-pay', content: 'pay', change_type: 'modified' },
        ],
        tree_hash: 'tree-pay',
      },
    });

    const result = mergeCommits(restricted, normal);
    assert.equal(result.outcome, 'pending_human');
    assert.ok(result.conflicts.length >= 1);
    assert.ok(
      result.conflicts.every((c) => c.strategy === 'human_gate'),
      'All conflicts should use human_gate strategy'
    );
  });

  it('human gate triggers when incoming (not base) is restricted', () => {
    const ts = new Date().toISOString();
    const normal = makeCommit({
      commit_id: 'gate-base-normal',
      timestamp: ts,
      changeset: {
        changed: [{ path: 'src/shared.ts', content_hash: 'hash-shared', content: 'shared', change_type: 'modified' }],
        tree_hash: 'tree-shared',
      },
    });
    const restricted = makeRestrictedCommit('gate-incoming-restricted', 'src/shared.ts', ts);

    const result = mergeCommits(normal, restricted);
    assert.equal(result.outcome, 'pending_human');
    assert.equal(result.strategy_used, 'human_gate');
  });

  it('non-overlapping paths with restricted trail do NOT trigger human gate', () => {
    // Restricted commit touches a different path than normal - disjoint, no gate
    const ts = new Date().toISOString();
    const restricted = makeRestrictedCommit('gate-disjoint-restricted', 'auth/private.ts', ts);
    const normal = makeCommit({
      commit_id: 'gate-disjoint-normal',
      timestamp: ts,
      changeset: {
        changed: [{ path: 'src/public.ts', content_hash: 'hash-pub', content: 'pub', change_type: 'added' }],
        tree_hash: 'tree-pub',
      },
    });

    const result = mergeCommits(restricted, normal);
    // Disjoint - different paths - no overlap to gate
    assert.equal(result.strategy_used, 'disjoint_auto');
    assert.equal(result.outcome, 'merged');
  });

  it('merge_log records pending_human outcome', () => {
    const ts = new Date().toISOString();
    const r = makeRestrictedCommit('gate-log-r', 'log-test.ts', ts);
    const n = makeCommit({
      commit_id: 'gate-log-n',
      timestamp: ts,
      changeset: {
        changed: [{ path: 'log-test.ts', content_hash: 'hash-log-n', content: 'n', change_type: 'modified' }],
        tree_hash: 'tree-log-n',
      },
    });

    store.put(r);
    store.put(n);
    store.merge(r, n);

    const db = store['db'];
    const rows = db.all<{ outcome: string }>(
      `SELECT outcome FROM merge_log WHERE outcome = 'pending_human'`
    );
    assert.ok(rows.length >= 1, 'Expected at least 1 pending_human merge log entry');
  });

  it('stats() reflects correct commit and blob counts after all inserts', () => {
    const stats = store.stats();
    assert.ok(stats.commit_count >= 4, `Expected >= 4 commits, got ${stats.commit_count}`);
    assert.ok(stats.blob_count >= 1, 'Expected at least 1 blob');
    assert.ok(stats.branch_count >= 1, 'Expected at least 1 branch');
  });
});
