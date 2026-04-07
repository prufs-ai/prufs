import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  CausalCommitLike,
  CommitRef,
  LocalStoreLike,
} from "@prufs/sync";

/**
 * Minimal file-backed LocalStoreLike implementation for the CLI.
 *
 * Layout:
 *   <storePath>/commits/<commit_id>.json
 *   <storePath>/heads.json
 *
 * This is intentionally simple. The production @prufs/store package owns the
 * full implementation (indices, compaction, signature verification). The CLI
 * only needs a working store for its five commands; swap this out by passing
 * a different LocalStoreLike to CloudSync if you have the real store on hand.
 */
export class FileStore implements LocalStoreLike {
  private readonly root: string;
  private readonly commitsDir: string;
  private readonly headsFile: string;

  constructor(root: string) {
    this.root = root;
    this.commitsDir = join(root, "commits");
    this.headsFile = join(root, "heads.json");
  }

  private async ensure(): Promise<void> {
    if (!existsSync(this.commitsDir)) {
      await mkdir(this.commitsDir, { recursive: true });
    }
  }

  async log(branch?: string): Promise<CommitRef[]> {
    await this.ensure();
    const entries = await readdir(this.commitsDir);
    const refs: CommitRef[] = [];
    for (const f of entries) {
      if (!f.endsWith(".json")) continue;
      const raw = await readFile(join(this.commitsDir, f), "utf8");
      const c = JSON.parse(raw) as CausalCommitLike;
      if (!branch || c.branch === branch) {
        refs.push({
          commit_id: c.commit_id,
          parent_hash: c.parent_hash,
          branch: c.branch ?? "main",
          timestamp: c.timestamp,
        });
      }
    }
    refs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return refs;
  }

  async get(commit_id: string): Promise<CausalCommitLike | null> {
    await this.ensure();
    const path = join(this.commitsDir, `${commit_id}.json`);
    if (!existsSync(path)) return null;
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as CausalCommitLike;
  }

  async put(commit: CausalCommitLike): Promise<void> {
    await this.ensure();
    const path = join(this.commitsDir, `${commit.commit_id}.json`);
    await writeFile(path, JSON.stringify(commit, null, 2));
    const heads = await this.heads();
    heads[commit.branch ?? "main"] = commit.commit_id;
    await writeFile(this.headsFile, JSON.stringify(heads, null, 2));
  }

  async heads(): Promise<Record<string, string>> {
    if (!existsSync(this.headsFile)) return {};
    const raw = await readFile(this.headsFile, "utf8");
    return JSON.parse(raw) as Record<string, string>;
  }

  async branches(): Promise<string[]> {
    const h = await this.heads();
    return Object.keys(h);
  }
}
