/**
 * Claude Code Hook
 *
 * Integrates Prufs with Claude Code sessions. Two modes:
 *
 * 1. **Live mode** - watches the Claude Code JSONL conversation log
 *    in real time and emits trail events as the session progresses.
 *
 * 2. **Replay mode** - processes a completed JSONL transcript and
 *    reconstructs the full decision trail after the fact.
 *
 * Claude Code stores conversations as JSONL files in:
 *   ~/.claude/projects/<project-hash>/conversations/<id>.jsonl
 *
 * Each line is a message object with role, content, and metadata.
 *
 * Usage (live):
 *   const hook = new ClaudeCodeHook({ project_id: "my-project", transport: "local" });
 *   await hook.watchSession("/path/to/conversation.jsonl");
 *
 * Usage (replay):
 *   const hook = new ClaudeCodeHook({ project_id: "my-project", transport: "local" });
 *   await hook.replayTranscript("/path/to/conversation.jsonl");
 */

import { watch, readFileSync, existsSync } from "node:fs";
import { SessionObserver, type SessionObserverConfig, type AgentEvent } from "./session-observer.js";
import type { FileChange } from "../types.js";

// ---------------------------------------------------------------------------
// Claude Code message format (subset relevant to trail capture)
// ---------------------------------------------------------------------------

interface ClaudeCodeMessage {
  type: "human" | "assistant" | "tool_use" | "tool_result" | "system";
  content?: string | ClaudeCodeContentBlock[];
  role?: string;
  timestamp?: string;
  // Tool use fields
  name?: string;
  input?: Record<string, unknown>;
  // Tool result fields
  tool_use_id?: string;
  output?: string;
}

interface ClaudeCodeContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string;
}

// ---------------------------------------------------------------------------
// Claude Code Hook
// ---------------------------------------------------------------------------

export class ClaudeCodeHook {
  private observer: SessionObserver;
  private processedLines = 0;

  constructor(config: SessionObserverConfig) {
    this.observer = new SessionObserver({
      agent_id: "claude-code",
      ...config,
    });
  }

  /**
   * Watch a live Claude Code session JSONL file.
   * Processes existing content, then watches for new lines.
   * Returns a cleanup function to stop watching.
   */
  async watchSession(jsonlPath: string): Promise<() => void> {
    if (!existsSync(jsonlPath)) {
      throw new Error(`Conversation file not found: ${jsonlPath}`);
    }

    // Start the trail session
    await this.observer.onEvent({
      type: "session_start",
      timestamp: new Date().toISOString(),
      data: {},
    });

    // Process existing content
    await this.processFile(jsonlPath);

    // Watch for changes
    const watcher = watch(jsonlPath, async () => {
      await this.processFile(jsonlPath);
    });

    return () => {
      watcher.close();
      void this.observer.onEvent({
        type: "session_end",
        timestamp: new Date().toISOString(),
        data: {},
      });
    };
  }

  /**
   * Replay a completed Claude Code transcript and reconstruct
   * the decision trail.
   */
  async replayTranscript(jsonlPath: string): Promise<void> {
    if (!existsSync(jsonlPath)) {
      throw new Error(`Transcript file not found: ${jsonlPath}`);
    }

    await this.observer.onEvent({
      type: "session_start",
      timestamp: new Date().toISOString(),
      data: {},
    });

    await this.processFile(jsonlPath);

    await this.observer.onEvent({
      type: "session_end",
      timestamp: new Date().toISOString(),
      data: {},
    });
  }

  /**
   * Get the underlying SessionObserver for advanced usage.
   */
  get session(): SessionObserver {
    return this.observer;
  }

  // -----------------------------------------------------------------------
  // JSONL processing
  // -----------------------------------------------------------------------

  private async processFile(path: string): Promise<void> {
    const content = readFileSync(path, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);

    // Only process new lines since last read
    const newLines = lines.slice(this.processedLines);
    this.processedLines = lines.length;

    for (const line of newLines) {
      try {
        const msg = JSON.parse(line) as ClaudeCodeMessage;
        const events = this.translateMessage(msg);
        for (const event of events) {
          await this.observer.onEvent(event);
        }
      } catch {
        // Skip malformed lines
      }
    }
  }

