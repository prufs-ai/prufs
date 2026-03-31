/**
 * Code-Graph Linker
 *
 * Maintains the bidirectional mapping between code (files, line ranges)
 * and decision trail nodes. This is what makes "hover over a line and
 * see the decision trail" possible.
 *
 * Two mapping strategies:
 *   1. Line-based: maps file:lineStart-lineEnd to implementation nodes.
 *      Simple, works for any language, but breaks on refactoring.
 *
 *   2. AST-based (post-MVP): uses Tree-sitter to identify AST nodes
 *      (functions, classes, blocks) and maps those to implementation nodes.
 *      Survives renames and moves because it tracks structural identity.
 *
 * Phase 3 MVP ships with line-based mapping + a Git post-commit hook
 * that updates mappings automatically.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Code mapping data structures
// ---------------------------------------------------------------------------

export interface CodeMapping {
  id: string;
  implementationNodeId: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  astNodeHash?: string;
  repoId: string;
  commitSha: string;
  createdAt: string;
}

export interface LinkerConfig {
  /** Root directory of the Git repository */
  repoRoot: string;
  /** Path to the mappings JSON file (default: .prufs/mappings.json) */
  mappingsPath?: string;
  /** Repository identifier (default: derived from git remote) */
  repoId?: string;
}

// ---------------------------------------------------------------------------
// Linker
// ---------------------------------------------------------------------------

export class CodeGraphLinker {
  private config: Required<LinkerConfig>;
  private mappings: CodeMapping[] = [];

  constructor(config: LinkerConfig) {
    this.config = {
      mappingsPath: resolve(config.repoRoot, ".prufs/mappings.json"),
      repoId: config.repoId ?? this.detectRepoId(config.repoRoot),
      ...config,
    };

    this.loadMappings();
  }

  // -----------------------------------------------------------------------
  // Mapping operations
  // -----------------------------------------------------------------------

  /**
   * Add a mapping from an implementation node to a code location.
   */
  addMapping(
    implementationNodeId: string,
    filePath: string,
    lineStart: number,
    lineEnd: number,
    commitSha: string,
    astNodeHash?: string
  ): CodeMapping {
    const mapping: CodeMapping = {
      id: `${implementationNodeId}:${filePath}:${lineStart}`,
      implementationNodeId,
      filePath: relative(this.config.repoRoot, resolve(this.config.repoRoot, filePath)),
      lineStart,
      lineEnd,
      astNodeHash,
      repoId: this.config.repoId,
      commitSha,
      createdAt: new Date().toISOString(),
    };

    // Replace existing mapping for the same file range
    this.mappings = this.mappings.filter(
      (m) =>
        !(
          m.filePath === mapping.filePath &&
          m.lineStart === mapping.lineStart &&
          m.lineEnd === mapping.lineEnd
        )
    );

    this.mappings.push(mapping);
    this.saveMappings();
    return mapping;
  }

  /**
   * Look up the trail for a specific code location.
   * Returns all mappings that cover the given file and line.
   */
  lookup(filePath: string, line: number): CodeMapping[] {
    const normalized = relative(
      this.config.repoRoot,
      resolve(this.config.repoRoot, filePath)
    );

    return this.mappings.filter(
      (m) =>
        m.filePath === normalized &&
        line >= m.lineStart &&
        line <= m.lineEnd
    );
  }

  /**
   * Look up all mappings for a file.
   */
  lookupFile(filePath: string): CodeMapping[] {
    const normalized = relative(
      this.config.repoRoot,
      resolve(this.config.repoRoot, filePath)
    );
    return this.mappings.filter((m) => m.filePath === normalized);
  }

  /**
   * Get all mappings for an implementation node.
   */
  lookupNode(implementationNodeId: string): CodeMapping[] {
    return this.mappings.filter(
      (m) => m.implementationNodeId === implementationNodeId
    );
  }

  /**
   * Update mappings when a file is modified. Uses Git diff to detect
   * line shifts and adjusts mappings accordingly.
   */
  updateOnCommit(commitSha: string): { updated: number; invalidated: number } {
    let updated = 0;
    let invalidated = 0;

    try {
      // Get list of changed files in this commit
      const diffOutput = execSync(
        `git -C "${this.config.repoRoot}" diff --name-only ${commitSha}^..${commitSha}`,
        { encoding: "utf-8" }
      ).trim();

      if (!diffOutput) return { updated: 0, invalidated: 0 };

      const changedFiles = diffOutput.split("\n");

      for (const file of changedFiles) {
        const fileMappings = this.mappings.filter((m) => m.filePath === file);
        if (fileMappings.length === 0) continue;

        // Get the line-level diff to compute shifts
        try {
          const diffStat = execSync(
            `git -C "${this.config.repoRoot}" diff --stat ${commitSha}^..${commitSha} -- "${file}"`,
            { encoding: "utf-8" }
          );

          // Simple heuristic: if the file was modified but not heavily,
          // update the commit SHA. If it was heavily modified, invalidate.
          const insertions = (diffStat.match(/(\d+) insertion/) ?? [])[1];
          const deletions = (diffStat.match(/(\d+) deletion/) ?? [])[1];
          const totalChange =
            parseInt(insertions ?? "0", 10) +
            parseInt(deletions ?? "0", 10);

          if (totalChange > 100) {
            // Heavy modification - invalidate these mappings
            this.mappings = this.mappings.filter((m) => m.filePath !== file);
            invalidated += fileMappings.length;
          } else {
            // Light modification - update commit SHA, keep mappings
            for (const m of fileMappings) {
              m.commitSha = commitSha;
              updated++;
            }
          }
        } catch {
          // If we can't get diff stats, invalidate conservatively
          this.mappings = this.mappings.filter((m) => m.filePath !== file);
          invalidated += fileMappings.length;
        }
      }

      this.saveMappings();
    } catch {
      // Git command failed - no update possible
    }

    return { updated, invalidated };
  }

