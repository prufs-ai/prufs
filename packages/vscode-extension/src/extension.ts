/**
 * Prufs VS Code Extension
 *
 * Three features:
 *   1. Hover-to-trail: hover over any line to see its decision trail
 *   2. Gutter icons: lines with trail coverage get a small indicator
 *   3. Trace command: right-click -> "Trace to Directive" opens the
 *      full trail in a webview panel
 *
 * Reads from the local .prufs/mappings.json file for code mappings,
 * and queries the Trail API (GraphQL) for the full trail data.
 */

import * as vscode from "vscode";
import { readFileSync, existsSync } from "fs";
import { resolve, relative } from "path";

// ---------------------------------------------------------------------------
// Types (subset of the full Prufs types for extension use)
// ---------------------------------------------------------------------------

interface CodeMapping {
  id: string;
  implementationNodeId: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  repoId: string;
  commitSha: string;
}

interface TrailNode {
  id: string;
  type: string;
  timestamp: string;
  sessionId: string;
  projectId: string;
  text?: string;
  chosen?: string;
  rationale?: string;
  alternatives?: Array<{ description: string; rejectionReason?: string }>;
  confidence?: number;
  author?: string;
  agentId?: string;
  modelId?: string;
  domainTags?: string[];
  verificationType?: string;
  result?: string;
  details?: string;
  linesAdded?: number;
  linesRemoved?: number;
  fileChanges?: Array<{ path: string; changeType: string; linesAdded: number; linesRemoved: number }>;
}

interface TrailPath {
  nodes: TrailNode[];
  edges: Array<{ fromNode: string; toNode: string; type: string }>;
  depth: number;
}

// ---------------------------------------------------------------------------
// Extension activation
// ---------------------------------------------------------------------------

let mappings: CodeMapping[] = [];
let gutterDecorationType: vscode.TextEditorDecorationType;

export function activate(context: vscode.ExtensionContext) {
  console.log("[prufs] Extension activated");

  // Load mappings
  loadMappings();

  // Create gutter decoration
  gutterDecorationType = vscode.window.createTextEditorDecorationType({
    gutterIconPath: vscode.Uri.file(
      resolve(__dirname, "..", "media", "trail-dot.svg")
    ),
    gutterIconSize: "60%",
    overviewRulerColor: "#534AB7",
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });

  // ─── Hover provider ─────────────────────────────────────────
  const hoverProvider = vscode.languages.registerHoverProvider(
    { scheme: "file" },
    {
      async provideHover(document, position) {
        const config = vscode.workspace.getConfiguration("prufs");
        if (!config.get("hoverEnabled", true)) return;

        const filePath = getRelativePath(document.uri);
        if (!filePath) return;

        const line = position.line + 1; // VS Code is 0-indexed
        const matches = mappings.filter(
          (m) =>
            m.filePath === filePath &&
            line >= m.lineStart &&
            line <= m.lineEnd
        );

        if (matches.length === 0) return;

        // Fetch trail from API for the first match
        const trail = await fetchTrailUp(matches[0].implementationNodeId);
        if (!trail || trail.nodes.length === 0) {
          return new vscode.Hover(
            new vscode.MarkdownString(
              `$(compass) **Prufs** - trail mapped but API unavailable`
            )
          );
        }

        const md = formatTrailHover(trail);
        return new vscode.Hover(md);
      },
    }
  );

  // ─── Trace command ──────────────────────────────────────────
  const traceCommand = vscode.commands.registerCommand(
    "prufs.traceUp",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const filePath = getRelativePath(editor.document.uri);
      if (!filePath) return;

      const line = editor.selection.active.line + 1;
      const matches = mappings.filter(
        (m) =>
          m.filePath === filePath &&
          line >= m.lineStart &&
          line <= m.lineEnd
      );

      if (matches.length === 0) {
        vscode.window.showInformationMessage(
          "No Prufs trail found for this line."
        );
        return;
      }

      const trail = await fetchTrailUp(matches[0].implementationNodeId);
      if (!trail || trail.nodes.length === 0) {
        vscode.window.showWarningMessage(
          "Trail API unavailable. Is the trail-api service running?"
        );
        return;
      }

      showTrailPanel(context, trail);
    }
  );

  // ─── Show session command ───────────────────────────────────
  const sessionCommand = vscode.commands.registerCommand(
    "prufs.showSession",
    async () => {
      const sessionId = await vscode.window.showInputBox({
        prompt: "Enter session ID",
        placeHolder: "abc12345-...",
      });
      if (!sessionId) return;

      const trail = await fetchSession(sessionId);
      if (!trail) {
        vscode.window.showWarningMessage("Session not found or API unavailable.");
        return;
      }

      showTrailPanel(context, trail);
    }
  );

  // ─── Gutter decorations ────────────────────────────────────
  const updateDecorations = (editor: vscode.TextEditor) => {
    const config = vscode.workspace.getConfiguration("prufs");
    if (!config.get("showGutterIcons", true)) return;

    const filePath = getRelativePath(editor.document.uri);
    if (!filePath) return;

    const fileMappings = mappings.filter((m) => m.filePath === filePath);
    const decorations: vscode.DecorationOptions[] = [];

    for (const m of fileMappings) {
      for (let line = m.lineStart; line <= m.lineEnd && line <= editor.document.lineCount; line++) {
        decorations.push({
          range: new vscode.Range(line - 1, 0, line - 1, 0),
          hoverMessage: `Prufs: trail available (${m.implementationNodeId.slice(0, 8)}...)`,
        });
      }
    }

    editor.setDecorations(gutterDecorationType, decorations);
  };

  // Apply decorations on editor change
  vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      if (editor) updateDecorations(editor);
    },
    null,
    context.subscriptions
  );

  // Apply to current editor
  if (vscode.window.activeTextEditor) {
    updateDecorations(vscode.window.activeTextEditor);
  }

  // Watch for mapping file changes
  const mappingsWatcher = vscode.workspace.createFileSystemWatcher(
    "**/.prufs/mappings.json"
  );
  mappingsWatcher.onDidChange(() => {
    loadMappings();
    if (vscode.window.activeTextEditor) {
      updateDecorations(vscode.window.activeTextEditor);
    }
  });

  context.subscriptions.push(
    hoverProvider,
    traceCommand,
    sessionCommand,
    mappingsWatcher,
    gutterDecorationType
  );
}

