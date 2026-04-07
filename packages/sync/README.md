# @prufs/sync

Bidirectional sync engine between `@prufs/store` (local SQLite) and `@prufs/cloud` (api.prufs.ai + R2).

Part of the Prufs platform: a complete replacement for Git and GitHub, purpose-built for agentic coding. See https://prufs.ai for the full story.

## Install

```
npm install @prufs/sync
```

## Quick start

```typescript
import { SyncEngine, HttpCloudClient } from "@prufs/sync";
import { PrufsStore } from "@prufs/store";

const store = new PrufsStore({ path: ".prufs/store.db" });

const cloud = new HttpCloudClient({
  apiKey: process.env.PRUFS_API_KEY!,
  orgSlug: "cognitionhive",
});

const engine = new SyncEngine(store, cloud);

engine.on("sync:complete", (e) => {
  console.log(`synced ${e.count} commits`);
});

const summary = await engine.sync();
console.log(summary);
// { pulled: 3, pushed: 7, duplicates: 0, rejected: 0, errors: 0, branches: ["main"], duration_ms: 428 }
```

## What the sync engine does

1. **Pull** fetches commits from the cloud that are not present locally and writes them to the local store.
2. **Push** sends commits from the local store to the cloud that are not yet present there.
3. **Sync** runs pull then push, reaching eventual consistency with a single call.
4. **Status** reports what a sync would do, without making any changes.

## Design properties

- **Content-addressed.** Commits are identified by SHA-256 hash of their canonical JSON. Equality implies identity, so the sync engine can compare logs by ID alone.
- **Idempotent.** Pushing the same commit twice is a no-op on the server. The engine treats duplicate responses as success.
- **CRDT-friendly.** Merge conflict resolution is delegated to `@prufs/store`'s three-tier merge: disjoint auto-merge, last-write-wins for overlapping non-restricted changes, and human gate for restricted-sensitivity overlaps.
- **Retry with jitter.** Transient failures are retried with exponential backoff and full jitter, preventing thundering herd when multiple clients sync simultaneously.
- **Event-driven progress.** The engine extends `SyncEmitter` and emits typed events (`sync:start`, `pull:commit`, `push:commit`, `merge:conflict`, `sync:complete`) for progress reporting in CLIs and dashboards.

## API

### `new SyncEngine(store, cloud, options?)`

Construct a sync engine bound to a local store and a cloud client.

Options:
- `batchSize?: number` - maximum commits per push batch (default 25)
- `maxRetries?: number` - maximum retry attempts on transient failure (default 3)
- `retryBaseMs?: number` - base delay in ms for exponential backoff (default 200)
- `logger?: (message: string) => void` - optional verbose logger

### `engine.sync(branch?)` -> `Promise<SyncSummary>`

Run pull then push across all branches (or a single branch if specified).

### `engine.pull(branch?)` -> `Promise<number>`

Pull cloud commits not present locally. Returns the number of commits pulled.

### `engine.push(branch?)` -> `Promise<[pushed, duplicates, rejected]>`

Push local commits not present in the cloud. Returns a tuple of counts.

### `engine.status()` -> `Promise<SyncStatus>`

Dry-run: report what a sync would do. Classifies each branch as in_sync, local_ahead, cloud_ahead, or diverged.

### `engine.on(event, listener)`

Subscribe to progress events. Use `"*"` to subscribe to all events.

## Events

| Event | When emitted |
|---|---|
| `sync:start` | At the beginning of a sync() call |
| `sync:complete` | At the end of a successful sync() call |
| `sync:error` | When a commit is rejected or an unrecoverable error occurs |
| `pull:start` | At the beginning of a pull operation |
| `pull:commit` | After each commit is pulled and stored locally |
| `pull:complete` | At the end of a pull operation |
| `push:start` | At the beginning of a push operation |
| `push:commit` | After each commit is pushed (accepted or duplicate) |
| `push:complete` | At the end of a push operation |
| `merge:conflict` | When a restricted-sensitivity merge requires human review |
| `merge:resolved` | When an auto-merge completes successfully |

## Test coverage

61 tests across 16 suites:

- **Backoff (8 tests):** exponential envelope, jitter, delay cap, retry success and exhaustion, non-retryable errors, sleep duration
- **Diff (9 tests):** empty logs, all-local, all-cloud, shared commits, divergent histories, order preservation, branch grouping
- **Emitter (7 tests):** registration, specific listeners, wildcard listeners, off, chaining, empty emit tolerance
- **Engine pull (4 tests):** empty, full cloud, partial overlap, events
- **Engine push (6 tests):** empty, full local, duplicates, rejections, retry on transient failure, batching
- **Engine sync (3 tests):** pull-then-push, eventual consistency, events
- **Engine status (4 tests):** in_sync, local_ahead, cloud_ahead, diverged
- **isCausalCommit type guard (3 tests):** well-formed, non-objects, missing fields
- **HttpCloudClient constructor (4 tests):** missing fields, default URL, trailing slash stripping
- **HttpCloudClient pushCommit (5 tests):** accepted, duplicate, rejected, 5xx throw, auth header
- **HttpCloudClient fetchLog (3 tests):** success, branch query param, error propagation
- **HttpCloudClient fetchCommit (3 tests):** success, 404 null return, full=true param
- **HttpCloudClient fetchBranches (2 tests):** success, empty fallback

All tests use the Node.js built-in test runner, consistent with every other package in the Prufs monorepo. No Jest, no Vitest, no external test framework dependencies.

## Build

```
npm run build
```

Produces `dist/` with compiled JavaScript, declaration files, and source maps.

## Test

```
npm test
```

## License

MIT
