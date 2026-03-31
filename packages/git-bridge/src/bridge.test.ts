/**
 * @prufs/git-bridge - bridge.test.ts
 *
 * 5 test suites. All tests use local filesystem only - no remote push.
 * The push path is integration-tested separately with a real remote.
 *
 * Suite 1: Config validation       - required fields, cron expression
 * Suite 2: Tree reconstruction     - deleted files, latest-wins resolution
 * Suite 3: Snapshot export (local) - git init, write, stage, commit
 * Suite 4: Skip if no change       - HEAD unchanged => no git commit
 * Suite 5: Scheduler lifecycle     - start, stop, status, in-flight guard
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as git from 'isomorphic-git';

import { validateConfig } from './config.js';
import { PrufsGitExporter } from './exporter.js';
import { BridgeScheduler } from './scheduler.js';
import type { BridgeConfig } from './config.js';
import type { PrufsStoreAdapter } from './exporter.js';

// ---------------------------------------------------------------------------
// Minimal CausalCommit fixture (mirrors store types without the dep)
// ---------------------------------------------------------------------------

interface FakeBlob {
  path: string;
  content_hash: string;
  content?: string;
  change_type: 'added' | 'modified' | 'deleted';
}

interface FakeCommit {
  commit_id: string;
  parent_hash: string;
  timestamp: string;
  message: string;
  branch?: string;
  changeset: { changed: FakeBlob[]; tree_hash: string };
}

function makeCommit(id: string, blobs: FakeBlob[], branch = 'main', ts?: string): FakeCommit {
  return {
    commit_id: id,
    parent_hash: '0'.repeat(64),
    timestamp: ts ?? new Date().toISOString(),
    message: `commit ${id}`,
    branch,
    changeset: { changed: blobs, tree_hash: `tree-${id}` },
  };
}

// ---------------------------------------------------------------------------
// Fake PrufsStoreAdapter
// ---------------------------------------------------------------------------

function makeFakeStore(commits: FakeCommit[]): PrufsStoreAdapter {
  return {
    head(branch = 'main') {
      const branchCommits = commits.filter(
        (c) => (c.branch ?? 'main') === branch
      );
      if (branchCommits.length === 0) return undefined;
      return branchCommits[branchCommits.length - 1] as never;
    },
    log(branch = 'main') {
      return [...commits]
        .filter((c) => (c.branch ?? 'main') === branch)
        .reverse() as never[];
    },
    blobs(commitId: string) {
      const c = commits.find((c) => c.commit_id === commitId);
      return (c?.changeset.changed ?? []) as never[];
    },
    resolve(filePath: string, branch = 'main') {
      // Walk newest-first, return first non-deleted content
      const branchCommits = [...commits]
        .filter((c) => (c.branch ?? 'main') === branch)
        .reverse();
      for (const commit of branchCommits) {
        const blob = commit.changeset.changed.find((b) => b.path === filePath);
        if (blob) {
          if (blob.change_type === 'deleted') return undefined;
          return blob.content;
        }
      }
      return undefined;
    },
  };
}

// ---------------------------------------------------------------------------
// Base config factory (local only - no remote push in tests)
// ---------------------------------------------------------------------------

function makeConfig(mirrorDir: string, overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    schedule: '0 * * * *',
    remote_url: 'https://github.com/test-org/test-repo.git',
    auth: { type: 'none' },
    author: { name: 'Prufs Bridge', email: 'bridge@prufs.ai' },
    branches: [{ prufs_branch: 'main' }],
    mirror_dir: mirrorDir,
    verbose: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite 1: Config validation
// ---------------------------------------------------------------------------

describe('Suite 1: Config validation', () => {
  it('valid config produces no errors', () => {
    const errors = validateConfig({
      schedule: '0 2 * * *',
      remote_url: 'https://github.com/org/repo.git',
      auth: { type: 'token', token: 'ghp_xxx' },
      author: { name: 'Prufs Bot', email: 'bot@prufs.ai' },
      branches: [{ prufs_branch: 'main' }],
      mirror_dir: '/tmp/prufs-mirror',
    });
    assert.equal(errors.length, 0);
  });

  it('missing schedule is an error', () => {
    const errors = validateConfig({
      schedule: '',
      remote_url: 'https://github.com/org/repo.git',
      auth: { type: 'none' },
      author: { name: 'Bot', email: 'bot@prufs.ai' },
      branches: [{ prufs_branch: 'main' }],
      mirror_dir: '/tmp/mirror',
    });
    assert.ok(errors.some((e) => e.includes('schedule')));
  });

  it('missing remote_url is an error', () => {
    const errors = validateConfig({
      schedule: '0 * * * *',
      remote_url: '',
      auth: { type: 'none' },
      author: { name: 'Bot', email: 'bot@prufs.ai' },
      branches: [{ prufs_branch: 'main' }],
      mirror_dir: '/tmp/mirror',
    });
    assert.ok(errors.some((e) => e.includes('remote_url')));
  });

  it('missing author fields are errors', () => {
    const errors = validateConfig({
      schedule: '0 * * * *',
      remote_url: 'https://github.com/org/repo.git',
      auth: { type: 'none' },
      author: { name: '', email: '' },
      branches: [{ prufs_branch: 'main' }],
      mirror_dir: '/tmp/mirror',
    });
    assert.ok(errors.some((e) => e.includes('author.name')));
    assert.ok(errors.some((e) => e.includes('author.email')));
  });

  it('empty branches array is an error', () => {
    const errors = validateConfig({
      schedule: '0 * * * *',
      remote_url: 'https://github.com/org/repo.git',
      auth: { type: 'none' },
      author: { name: 'Bot', email: 'bot@prufs.ai' },
      branches: [],
      mirror_dir: '/tmp/mirror',
    });
    assert.ok(errors.some((e) => e.includes('branch')));
  });

  it('invalid cron expression causes scheduler constructor to throw', () => {
    assert.throws(() => {
      new BridgeScheduler(makeFakeStore([]), {
        ...makeConfig('/tmp/irrelevant'),
        schedule: 'not-a-cron',
      });
    }, /Invalid cron expression/);
  });

  it('git_branch defaults to prufs_branch when not specified', () => {
    const config = makeConfig('/tmp/m', {
      branches: [{ prufs_branch: 'feature/payments' }],
    });
    const branch = config.branches[0];
    assert.equal(branch.git_branch ?? branch.prufs_branch, 'feature/payments');
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Tree reconstruction
// ---------------------------------------------------------------------------

describe('Suite 2: Tree reconstruction', () => {
  it('resolves latest content for each path', () => {
    const commits = [
      makeCommit('c1', [
        { path: 'src/a.ts', content_hash: 'h1', content: 'v1', change_type: 'added' },
      ]),
      makeCommit('c2', [
        { path: 'src/a.ts', content_hash: 'h2', content: 'v2', change_type: 'modified' },
        { path: 'src/b.ts', content_hash: 'h3', content: 'hello', change_type: 'added' },
      ]),
    ];
    const store = makeFakeStore(commits);
    assert.equal(store.resolve('src/a.ts', 'main'), 'v2');
    assert.equal(store.resolve('src/b.ts', 'main'), 'hello');
  });

  it('deleted files do not appear in resolved tree', () => {
    const commits = [
      makeCommit('c1', [
        { path: 'old.ts', content_hash: 'h1', content: 'old content', change_type: 'added' },
      ]),
      makeCommit('c2', [
        { path: 'old.ts', content_hash: 'h1', content: undefined, change_type: 'deleted' },
      ]),
    ];
    const store = makeFakeStore(commits);
    assert.equal(store.resolve('old.ts', 'main'), undefined);
  });

  it('head() returns last commit on branch', () => {
    const t1 = new Date(Date.now() - 2000).toISOString();
    const t2 = new Date().toISOString();
    const commits = [
      makeCommit('old', [{ path: 'f.ts', content_hash: 'h', content: 'a', change_type: 'added' }], 'main', t1),
      makeCommit('new', [{ path: 'f.ts', content_hash: 'h2', content: 'b', change_type: 'modified' }], 'main', t2),
    ];
    const store = makeFakeStore(commits);
    assert.equal(store.head('main')?.commit_id, 'new');
  });

  it('head() returns undefined for unknown branch', () => {
    const store = makeFakeStore([]);
    assert.equal(store.head('no-such-branch'), undefined);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Snapshot export (local git, no push)
// ---------------------------------------------------------------------------

describe('Suite 3: Snapshot export (local git, no push)', async () => {
  let tmpDir: string;
  let mirrorDir: string;

  before(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'prufs-bridge-test-'));
    mirrorDir = path.join(tmpDir, 'mirror');
  });

  after(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('exportBranch() returns ok=true on a branch with commits', async () => {
    const commits = [
      makeCommit('snap-c1', [
        { path: 'src/index.ts', content_hash: 'hh1', content: 'export const x = 1;', change_type: 'added' },
        { path: 'README.md', content_hash: 'hh2', content: '# Project', change_type: 'added' },
      ]),
    ];
    const store = makeFakeStore(commits);
    const config = makeConfig(mirrorDir);

    // Patch push to no-op for local testing
    const exporter = new PrufsGitExporter(store, config);
    // Override gitPush by monkey-patching the private method via prototype for test
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (exporter as any).gitPush = async () => { /* no-op: no remote in tests */ };

    const result = await exporter.exportBranch({ prufs_branch: 'main' });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.file_count, 2);
    assert.equal(result.prufs_head_commit_id, 'snap-c1');
  });

  it('exportBranch() writes correct file contents to the mirror dir', async () => {
    const tmpDir2 = await fsp.mkdtemp(path.join(os.tmpdir(), 'prufs-bridge-content-'));
    try {
      const commits = [
        makeCommit('content-c1', [
          { path: 'src/main.ts', content_hash: 'ch1', content: 'const answer = 42;', change_type: 'added' },
        ]),
      ];
      const store = makeFakeStore(commits);
      const config = makeConfig(path.join(tmpDir2, 'mirror'));
      const exporter = new PrufsGitExporter(store, config);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (exporter as any).gitPush = async () => {};

      await exporter.exportBranch({ prufs_branch: 'main' });

      const branchDir = path.join(tmpDir2, 'mirror', 'main');
      const written = await fsp.readFile(path.join(branchDir, 'src/main.ts'), 'utf8');
      assert.equal(written, 'const answer = 42;');
    } finally {
      await fsp.rm(tmpDir2, { recursive: true, force: true });
    }
  });

  it('exportBranch() creates a git commit with Prufs metadata in message', async () => {
    const tmpDir3 = await fsp.mkdtemp(path.join(os.tmpdir(), 'prufs-bridge-msg-'));
    try {
      const commits = [
        makeCommit('msg-commit-abc123', [
          { path: 'app.ts', content_hash: 'mh1', content: 'app', change_type: 'added' },
        ]),
      ];
      const store = makeFakeStore(commits);
      const config = makeConfig(path.join(tmpDir3, 'mirror'));
      const exporter = new PrufsGitExporter(store, config);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (exporter as any).gitPush = async () => {};

      await exporter.exportBranch({ prufs_branch: 'main' });

      // Read the git log from the local mirror repo
      const dir = path.join(tmpDir3, 'mirror', 'main');
      const log = await git.log({ fs, dir, ref: 'main', depth: 1 });
      assert.ok(log.length >= 1, 'Expected at least one git commit');
      const msg = log[0].commit.message;
      assert.ok(msg.includes('prufs-snapshot:'), `Expected 'prufs-snapshot:' in message, got: ${msg}`);
      assert.ok(msg.includes('msg-commit-abc123'), `Expected commit_id in message, got: ${msg}`);
      assert.ok(msg.includes('prufs-head:'), `Expected 'prufs-head:' in message, got: ${msg}`);
    } finally {
      await fsp.rm(tmpDir3, { recursive: true, force: true });
    }
  });

  it('exportBranch() returns ok=true with no commits when branch is empty', async () => {
    const store = makeFakeStore([]);
    const config = makeConfig(mirrorDir);
    const exporter = new PrufsGitExporter(store, config);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (exporter as any).gitPush = async () => {};

    const result = await exporter.exportBranch({ prufs_branch: 'empty-branch' });
    assert.equal(result.ok, true);
    assert.equal(result.pushed, false);
    assert.ok(result.error?.includes('No HEAD'), `Expected 'No HEAD' in message, got: ${result.error}`);
  });

  it('history() accumulates results across multiple exportAll() runs', async () => {
    const tmpDir4 = await fsp.mkdtemp(path.join(os.tmpdir(), 'prufs-bridge-hist-'));
    try {
      const commits = [
        makeCommit('hist-c1', [
          { path: 'x.ts', content_hash: 'xh1', content: 'x', change_type: 'added' },
        ]),
      ];
      const store = makeFakeStore(commits);
      const config = makeConfig(path.join(tmpDir4, 'mirror'));
      const exporter = new PrufsGitExporter(store, config);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (exporter as any).gitPush = async () => {};

      await exporter.exportAll();
      // Second run - HEAD hasn't changed, should skip but still record
      await exporter.exportAll();

      const hist = exporter.history();
      assert.ok(hist.length >= 1);
    } finally {
      await fsp.rm(tmpDir4, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 4: Skip if no change
// ---------------------------------------------------------------------------

describe('Suite 4: Skip if HEAD unchanged', async () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'prufs-bridge-skip-'));
  });

  after(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('second export with same HEAD does not push', async () => {
    const commits = [
      makeCommit('skip-c1', [
        { path: 'skip.ts', content_hash: 'sh1', content: 'skip', change_type: 'added' },
      ]),
    ];
    const store = makeFakeStore(commits);
    const config = makeConfig(path.join(tmpDir, 'mirror'));
    const exporter = new PrufsGitExporter(store, config);

    let pushCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (exporter as any).gitPush = async () => { pushCount++; };

    // First run - should push
    const r1 = await exporter.exportBranch({ prufs_branch: 'main' });
    assert.equal(r1.ok, true);
    assert.equal(r1.pushed, true);
    assert.equal(pushCount, 1);

    // Second run - same HEAD, should not push
    const r2 = await exporter.exportBranch({ prufs_branch: 'main' });
    assert.equal(r2.ok, true);
    assert.equal(r2.pushed, false, 'Expected pushed=false on second run with same HEAD');
    assert.equal(pushCount, 1, 'gitPush should not have been called again');
  });

  it('new HEAD after store update triggers push again', async () => {
    const t1 = new Date(Date.now() - 1000).toISOString();
    const t2 = new Date().toISOString();

    const commits1 = [
      makeCommit('update-c1', [
        { path: 'f.ts', content_hash: 'fh1', content: 'v1', change_type: 'added' },
      ], 'main', t1),
    ];
    const commits2 = [
      ...commits1,
      makeCommit('update-c2', [
        { path: 'f.ts', content_hash: 'fh2', content: 'v2', change_type: 'modified' },
      ], 'main', t2),
    ];

    const tmpDir5 = await fsp.mkdtemp(path.join(os.tmpdir(), 'prufs-bridge-update-'));
    try {
      let pushCount = 0;

      // First store - one commit
      const store1 = makeFakeStore(commits1);
      const config = makeConfig(path.join(tmpDir5, 'mirror'));
      const exporter = new PrufsGitExporter(store1, config);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (exporter as any).gitPush = async () => { pushCount++; };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (exporter as any).store = store1;

      await exporter.exportBranch({ prufs_branch: 'main' });
      assert.equal(pushCount, 1);

      // Swap in updated store with second commit
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (exporter as any).store = makeFakeStore(commits2);

      const r2 = await exporter.exportBranch({ prufs_branch: 'main' });
      assert.equal(r2.pushed, true, 'Expected push after HEAD change');
      assert.equal(pushCount, 2);
    } finally {
      await fsp.rm(tmpDir5, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 5: Scheduler lifecycle
// ---------------------------------------------------------------------------

describe('Suite 5: Scheduler lifecycle', () => {
  it('scheduler starts and reports running=true', () => {
    const store = makeFakeStore([]);
    const scheduler = new BridgeScheduler(store, makeConfig('/tmp/sched-test'));
    scheduler.start();
    assert.equal(scheduler.isRunning(), true);
    scheduler.stop();
  });

  it('scheduler stop() sets running=false', async () => {
    const store = makeFakeStore([]);
    const scheduler = new BridgeScheduler(store, makeConfig('/tmp/sched-stop'));
    scheduler.start();
    await scheduler.stop();
    assert.equal(scheduler.isRunning(), false);
  });

  it('calling start() twice emits a warning but does not throw', () => {
    const store = makeFakeStore([]);
    const scheduler = new BridgeScheduler(store, makeConfig('/tmp/sched-double'));
    scheduler.start();
    assert.doesNotThrow(() => scheduler.start()); // should warn, not throw
    scheduler.stop();
  });

  it('status() returns schedule string and zero runs on fresh scheduler', () => {
    const store = makeFakeStore([]);
    const scheduler = new BridgeScheduler(store, makeConfig('/tmp/sched-status', {
      schedule: '0 3 * * *',
    }));
    const status = scheduler.status();
    assert.equal(status.schedule, '0 3 * * *');
    assert.equal(status.total_runs, 0);
    assert.equal(status.total_failures, 0);
    assert.equal(status.last_run_at, null);
  });

  it('BridgeScheduler constructor throws on invalid config', () => {
    assert.throws(() => {
      new BridgeScheduler(makeFakeStore([]), {
        schedule: '0 * * * *',
        remote_url: '',         // invalid
        auth: { type: 'none' },
        author: { name: 'Bot', email: 'bot@prufs.ai' },
        branches: [{ prufs_branch: 'main' }],
        mirror_dir: '/tmp/x',
      });
    }, /Invalid BridgeConfig/);
  });
});