export function deactivate() {
  console.log("[prufs] Extension deactivated");
}

// ---------------------------------------------------------------------------
// Trail API client
// ---------------------------------------------------------------------------

async function fetchTrailUp(nodeId: string): Promise<TrailPath | null> {
  const endpoint = vscode.workspace
    .getConfiguration("prufs")
    .get("apiEndpoint", "http://localhost:3200");

  try {
    const response = await fetch(`${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query TraceUp($nodeId: ID!) {
          traceUp(nodeId: $nodeId) {
            nodes {
              ... on Directive { id type text author timestamp }
              ... on Interpretation { id type text agentId modelId confidence timestamp }
              ... on Decision { id type chosen rationale alternatives { description rejectionReason } domainTags confidence timestamp }
              ... on Constraint { id type text source timestamp }
              ... on Implementation { id type linesAdded linesRemoved fileChanges { path changeType linesAdded linesRemoved } timestamp }
              ... on Verification { id type verificationType result details timestamp }
            }
            edges { fromNode toNode type }
            depth
          }
        }`,
        variables: { nodeId },
      }),
    });

    const data = (await response.json()) as { data?: { traceUp: TrailPath } };
    return data.data?.traceUp ?? null;
  } catch {
    return null;
  }
}

async function fetchSession(sessionId: string): Promise<TrailPath | null> {
  const endpoint = vscode.workspace
    .getConfiguration("prufs")
    .get("apiEndpoint", "http://localhost:3200");

  try {
    const response = await fetch(`${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query Session($sessionId: String!) {
          session(sessionId: $sessionId) {
            nodes {
              ... on Directive { id type text author timestamp }
              ... on Interpretation { id type text confidence timestamp }
              ... on Decision { id type chosen rationale domainTags confidence timestamp }
              ... on Constraint { id type text source timestamp }
              ... on Implementation { id type linesAdded linesRemoved timestamp }
              ... on Verification { id type result details timestamp }
            }
            edges { fromNode toNode type }
            nodeCount
          }
        }`,
        variables: { sessionId },
      }),
    });

    const data = (await response.json()) as {
      data?: { session: { nodes: TrailNode[]; edges: Array<{ fromNode: string; toNode: string; type: string }>; nodeCount: number } };
    };
    const session = data.data?.session;
    if (!session) return null;
    return { nodes: session.nodes, edges: session.edges, depth: session.nodeCount };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Trail display
// ---------------------------------------------------------------------------

