/**
 * @prufs/cloud - R2 storage tests
 *
 * Unit tests for the R2 blob storage module. Uses a minimal
 * in-memory mock to avoid requiring real R2 credentials.
 *
 * Tests cover:
 *   1. Configuration loading and validation
 *   2. Commit JSON storage and retrieval
 *   3. Blob storage with content-addressed dedup
 *   4. storeCommitBlobs batch operation
 *   5. Commit envelope stripping (blob content removed)
 *   6. Head/exists checks
 *   7. Delete operations
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import type { R2Config } from './r2.js';
import {
  getR2Config,
  isR2Configured,
  putObject,
  getObject,
  headObject,
  deleteObject,
  storeCommitJson,
  storeBlob,
  getCommitJson,
  getBlob,
  storeCommitBlobs,
} from './r2.js';

// ─── In-memory mock S3/R2 server ────────────────────────────────────

function createMockR2Server(): {
  server: ReturnType<typeof createServer>;
  store: Map<string, { body: Buffer; contentType: string }>;
  port: number;
  start: () => Promise<number>;
  stop: () => Promise<void>;
} {
  const store = new Map<string, { body: Buffer; contentType: string }>();
  let port = 0;

  const server = createServer((req, res) => {
    const parts = (req.url ?? '/').split('/');
    parts.shift();
    parts.shift();
    const key = parts.join('/');

    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        store.set(key, {
          body,
          contentType: req.headers['content-type'] ?? 'application/octet-stream',
        });
        res.writeHead(200);
        res.end();
      });
    } else if (req.method === 'GET') {
      const obj = store.get(key);
      if (!obj) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      res.writeHead(200, {
        'content-type': obj.contentType,
        'content-length': String(obj.body.length),
      });
      res.end(obj.body);
    } else if (req.method === 'HEAD') {
      const obj = store.get(key);
      if (!obj) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        'content-type': obj.contentType,
        'content-length': String(obj.body.length),
      });
      res.end();
    } else if (req.method === 'DELETE') {
      store.delete(key);
      res.writeHead(204);
      res.end();
    } else {
      res.writeHead(405);
      res.end();
    }
  });

  return {
    server,
    store,
    get port() {
      return port;
    },
    start: () =>
      new Promise<number>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          port = typeof addr === 'object' && addr ? addr.port : 0;
          resolve(port);
        });
      }),
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function testConfig(port: number): R2Config {
  return {
    accountId: 'test-account',
    accessKeyId: 'test-key-id',
    secretAccessKey: 'test-secret-key',
    bucketName: 'prufs-test',
    endpoint: `http://127.0.0.1:${port}`,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('R2 configuration', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('isR2Configured returns false when env vars missing', () => {
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    assert.equal(isR2Configured(), false);
  });

  it('isR2Configured returns true when all env vars set', () => {
    process.env.R2_ACCOUNT_ID = 'acct';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    assert.equal(isR2Configured(), true);
  });

  it('getR2Config throws when env vars missing', () => {
    delete process.env.R2_ACCOUNT_ID;
    assert.throws(() => getR2Config(), /R2 not configured/);
  });

  it('getR2Config returns config with defaults', () => {
    process.env.R2_ACCOUNT_ID = 'acct';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    const cfg = getR2Config();
    assert.equal(cfg.accountId, 'acct');
    assert.equal(cfg.bucketName, 'prufs-storage');
  });
});

describe('R2 low-level operations', () => {
  const mock = createMockR2Server();
  let config: R2Config;

  beforeEach(async () => {
    const port = await mock.start();
    config = testConfig(port);
    mock.store.clear();
  });

  afterEach(async () => {
    await mock.stop();
  });

  it('putObject stores and getObject retrieves', async () => {
    const result = await putObject(config, 'test/hello.txt', 'Hello Prufs', 'text/plain');
    assert.equal(result.ok, true);

    const get = await getObject(config, 'test/hello.txt');
    assert.equal(get.ok, true);
    assert.equal(get.body?.toString('utf-8'), 'Hello Prufs');
    assert.equal(get.contentType, 'text/plain');
  });

  it('getObject returns 404 for missing key', async () => {
    const get = await getObject(config, 'nonexistent');
    assert.equal(get.ok, false);
    assert.equal(get.status, 404);
    assert.equal(get.body, null);
  });

  it('headObject checks existence', async () => {
    const before = await headObject(config, 'test/head.txt');
    assert.equal(before.exists, false);

    await putObject(config, 'test/head.txt', 'data', 'text/plain');

    const after = await headObject(config, 'test/head.txt');
    assert.equal(after.exists, true);
    assert.equal(after.size, 4);
  });

  it('deleteObject removes object', async () => {
    await putObject(config, 'test/del.txt', 'to delete', 'text/plain');
    const del = await deleteObject(config, 'test/del.txt');
    assert.equal(del.ok, true);

    const check = await headObject(config, 'test/del.txt');
    assert.equal(check.exists, false);
  });
});

describe('R2 commit storage', () => {
  const mock = createMockR2Server();
  let config: R2Config;
  const orgId = 'org-abc-123';
  const commitId = 'deadbeef'.repeat(8);

  beforeEach(async () => {
    const port = await mock.start();
    config = testConfig(port);
    mock.store.clear();
  });

  afterEach(async () => {
    await mock.stop();
  });

  it('storeCommitJson strips blob content from envelope', async () => {
    const commit = {
      commit_id: commitId,
      parent_hash: '0'.repeat(64),
      timestamp: new Date().toISOString(),
      message: 'test commit',
      changeset: {
        tree_hash: 'abc123',
        files: [
          {
            path: 'src/index.ts',
            change_type: 'add',
            content_hash: 'hash1',
            content: Buffer.from('console.log("hello")').toString('base64'),
            size_bytes: 20,
          },
          {
            path: 'src/util.ts',
            change_type: 'modify',
            content_hash: 'hash2',
            content: Buffer.from('export const x = 1').toString('base64'),
            size_bytes: 18,
          },
        ],
      },
      trail: { nodes: [], edges: [], graph_hash: 'gh1' },
      attestation: {
        agent_id: 'claude',
        model_id: 'claude-4',
        session_id: 'sess1',
        prompt_hash: 'ph1',
        signature: 'sig1',
        signer_key_id: 'key1',
      },
    };

    const result = await storeCommitJson(config, orgId, commitId, commit);
    assert.equal(result.ok, true);
    assert.ok(result.sizeBytes > 0);

    const stored = await getCommitJson(config, orgId, commitId);
    assert.ok(stored);
    const cs = stored.changeset as { files: Array<Record<string, unknown>> };
    for (const file of cs.files) {
      assert.equal(file.content, undefined, 'Blob content should be stripped from envelope');
      assert.ok(file.content_hash, 'content_hash should remain');
      assert.ok(file.path, 'path should remain');
    }
  });

  it('getCommitJson returns null for missing commit', async () => {
    const result = await getCommitJson(config, orgId, 'nonexistent');
    assert.equal(result, null);
  });
});

describe('R2 blob dedup', () => {
  const mock = createMockR2Server();
  let config: R2Config;
  const orgId = 'org-abc-123';

  beforeEach(async () => {
    const port = await mock.start();
    config = testConfig(port);
    mock.store.clear();
  });

  afterEach(async () => {
    await mock.stop();
  });

  it('storeBlob stores new blob', async () => {
    const content = Buffer.from('hello world');
    const result = await storeBlob(config, orgId, 'hash-aaa', content);
    assert.equal(result.ok, true);
    assert.equal(result.stored, true);
    assert.equal(result.sizeBytes, 11);
  });

  it('storeBlob skips existing blob (dedup)', async () => {
    const content = Buffer.from('hello world');
    await storeBlob(config, orgId, 'hash-bbb', content);

    const second = await storeBlob(config, orgId, 'hash-bbb', content);
    assert.equal(second.ok, true);
    assert.equal(second.stored, false, 'Second upload should be skipped (dedup)');
  });

  it('getBlob retrieves stored blob', async () => {
    const content = Buffer.from('file content here');
    await storeBlob(config, orgId, 'hash-ccc', content);

    const retrieved = await getBlob(config, orgId, 'hash-ccc');
    assert.ok(retrieved);
    assert.deepEqual(retrieved, content);
  });

  it('getBlob returns null for missing blob', async () => {
    const result = await getBlob(config, orgId, 'hash-missing');
    assert.equal(result, null);
  });
});

describe('R2 storeCommitBlobs batch', () => {
  const mock = createMockR2Server();
  let config: R2Config;
  const orgId = 'org-abc-123';

  beforeEach(async () => {
    const port = await mock.start();
    config = testConfig(port);
    mock.store.clear();
  });

  afterEach(async () => {
    await mock.stop();
  });

  it('stores all blobs from changeset', async () => {
    const changeset = {
      files: [
        {
          path: 'a.ts',
          change_type: 'add' as const,
          content_hash: 'hash-1',
          content: Buffer.from('file a').toString('base64'),
        },
        {
          path: 'b.ts',
          change_type: 'modify' as const,
          content_hash: 'hash-2',
          content: Buffer.from('file b').toString('base64'),
        },
      ],
    };

    const result = await storeCommitBlobs(config, orgId, changeset);
    assert.equal(result.total, 2);
    assert.equal(result.stored, 2);
    assert.equal(result.skipped, 0);
    assert.ok(result.totalBytes > 0);
  });

  it('skips delete entries', async () => {
    const changeset = {
      files: [
        {
          path: 'a.ts',
          change_type: 'add' as const,
          content_hash: 'hash-1',
          content: Buffer.from('file a').toString('base64'),
        },
        {
          path: 'removed.ts',
          change_type: 'delete' as const,
          content_hash: 'hash-del',
        },
      ],
    };

    const result = await storeCommitBlobs(config, orgId, changeset);
    assert.equal(result.stored, 1);
    assert.equal(result.skipped, 0);
  });

  it('deduplicates blobs with same content_hash', async () => {
    await storeBlob(config, orgId, 'hash-dup', Buffer.from('shared'));

    const changeset = {
      files: [
        {
          path: 'a.ts',
          change_type: 'add' as const,
          content_hash: 'hash-dup',
          content: Buffer.from('shared').toString('base64'),
        },
        {
          path: 'b.ts',
          change_type: 'add' as const,
          content_hash: 'hash-new',
          content: Buffer.from('new content').toString('base64'),
        },
      ],
    };

    const result = await storeCommitBlobs(config, orgId, changeset);
    assert.equal(result.stored, 1, 'Only the new blob should be stored');
    assert.equal(result.skipped, 1, 'Existing blob should be skipped');
  });
});
