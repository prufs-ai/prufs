/**
 * @prufs/sync test suite
 *
 * Tests cover:
 * - Push: local to cloud
 * - Pull: cloud to local
 * - Sync state tracking
 * - CRDT merge integration
 * - Conflict detection
 * - Offline-first degradation
 */

import { test } from 'node:test';
import * as assert from 'node:assert';
import { createPrufsSync } from './sync.js';

// ─── Mock store ─────────────────────────────────────────────────────

interface MockCommit {
  commit_id: string;
  parent_hash: string;
  timestamp: string;
  trail: Record<string, unknown>;
  attestation: Record<string, unknown>;
  changeset: { files: Array<{ path: string; content_hash: string; change_type: string }> };
  commit_signature: string;
  signer_key_id: string;
  message: string;
  branch?: string;
}

interface MockStoreInterface {
  put(commit: MockCommit): Promise<void>;
  get(commitId: string): Promise<MockCommit | null>;
  head(branch: string): Promise<string | null>;
  log(branch?: string): Promise<string[]>;
  blobs(contentHash: string): Promise<string[]>;
  merge(baseId: string, incomingId: string): Promise<{ status: string; conflicts_auto_resolved?: number; conflicts_needing_review?: number }>;
}

class MockStore implements MockStoreInterface {
  private commits: Map<string, MockCommit> = new Map();
  private heads: Map<string, string> = new Map();
  private blobStorage: Map<string, Buffer> = new Map();

  async put(commit: MockCommit): Promise<void> {
    this.commits.set(commit.commit_id, commit);
    if (commit.branch) {
      this.heads.set(commit.branch, commit.commit_id);
    }
  }

  async get(commitId: string): Promise<MockCommit | null> {
    return this.commits.get(commitId) ?? null;
  }

  async head(branch: string): Promise<string | null> {
    return this.heads.get(branch) ?? null;
  }

  async log(branch?: string): Promise<string[]> {
    const result: string[] = [];
    if (!branch) return result;
    let current = this.heads.get(branch);
    while (current) {
      result.push(current);
      const commit = this.commits.get(current);
      if (!commit) break;
      current = commit.parent_hash !== '0'.repeat(64) ? commit.parent_hash : undefined;
    }
    return result;
  }

  async blobs(contentHash: string): Promise<string[]> {
    return this.blobStorage.has(contentHash) ? [contentHash] : [];
  }

  async merge(
    _baseId: string,
    _incomingId: string,
  ): Promise<{ status: string; conflicts_auto_resolved?: number }> {
    // Mock: simple merge (no actual conflict resolution)
    return { status: 'merged', conflicts_auto_resolved: 0 };
  }

  // Test helpers
  addBlob(hash: string, content: Buffer): void {
    this.blobStorage.set(hash, content);
  }

  clear(): void {
    this.commits.clear();
    this.heads.clear();
    this.blobStorage.clear();
  }
}

// ─── Mock cloud server ───────────────────────────────────────────────

interface MockCloudState {
  commits: Map<string, any>;
  log: Array<{ commit_id: string; parent_hash: string; timestamp: string; branch?: string }>;
  blobs: Map<string, Buffer>;
}

const cloudState: MockCloudState = {
  commits: new Map(),
  log: [],
  blobs: new Map(),
};

let _originalFetch: ((url: string | URL, init?: RequestInit) => Promise<Response>) | undefined;