function formatTrailHover(trail: TrailPath): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportHtml = true;

  md.appendMarkdown(`### $(compass) Prufs Trail\n\n`);

  for (const node of trail.nodes) {
    switch (node.type) {
      case "directive":
        md.appendMarkdown(`**Directive** _(${node.author})_\n\n`);
        md.appendMarkdown(`> ${node.text}\n\n`);
        break;

      case "interpretation":
        md.appendMarkdown(
          `**Interpretation** _(confidence: ${((node.confidence ?? 0) * 100).toFixed(0)}%)_\n\n`
        );
        md.appendMarkdown(`${truncate(node.text ?? "", 200)}\n\n`);
        break;

      case "decision":
        md.appendMarkdown(
          `**Decision** _(confidence: ${((node.confidence ?? 0) * 100).toFixed(0)}%)_\n\n`
        );
        md.appendMarkdown(`Chose: **${node.chosen}**\n\n`);
        if (node.rationale) {
          md.appendMarkdown(`_${truncate(node.rationale, 150)}_\n\n`);
        }
        if (node.alternatives && node.alternatives.length > 0) {
          md.appendMarkdown(`Rejected:\n`);
          for (const alt of node.alternatives) {
            md.appendMarkdown(
              `- ~~${alt.description}~~ ${alt.rejectionReason ? `- ${alt.rejectionReason}` : ""}\n`
            );
          }
          md.appendMarkdown(`\n`);
        }
        break;

      case "constraint":
        md.appendMarkdown(`**Constraint**\n\n`);
        md.appendMarkdown(`${node.text}\n\n`);
        break;

      case "verification":
        const icon = node.result === "pass" ? "$(check)" : "$(x)";
        md.appendMarkdown(`**Verification** ${icon} ${node.result}\n\n`);
        if (node.details) {
          md.appendMarkdown(`${node.details}\n\n`);
        }
        break;
    }
  }

  md.appendMarkdown(
    `---\n[View full trail](command:prufs.traceUp) | Depth: ${trail.depth}`
  );

  return md;
}

function showTrailPanel(context: vscode.ExtensionContext, trail: TrailPath) {
  const panel = vscode.window.createWebviewPanel(
    "prufsTrail",
    "Prufs Trail",
    vscode.ViewColumn.Beside,
    { enableScripts: true }
  );

  panel.webview.html = getTrailWebviewContent(trail);
}

function getTrailWebviewContent(trail: TrailPath): string {
  const nodesHtml = trail.nodes
    .map((node) => {
      const typeColors: Record<string, string> = {
        directive: "#534AB7",
        interpretation: "#1D9E75",
        decision: "#D85A30",
        constraint: "#993556",
        implementation: "#185FA5",
        verification: "#639922",
      };

      const color = typeColors[node.type] ?? "#888";
      let content = "";

      switch (node.type) {
        case "directive":
          content = `<strong>${node.text}</strong><br><small>by ${node.author}</small>`;
          break;
        case "interpretation":
          content = `${truncate(node.text ?? "", 300)}<br><small>Confidence: ${((node.confidence ?? 0) * 100).toFixed(0)}%</small>`;
          break;
        case "decision":
          content = `<strong>Chose:</strong> ${node.chosen}<br><em>${truncate(node.rationale ?? "", 200)}</em>`;
          if (node.alternatives && node.alternatives.length > 0) {
            content += `<br><small>Rejected: ${node.alternatives.map((a) => a.description).join(", ")}</small>`;
          }
          break;
        case "constraint":
          content = `${node.text}`;
          break;
        case "implementation":
          content = `${node.linesAdded ?? 0} lines added, ${node.linesRemoved ?? 0} removed`;
          if (node.fileChanges) {
            content += `<br><small>${node.fileChanges.map((f) => f.path).join(", ")}</small>`;
          }
          break;
        case "verification":
          content = `${node.verificationType}: <strong>${node.result}</strong>${node.details ? ` - ${node.details}` : ""}`;
          break;
      }

      return `
        <div style="border-left: 3px solid ${color}; padding: 12px 16px; margin: 8px 0; background: var(--vscode-editor-background); border-radius: 4px;">
          <div style="font-size: 11px; text-transform: uppercase; color: ${color}; font-weight: 600; margin-bottom: 4px;">${node.type}</div>
          <div style="font-size: 13px; line-height: 1.5;">${content}</div>
          <div style="font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 4px;">${node.timestamp}</div>
        </div>
      `;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: var(--vscode-font-family); padding: 16px; color: var(--vscode-foreground); }
    h2 { font-size: 16px; font-weight: 500; margin-bottom: 16px; }
    .stats { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 16px; }
  </style>
</head>
<body>
  <h2>Decision Trail</h2>
  <div class="stats">${trail.nodes.length} nodes, ${trail.edges.length} edges, depth ${trail.depth}</div>
  ${nodesHtml}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadMappings() {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return;

  const mappingsPath = resolve(workspaceRoot, ".prufs/mappings.json");
  if (!existsSync(mappingsPath)) {
    mappings = [];
    return;
  }

  try {
    mappings = JSON.parse(readFileSync(mappingsPath, "utf-8"));
    console.log(`[prufs] Loaded ${mappings.length} code mappings`);
  } catch {
    mappings = [];
  }
}

function getRelativePath(uri: vscode.Uri): string | null {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return null;
  return relative(workspaceRoot, uri.fsPath);
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 3) + "..." : text;
}
