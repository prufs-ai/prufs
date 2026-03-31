/**
 * Local transport - stores events as newline-delimited JSON (NDJSON).
 *
 * Each event is appended as a single JSON line to a file. This is
 * portable (no native dependencies), human-readable, and trivially
 * parseable by the ingestion service.
 *
 * For production use, swap in the SQLite transport (transport-sqlite.ts)
 * which provides better querying and sync-status tracking. This file
 * transport is the zero-dependency fallback.
 */

import { writeFileSync, appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { TrailEvent } from "./types.js";
import type { Transport } from "./recorder.js";

export class LocalTransport implements Transport {
  private filePath: string;

  constructor(db_path: string) {
    // Reuse the config key but write .ndjson instead of .db
    this.filePath = db_path.replace(/\.db$/, ".ndjson");

    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Create file if it doesn't exist
    if (!existsSync(this.filePath)) {
      writeFileSync(this.filePath, "");
    }
  }

  async emit(event: TrailEvent): Promise<void> {
    const line = JSON.stringify(event) + "\n";
    appendFileSync(this.filePath, line);
  }

  async flush(): Promise<void> {
    // No-op - writes are synchronous appends
  }

  async close(): Promise<void> {
    // No resources to release
  }

  // -----------------------------------------------------------------------
  // Read helpers (used by ingestion service and demo scripts)
  // -----------------------------------------------------------------------

  /**
   * Read all events from the file.
   */
  readAll(): TrailEvent[] {
    if (!existsSync(this.filePath)) return [];
    const content = readFileSync(this.filePath, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as TrailEvent);
  }

  /**
   * Count of events in the file.
   */
  stats(): { total: number; filePath: string } {
    const events = this.readAll();
    return { total: events.length, filePath: this.filePath };
  }
}