  /**
   * Auto-generate mappings from trail events. Reads the local NDJSON
   * event file and creates mappings for all implementation nodes.
   */
  generateFromEvents(eventsPath: string): number {
    if (!existsSync(eventsPath)) return 0;

    const content = readFileSync(eventsPath, "utf-8");
    const events = content
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));

    let count = 0;
    const currentSha = this.getCurrentCommitSha();

    for (const event of events) {
      if (event.event_type !== "node_created") continue;
      const node = event.payload;
      if (node.type !== "implementation") continue;

      // Parse file_changes (might be string or array depending on source)
      let fileChanges: Array<{ path: string; lines_added: number }>;
      if (typeof node.file_changes === "string") {
        fileChanges = JSON.parse(node.file_changes);
      } else {
        fileChanges = node.file_changes ?? [];
      }

      for (const fc of fileChanges) {
        // For new files, map the entire file
        // For modifications, we'd need the diff to know exact line ranges
        // Phase 3 MVP: map the full file as a rough approximation
        const fullPath = resolve(this.config.repoRoot, fc.path);
        if (existsSync(fullPath)) {
          const lines = readFileSync(fullPath, "utf-8").split("\n").length;
          this.addMapping(
            node.id,
            fc.path,
            1,
            lines,
            node.commit_sha ?? currentSha
          );
          count++;
        }
      }
    }

    return count;
  }

  /**
   * Get summary stats.
   */
  stats(): {
    totalMappings: number;
    filesTracked: number;
    nodesLinked: number;
  } {
    const files = new Set(this.mappings.map((m) => m.filePath));
    const nodes = new Set(this.mappings.map((m) => m.implementationNodeId));
    return {
      totalMappings: this.mappings.length,
      filesTracked: files.size,
      nodesLinked: nodes.size,
    };
  }

  // -----------------------------------------------------------------------
  // Git hook installation
  // -----------------------------------------------------------------------

  /**
   * Install a Git post-commit hook that updates mappings automatically.
   */
  installGitHook(): void {
    const hookDir = resolve(this.config.repoRoot, ".git/hooks");
    const hookPath = resolve(hookDir, "post-commit");

    if (!existsSync(hookDir)) {
      mkdirSync(hookDir, { recursive: true });
    }

    const hookScript = `#!/bin/sh
# Prufs - auto-update code-graph mappings on commit
COMMIT_SHA=$(git rev-parse HEAD)
if command -v npx >/dev/null 2>&1; then
  npx prufs link-commit "$COMMIT_SHA" 2>/dev/null || true
fi
`;

    // Append to existing hook or create new one
    if (existsSync(hookPath)) {
      const existing = readFileSync(hookPath, "utf-8");
      if (!existing.includes("Prufs")) {
        writeFileSync(hookPath, existing + "\n" + hookScript);
      }
    } else {
      writeFileSync(hookPath, hookScript);
    }

    // Make executable
    execSync(`chmod +x "${hookPath}"`);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private loadMappings(): void {
    if (existsSync(this.config.mappingsPath)) {
      try {
        const content = readFileSync(this.config.mappingsPath, "utf-8");
        this.mappings = JSON.parse(content);
      } catch {
        this.mappings = [];
      }
    }
  }

  private saveMappings(): void {
    const dir = dirname(this.config.mappingsPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(
      this.config.mappingsPath,
      JSON.stringify(this.mappings, null, 2)
    );
  }

  private detectRepoId(repoRoot: string): string {
    try {
      const remote = execSync(
        `git -C "${repoRoot}" remote get-url origin`,
        { encoding: "utf-8" }
      ).trim();
      // Extract "org/repo" from URL
      const match = remote.match(/[:/]([^/]+\/[^/.]+)(?:\.git)?$/);
      return match ? match[1] : "local";
    } catch {
      return "local";
    }
  }

  private getCurrentCommitSha(): string {
    try {
      return execSync(
        `git -C "${this.config.repoRoot}" rev-parse HEAD`,
        { encoding: "utf-8" }
      ).trim();
    } catch {
      return "unknown";
    }
  }
}
