#!/usr/bin/env node
/**
 * Prufs CLI
 *
 * Usage:
 *   prufs status                Show trail event stats for this project
 *   prufs trace <file:line>     Trace a line of code to its directive
 *   prufs replay <jsonl>        Replay a Claude Code transcript into a trail
 *   prufs sync                  Push local events to ingestion service
 *   prufs inspect               Pretty-print the local trail events
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { LocalTransport } from "../transport-local.js";
import { ClaudeCodeHook } from "./claude-code.js";
import type { TrailNode, TrailEdge, TrailEvent } from "../types.js";

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case "status":
      return cmdStatus();
    case "inspect":
      return cmdInspect();
    case "replay":
      return cmdReplay(args[1]);
    case "trace":
      return cmdTrace(args[1]);
    case "sync":
      return cmdSync();
    default:
      printUsage();
  }
}

function printUsage() {
  console.log(`
Prufs CLI - The decision trail for AI-generated code

Usage:
  prufs status              Show trail stats for the current project
  prufs inspect             Pretty-print all trail events
  prufs replay <file.jsonl> Replay a Claude Code transcript into a trail
  prufs trace <file:line>   Trace a code line to its originating directive
  prufs sync                Push local events to the ingestion service

Options:
  --db <path>    Path to local events file (default: .prufs/events.ndjson)
  --endpoint <url>  Ingestion service URL (default: http://localhost:3100)
`);
}

function getDbPath(): string {
  const idx = args.indexOf("--db");
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : ".prufs/events.ndjson";
}

function getEndpoint(): string {
  const idx = args.indexOf("--endpoint");
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : "http://localhost:3100";
}

// -------------------------------------------------------------------------
// Commands
// -------------------------------------------------------------------------

function cmdStatus() {
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) {
    console.log("No trail events found. Start a session to begin recording.");
    return;
  }

  const transport = new LocalTransport(dbPath.replace(".ndjson", ".db"));
  const events = transport.readAll();

  const nodes = events.filter((e) => e.event_type === "node_created");
  const edges = events.filter((e) => e.event_type === "edge_created");
  const sessions = new Set(events.map((e) => e.session_id));

  const typeCounts: Record<string, number> = {};
  for (const e of nodes) {
    const node = e.payload as TrailNode;
    typeCounts[node.type] = (typeCounts[node.type] ?? 0) + 1;
  }

  console.log(`\nPrufs Trail Status`);
  console.log(`======================`);
  console.log(`Events file: ${dbPath}`);
  console.log(`Total events: ${events.length}`);
  console.log(`Sessions: ${sessions.size}`);
  console.log(`Nodes: ${nodes.length}`);
  console.log(`Edges: ${edges.length}`);
  console.log();
  console.log(`Node breakdown:`);
  for (const [type, count] of Object.entries(typeCounts)) {
    console.log(`  ${type}: ${count}`);
  }
  console.log();
}

function cmdInspect() {
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) {
    console.log("No trail events found.");
    return;
  }

  const transport = new LocalTransport(dbPath.replace(".ndjson", ".db"));
  const events = transport.readAll();

  // Group by session
  const bySession = new Map<string, TrailEvent[]>();
  for (const e of events) {
    const list = bySession.get(e.session_id) ?? [];
    list.push(e);
    bySession.set(e.session_id, list);
  }

  for (const [sid, sessionEvents] of bySession) {
    console.log(`\nSession: ${sid.slice(0, 12)}...`);
    console.log("-".repeat(60));

    for (const e of sessionEvents) {
      if (e.event_type === "node_created") {
        const node = e.payload as TrailNode;
        const preview = getNodePreview(node);
        console.log(`  [${node.type.padEnd(16)}] ${preview}`);
      } else if (e.event_type === "edge_created") {
        const edge = e.payload as TrailEdge;
        console.log(`  [edge            ] ${edge.from_node.slice(0, 8)} --${edge.type}--> ${edge.to_node.slice(0, 8)}`);
      } else {
        console.log(`  [${e.event_type.padEnd(16)}]`);
      }
    }
  }
  console.log();
}

async function cmdReplay(jsonlPath?: string) {
  if (!jsonlPath) {
    console.error("Usage: prufs replay <file.jsonl>");
    process.exit(1);
  }

  const fullPath = resolve(jsonlPath);
  if (!existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`);
    process.exit(1);
  }

  console.log(`Replaying transcript: ${fullPath}`);

  const hook = new ClaudeCodeHook({
    project_id: detectProjectId(),
    transport: "local",
    local_db_path: ".prufs/events.db",
  });

  await hook.replayTranscript(fullPath);
  console.log("Trail recorded. Run 'prufs inspect' to view.");
}

function cmdTrace(target?: string) {
  if (!target) {
    console.error("Usage: prufs trace <file:line>");
    console.error("Example: prufs trace src/api/users.ts:45");
    process.exit(1);
  }

  // Phase 3 feature - requires the code-graph linker
  console.log(`Trace target: ${target}`);
  console.log("Note: Full code-to-trail tracing requires the code-graph linker (Phase 3).");
  console.log("For now, use 'prufs inspect' to explore trails manually.");
}

async function cmdSync() {
  const dbPath = getDbPath();
  const endpoint = getEndpoint();

  if (!existsSync(dbPath)) {
    console.log("No local events to sync.");
    return;
  }

  const transport = new LocalTransport(dbPath.replace(".ndjson", ".db"));
  const events = transport.readAll();

  if (events.length === 0) {
    console.log("No events to sync.");
    return;
  }

  console.log(`Syncing ${events.length} events to ${endpoint}...`);

  try {
    const response = await fetch(`${endpoint}/api/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
    });

    if (response.ok) {
      const result = (await response.json()) as { accepted: number };
      console.log(`Synced ${result.accepted} events successfully.`);
    } else {
      console.error(`Sync failed: ${response.status} ${response.statusText}`);
    }
  } catch (err) {
    console.error(`Could not reach ingestion service at ${endpoint}`);
    console.error("Is the service running? Start it with: cd packages/ingestion && npm run start");
  }
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function getNodePreview(node: TrailNode): string {
  switch (node.type) {
    case "directive":
      return `"${truncate((node as unknown as { text: string }).text, 60)}"`;
    case "interpretation":
      return `"${truncate((node as unknown as { text: string }).text, 60)}" (conf: ${(node as unknown as { confidence: number }).confidence})`;
    case "decision":
      return `Chose: "${truncate((node as unknown as { chosen: string }).chosen, 40)}" (conf: ${(node as unknown as { confidence: number }).confidence})`;
    case "constraint":
      return `"${truncate((node as unknown as { text: string }).text, 60)}"`;
    case "implementation": {
      const impl = node as unknown as { file_changes: Array<{ path: string }>; lines_added: number };
      return `${impl.file_changes?.length ?? 0} files, +${impl.lines_added ?? 0} lines`;
    }
    case "verification":
      return `${(node as unknown as { verification_type: string }).verification_type}: ${(node as unknown as { result: string }).result}`;
    default:
      return (node as unknown as {id: string}).id.slice(0, 12);
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 3) + "..." : text;
}

function detectProjectId(): string {
  // Try to detect from package.json
  if (existsSync("package.json")) {
    try {
      const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { name?: string };
      if (pkg.name) return pkg.name;
    } catch { /* ignore */ }
  }
  // Fallback to directory name
  return process.cwd().split("/").pop() ?? "unknown";
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
