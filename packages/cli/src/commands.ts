import { CloudSync } from "@prufs/sdk-cloudsync";
import { writeFile } from "node:fs/promises";
import type { CliConfig } from "./config.js";
import type { LocalStoreLike } from "@prufs/sync";

/**
 * Command dependencies are injected so tests can pass in a fake CloudSync
 * factory and a fake store. Production code wires up CloudSync and FileStore
 * via defaults in bin/prufs.ts.
 */
export interface CommandDeps {
  config: CliConfig;
  store: LocalStoreLike;
  cloudSyncFactory?: (config: CliConfig, store: LocalStoreLike) => CloudSync;
  log?: (message: string) => void;
}

export interface CommandOptions {
  branch?: string;
  format?: "json" | "ndjson";
  outPath?: string;
}

function defaultFactory(
  config: CliConfig,
  store: LocalStoreLike
): CloudSync {
  return new CloudSync({
    apiKey: config.apiKey,
    orgSlug: config.orgSlug,
    baseUrl: config.baseUrl,
    localStore: store,
  });
}

function getCloudSync(deps: CommandDeps): CloudSync {
  const factory = deps.cloudSyncFactory ?? defaultFactory;
  return factory(deps.config, deps.store);
}

function log(deps: CommandDeps, message: string): void {
  (deps.log ?? console.log)(message);
}

export async function cmdPush(
  deps: CommandDeps,
  opts: CommandOptions = {}
): Promise<number> {
  const cloud = getCloudSync(deps);
  const [pushed, duplicates, rejected] = await cloud.push(opts.branch);
  log(
    deps,
    `push complete: ${pushed} pushed, ${duplicates} duplicates, ${rejected} rejected`
  );
  return rejected > 0 ? 1 : 0;
}

export async function cmdPull(
  deps: CommandDeps,
  opts: CommandOptions = {}
): Promise<number> {
  const cloud = getCloudSync(deps);
  const pulled = await cloud.pull(opts.branch);
  log(deps, `pull complete: ${pulled} commits pulled`);
  return 0;
}

export async function cmdSync(
  deps: CommandDeps,
  opts: CommandOptions = {}
): Promise<number> {
  const cloud = getCloudSync(deps);
  const summary = await cloud.sync(opts.branch);
  log(
    deps,
    `sync complete: ${summary.pulled} pulled, ${summary.pushed} pushed, ` +
      `${summary.duplicates} duplicates, ${summary.rejected} rejected ` +
      `(${summary.duration_ms}ms across ${summary.branches.length} branches)`
  );
  return summary.rejected > 0 || summary.errors > 0 ? 1 : 0;
}

export async function cmdStatus(deps: CommandDeps): Promise<number> {
  const cloud = getCloudSync(deps);
  const st = await cloud.status();
  const parts: string[] = [];
  if (st.in_sync.length > 0) {
    parts.push(`in sync: ${st.in_sync.join(", ")}`);
  }
  const ahead = Object.entries(st.local_ahead);
  if (ahead.length > 0) {
    parts.push(
      `local ahead: ${ahead.map(([b, n]) => `${b} (+${n})`).join(", ")}`
    );
  }
  const behind = Object.entries(st.cloud_ahead);
  if (behind.length > 0) {
    parts.push(
      `cloud ahead: ${behind.map(([b, n]) => `${b} (+${n})`).join(", ")}`
    );
  }
  if (st.diverged.length > 0) {
    parts.push(`diverged: ${st.diverged.join(", ")}`);
  }
  if (parts.length === 0) {
    parts.push("no branches tracked yet");
  }
  log(deps, parts.join(" | "));
  return 0;
}

export async function cmdExport(
  deps: CommandDeps,
  opts: CommandOptions = {}
): Promise<number> {
  const format = opts.format ?? "json";
  const branches = await deps.store.branches();
  const allCommits = [];
  for (const b of branches) {
    const refs = await deps.store.log(b);
    for (const r of refs) {
      const c = await deps.store.get(r.commit_id);
      if (c) allCommits.push(c);
    }
  }

  let output: string;
  if (format === "ndjson") {
    output = allCommits.map((c) => JSON.stringify(c)).join("\n") + "\n";
  } else {
    output = JSON.stringify(
      { branches, commits: allCommits, exported_at: new Date().toISOString() },
      null,
      2
    );
  }

  if (opts.outPath) {
    await writeFile(opts.outPath, output);
    log(
      deps,
      `exported ${allCommits.length} commits across ${branches.length} branches to ${opts.outPath}`
    );
  } else {
    log(deps, output);
  }
  return 0;
}

export const USAGE = `prufs - decision trail version control

Usage:
  prufs <command> [options]

Commands:
  push [--branch <name>]       Push local commits to the cloud
  pull [--branch <name>]       Pull cloud commits to local
  sync [--branch <name>]       Full bidirectional sync
  status                       Report sync state without moving commits
  export [--format json|ndjson] [--out <path>]
                               Dump the local causal graph

Global options:
  --api-key <key>    Override PRUFS_API_KEY
  --org <slug>       Override PRUFS_ORG
  --api-url <url>    Override PRUFS_API_URL (default https://api.prufs.ai)
  --store <path>     Override store location (default ~/.prufs/store)
  --help, -h         Show this help
  --version, -v      Show version
`;