  /**
   * Translate a Claude Code message into zero or more AgentEvents.
   */
  private translateMessage(msg: ClaudeCodeMessage): AgentEvent[] {
    const events: AgentEvent[] = [];
    const ts = msg.timestamp ?? new Date().toISOString();

    // Human messages become directives
    if (msg.type === "human" || msg.role === "user") {
      const text = extractText(msg);
      if (text) {
        events.push({
          type: "user_prompt",
          timestamp: ts,
          data: { text, author: "human" },
        });
      }
      return events;
    }

    // Assistant messages - need to distinguish plan, reasoning, and tool use
    if (msg.type === "assistant" || msg.role === "assistant") {
      const contentBlocks = normalizeContent(msg);

      for (const block of contentBlocks) {
        if (block.type === "text" && block.text) {
          // First substantive text block in a turn is treated as the plan/interpretation
          // Subsequent text blocks are reasoning
          if (!this.hasEmittedPlanThisTurn(events)) {
            events.push({
              type: "agent_plan",
              timestamp: ts,
              data: { text: block.text, confidence: 0.85 },
            });
          } else {
            events.push({
              type: "agent_reasoning",
              timestamp: ts,
              data: { text: block.text },
            });
          }
        }

        // Tool use blocks
        if (block.type === "tool_use" && block.name) {
          events.push({
            type: "tool_call",
            timestamp: ts,
            data: { tool: block.name, input: block.input ?? {} },
          });

          // File editing tools map to file_change events
          const fileChange = toolCallToFileChange(block.name, block.input ?? {});
          if (fileChange) {
            events.push({
              type: "file_change",
              timestamp: ts,
              data: fileChange as unknown as Record<string, unknown>,
            });
          }
        }
      }
    }

    // Tool results
    if (msg.type === "tool_result") {
      const output = msg.output ?? (typeof msg.content === "string" ? msg.content : "");
      events.push({
        type: "tool_result",
        timestamp: ts,
        data: { tool_use_id: msg.tool_use_id, output },
      });

      // Check if this is a test result
      const testResult = parseTestOutput(output);
      if (testResult) {
        events.push({
          type: "test_result",
          timestamp: ts,
          data: testResult,
        });
      }
    }

    return events;
  }

  private hasEmittedPlanThisTurn(events: AgentEvent[]): boolean {
    return events.some((e) => e.type === "agent_plan");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractText(msg: ClaudeCodeMessage): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((b): b is ClaudeCodeContentBlock & { text: string } => b.type === "text" && !!b.text)
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}

function normalizeContent(msg: ClaudeCodeMessage): ClaudeCodeContentBlock[] {
  if (typeof msg.content === "string") {
    return [{ type: "text", text: msg.content }];
  }
  if (Array.isArray(msg.content)) {
    return msg.content;
  }
  return [];
}

/**
 * Map Claude Code tool calls to file change events.
 */
function toolCallToFileChange(
  toolName: string,
  input: Record<string, unknown>
): FileChange | null {
  // Claude Code tool names for file operations
  const writeTools = ["write_file", "create_file", "Write", "Create"];
  const editTools = ["edit_file", "str_replace_editor", "Edit", "Replace"];

  if (writeTools.some((t) => toolName.includes(t))) {
    const path = (input.path ?? input.file_path ?? input.filename ?? "unknown") as string;
    const content = (input.content ?? input.file_text ?? "") as string;
    const lines = content.split("\n").length;
    return {
      path,
      change_type: "added",
      lines_added: lines,
      lines_removed: 0,
    };
  }

  if (editTools.some((t) => toolName.includes(t))) {
    const path = (input.path ?? input.file_path ?? input.filename ?? "unknown") as string;
    const oldStr = (input.old_str ?? "") as string;
    const newStr = (input.new_str ?? "") as string;
    return {
      path,
      change_type: "modified",
      lines_added: newStr.split("\n").length,
      lines_removed: oldStr.split("\n").length,
    };
  }

  return null;
}

/**
 * Try to parse test output from a tool result.
 * Handles common test runner output formats.
 */
function parseTestOutput(
  output: string
): { passed: number; failed: number; skipped: number; duration_ms: number } | null {
  // Node test runner: "# pass N", "# fail N"
  const nodePass = output.match(/# pass\s+(\d+)/);
  const nodeFail = output.match(/# fail\s+(\d+)/);
  if (nodePass || nodeFail) {
    return {
      passed: nodePass ? parseInt(nodePass[1], 10) : 0,
      failed: nodeFail ? parseInt(nodeFail[1], 10) : 0,
      skipped: 0,
      duration_ms: parseDuration(output),
    };
  }

  // Jest/Vitest: "Tests:  N passed, M failed"
  const jestMatch = output.match(/Tests:\s+(?:(\d+)\s+passed)?(?:,?\s*(\d+)\s+failed)?(?:,?\s*(\d+)\s+skipped)?/);
  if (jestMatch) {
    return {
      passed: parseInt(jestMatch[1] ?? "0", 10),
      failed: parseInt(jestMatch[2] ?? "0", 10),
      skipped: parseInt(jestMatch[3] ?? "0", 10),
      duration_ms: parseDuration(output),
    };
  }

  // Pytest: "N passed, M failed"
  const pytestMatch = output.match(/(\d+)\s+passed(?:,\s*(\d+)\s+failed)?(?:,\s*(\d+)\s+skipped)?/);
  if (pytestMatch) {
    return {
      passed: parseInt(pytestMatch[1], 10),
      failed: parseInt(pytestMatch[2] ?? "0", 10),
      skipped: parseInt(pytestMatch[3] ?? "0", 10),
      duration_ms: parseDuration(output),
    };
  }

  return null;
}

function parseDuration(output: string): number {
  // "duration_ms: 1234" or "Time: 1.234s" or "in 1234ms"
  const msMatch = output.match(/(\d+)\s*ms/);
  if (msMatch) return parseInt(msMatch[1], 10);

  const secMatch = output.match(/(\d+\.?\d*)\s*s(?:ec)?/);
  if (secMatch) return Math.round(parseFloat(secMatch[1]) * 1000);

  return 0;
}