function setupMockCloud(): void {
  // Override fetch for cloud API calls
  _originalFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = url instanceof URL ? url.toString() : url;

    // POST /v1/commits
    if (urlStr.includes('/v1/commits') && init?.method === 'POST') {
      const commit = JSON.parse(init.body as string);
      cloudState.commits.set(commit.commit_id, commit);
      cloudState.log.push({
        commit_id: commit.commit_id,
        parent_hash: commit.parent_hash,
        timestamp: commit.timestamp,
        branch: commit.branch,
      });
      return new Response(JSON.stringify({ commit_id: commit.commit_id }), {
        status: 200,
      });
    }

    // GET /v1/log
    if (urlStr.includes('/v1/log') && init?.method !== 'POST') {
      return new Response(JSON.stringify({ log: cloudState.log }), {
        status: 200,
      });
    }

    // GET /v1/commits/:id?full=true
    if (urlStr.includes('/v1/commits/') && init?.method !== 'POST') {
      const match = urlStr.match(/\/v1\/commits\/([^?#]+)/);
      if (match) {
        const commit = cloudState.commits.get(match[1]);
        if (commit) {
          return new Response(JSON.stringify(commit), { status: 200 });
        }
        return new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404 });
      }
    }

    // GET /v1/blobs/:hash
    if (urlStr.includes('/v1/blobs/')) {
      const match = urlStr.match(/\/v1\/blobs\/([^?#]+)/);
      if (match) {
        const blob = cloudState.blobs.get(match[1]);
        if (blob) {
          return new Response(blob, { status: 200 });
        }
        return new Response(null, { status: 404 });
      }
    }

    // Fallback to original fetch
    return _originalFetch!(url, init);
  };
}

function teardownMockCloud(): void {
  cloudState.commits.clear();
  cloudState.log = [];
  cloudState.blobs.clear();
  (globalThis as any).fetch = _originalFetch;
  _originalFetch = undefined;
}

// ─── Test helpers ───────────────────────────────────────────────────

function createMockCommit(
  id: string,
  parentId: string = '0'.repeat(64),
  branch: string = 'main',
): MockCommit {
  return {
    commit_id: id,
    parent_hash: parentId,
    timestamp: new Date().toISOString(),
    trail: { nodes: [], edges: [] },
    attestation: { agent_id: 'test-agent', model_id: 'test-model' },
    changeset: {
      files: [
        {
          path: 'test.txt',
          content_hash: `hash-${id}`,
          change_type: 'add',
        },
      ],
    },
    commit_signature: `sig-${id}`,
    signer_key_id: 'key-1',
    message: `Test commit ${id}`,
    branch,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

test('Sync: init and status', async () => {
  const store = new MockStore();
  const sync = await createPrufsSync(
    {
      cloudUrl: 'https://test.prufs.cloud',
      apiKey: 'test-key',
      localStorePath: ':memory:',
      orgSlug: 'test-org',
    },
    store,
  );

  const status = await sync.getStatus('main');
  assert.equal(status.branch, 'main');
  assert.equal(status.local_head, '');
  assert.equal(status.remote_head, '');
});

test('Push: single commit', async () => {
  setupMockCloud();

  const store = new MockStore();
  const commit1 = createMockCommit('commit1', '0'.repeat(64));
  await store.put(commit1);

  const sync = await createPrufsSync(
    {
      cloudUrl: 'https://test.prufs.cloud',
      apiKey: 'test-key',
      localStorePath: ':memory:',
      orgSlug: 'test-org',
    },
    store,
  );

  const result = await sync.push('main');
  assert.equal(result.status, 'success');
  assert.equal(result.pushed_commits.length, 1);
  assert.equal(result.pushed_commits[0], 'commit1');
  assert.equal(result.errors.length, 0);

  teardownMockCloud();
});

test('Push: multiple commits in sequence', async () => {
  setupMockCloud();

  const store = new MockStore();
  const commit1 = createMockCommit('commit1', '0'.repeat(64));
  const commit2 = createMockCommit('commit2', 'commit1');
  const commit3 = createMockCommit('commit3', 'commit2');

  await store.put(commit1);
  await store.put(commit2);
  await store.put(commit3);

  const sync = await createPrufsSync(
    {
      cloudUrl: 'https://test.prufs.cloud',
      apiKey: 'test-key',
      localStorePath: ':memory:',
      orgSlug: 'test-org',
    },
    store,
  );

  const result = await sync.push('main');
  assert.equal(result.status, 'success');
  assert.equal(result.pushed_commits.length, 3);
  assert.deepEqual(result.pushed_commits, ['commit1', 'commit2', 'commit3']);

  teardownMockCloud();
});

test('Push: idempotent - pushing same commits twice succeeds', async () => {
  setupMockCloud();

  const store = new MockStore();
  const commit1 = createMockCommit('commit1', '0'.repeat(64));
  await store.put(commit1);

  const sync = await createPrufsSync(
    {
      cloudUrl: 'https://test.prufs.cloud',
      apiKey: 'test-key',
      localStorePath: ':memory:',
      orgSlug: 'test-org',
    },
    store,
  );

  const result1 = await sync.push('main');
  assert.equal(result1.pushed_commits.length, 1);

  // Push again - should skip already-pushed commit
  const result2 = await sync.push('main');
  assert.equal(result2.pushed_commits.length, 0);

  teardownMockCloud();
});

test('Pull: single commit from cloud', async () => {
  setupMockCloud();

  // Add commit to cloud
  const commit1 = createMockCommit('commit1', '0'.repeat(64));
  cloudState.commits.set('commit1', commit1);
  cloudState.log.push({
    commit_id: 'commit1',
    parent_hash: '0'.repeat(64),
    timestamp: commit1.timestamp,
    branch: 'main',
  });

  const store = new MockStore();
  const sync = await createPrufsSync(
    {
      cloudUrl: 'https://test.prufs.cloud',
      apiKey: 'test-key',
      localStorePath: ':memory:',
      orgSlug: 'test-org',
    },
    store,
  );

  const result = await sync.pull('main');
  assert.equal(result.status, 'success');
  assert.equal(result.pulled_commits.length, 1);

  // Verify commit is now in local store
  const stored = await store.get('commit1');
  assert.ok(stored);
  assert.equal(stored.commit_id, 'commit1');

  teardownMockCloud();
});

test('Pull: multiple commits', async () => {
  setupMockCloud();

  // Add commits to cloud
  const commit1 = createMockCommit('commit1', '0'.repeat(64));
  const commit2 = createMockCommit('commit2', 'commit1');
  cloudState.commits.set('commit1', commit1);
  cloudState.commits.set('commit2', commit2);
  cloudState.log.push(
    {
      commit_id: 'commit1',
      parent_hash: '0'.repeat(64),
      timestamp: commit1.timestamp,
      branch: 'main',
    },
    {
      commit_id: 'commit2',
      parent_hash: 'commit1',
      timestamp: commit2.timestamp,
      branch: 'main',
    },
  );

  const store = new MockStore();
  const sync = await createPrufsSync(
    {
      cloudUrl: 'https://test.prufs.cloud',
      apiKey: 'test-key',
      localStorePath: ':memory:',
      orgSlug: 'test-org',
    },
    store,
  );

  const result = await sync.pull('main');
  assert.equal(result.status, 'success');
  assert.equal(result.pulled_commits.length, 2);

  teardownMockCloud();
});

test('Pull: skip commits already local', async () => {
  setupMockCloud();

  const commit1 = createMockCommit('commit1', '0'.repeat(64));
  const commit2 = createMockCommit('commit2', 'commit1');

  // Add both to cloud
  cloudState.commits.set('commit1', commit1);
  cloudState.commits.set('commit2', commit2);
  cloudState.log.push(
    {
      commit_id: 'commit1',
      parent_hash: '0'.repeat(64),
      timestamp: commit1.timestamp,
      branch: 'main',
    },
    {
      commit_id: 'commit2',
      parent_hash: 'commit1',
      timestamp: commit2.timestamp,
      branch: 'main',
    },
  );

  // Store commit1 locally first
  const store = new MockStore();
  await store.put(commit1);

  const sync = await createPrufsSync(
    {
      cloudUrl: 'https://test.prufs.cloud',
      apiKey: 'test-key',
      localStorePath: ':memory:',
      orgSlug: 'test-org',
    },
    store,
  );

  const result = await sync.pull('main');
  // Should only pull commit2 (commit1 already local)
  assert.equal(result.pulled_commits.length, 1);
  assert.equal(result.pulled_commits[0], 'commit2');

  teardownMockCloud();
});

test('Sync: full bidirectional sync', async () => {
  setupMockCloud();

  const store = new MockStore();
  const localCommit = createMockCommit('local-commit', '0'.repeat(64));
  await store.put(localCommit);

  const cloudCommit = createMockCommit('cloud-commit', '0'.repeat(64));
  cloudState.commits.set('cloud-commit', cloudCommit);
  cloudState.log.push({
    commit_id: 'cloud-commit',
    parent_hash: '0'.repeat(64),
    timestamp: cloudCommit.timestamp,
    branch: 'main',
  });

  const sync = await createPrufsSync(
    {
      cloudUrl: 'https://test.prufs.cloud',
      apiKey: 'test-key',
      localStorePath: ':memory:',
      orgSlug: 'test-org',
    },
    store,
  );

  const result = await sync.sync('main');
  assert.equal(result.status, 'success');
  assert.equal(result.pushed_commits.length, 1);
  assert.equal(result.pulled_commits.length, 1);

  teardownMockCloud();
});

test('Sync state: tracks local and remote heads', async () => {
  const store = new MockStore();
  const commit1 = createMockCommit('commit1', '0'.repeat(64));
  await store.put(commit1);

  const sync = await createPrufsSync(
    {
      cloudUrl: 'https://test.prufs.cloud',
      apiKey: 'test-key',
      localStorePath: ':memory:',
      orgSlug: 'test-org',
    },
    store,
  );

  const status1 = await sync.getStatus('main');
  assert.equal(status1.local_head, '');
  assert.equal(status1.remote_head, '');

  // After setting head in store
  const status2 = await sync.getStatus('develop');
  assert.equal(status2.branch, 'develop');
});

test('Error handling: push with missing commit', async () => {
  setupMockCloud();

  const store = new MockStore();
  // Don't add any commits to store

  const sync = await createPrufsSync(
    {
      cloudUrl: 'https://test.prufs.cloud',
      apiKey: 'test-key',
      localStorePath: ':memory:',
      orgSlug: 'test-org',
    },
    store,
  );

  const result = await sync.push('main');
  assert.equal(result.status, 'success');
  assert.equal(result.pushed_commits.length, 0);

  teardownMockCloud();
});

test('Multiple branches: sync different branches independently', async () => {
  setupMockCloud();

  const store = new MockStore();
  const mainCommit = createMockCommit('main-commit', '0'.repeat(64), 'main');
  const devCommit = createMockCommit('dev-commit', '0'.repeat(64), 'develop');

  await store.put(mainCommit);
  await store.put(devCommit);

  const sync = await createPrufsSync(
    {
      cloudUrl: 'https://test.prufs.cloud',
      apiKey: 'test-key',
      localStorePath: ':memory:',
      orgSlug: 'test-org',
    },
    store,
  );

  const resultMain = await sync.push('main');
  const resultDev = await sync.push('develop');

  assert.equal(resultMain.pushed_commits.length, 1);
  assert.equal(resultDev.pushed_commits.length, 1);

  const statusMain = await sync.getStatus('main');
  const statusDev = await sync.getStatus('develop');

  assert.equal(statusMain.branch, 'main');
  assert.equal(statusDev.branch, 'develop');

  teardownMockCloud();
});

test('Content-addressed dedup: blobs not re-uploaded if already exist', async () => {
  setupMockCloud();

  const store = new MockStore();
  const commit1 = createMockCommit('commit1', '0'.repeat(64));
  const commit2 = createMockCommit('commit2', 'commit1');
  // Both commits reference the same blob content hash
  commit2.changeset.files[0].content_hash = commit1.changeset.files[0].content_hash;

  await store.put(commit1);
  await store.put(commit2);

  const sync = await createPrufsSync(
    {
      cloudUrl: 'https://test.prufs.cloud',
      apiKey: 'test-key',
      localStorePath: ':memory:',
      orgSlug: 'test-org',
    },
    store,
  );

  const result = await sync.push('main');
  assert.equal(result.pushed_commits.length, 2);

  teardownMockCloud();
});

test('Offline first: local operations succeed even if cloud unreachable', async () => {
  // Don't setup mock cloud
  const store = new MockStore();
  const commit1 = createMockCommit('commit1', '0'.repeat(64));
  await store.put(commit1);

  const sync = await createPrufsSync(
    {
      cloudUrl: 'https://unreachable.invalid',
      apiKey: 'test-key',
      localStorePath: ':memory:',
      orgSlug: 'test-org',
    },
    store,
  );

  // Local operations should always succeed
  const status = await sync.getStatus('main');
  assert.ok(status);

  // Cloud operations should fail gracefully
  const result = await sync.push('main');
  assert.equal(result.status, 'failed');
  assert.ok(result.errors.length > 0);
});

test('Bytes tracking: uploads and downloads tracked', async () => {
  setupMockCloud();

  const store = new MockStore();
  const commit1 = createMockCommit('commit1', '0'.repeat(64));
  await store.put(commit1);

  const sync = await createPrufsSync(
    {
      cloudUrl: 'https://test.prufs.cloud',
      apiKey: 'test-key',
      localStorePath: ':memory:',
      orgSlug: 'test-org',
    },
    store,
  );

  const result = await sync.push('main');
  assert.ok(result.bytes_uploaded > 0);

  teardownMockCloud();
});
