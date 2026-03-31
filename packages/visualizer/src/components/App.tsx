import { useState, useEffect, useCallback } from "react";
import type { TrailNode, TrailEdge, TrailPath, SessionGraph } from "../lib/api";

/**
 * Demo data for offline/standalone use. In production, this comes
 * from the Trail API via GraphQL. The demo data mirrors the output
 * of the demo-trail.ts script.
 */
const DEMO_TRAIL: TrailPath = {
  depth: 5,
  edges: [
    { fromNode: "n2", toNode: "n1", type: "caused_by" },
    { fromNode: "n4", toNode: "n2", type: "caused_by" },
    { fromNode: "n4", toNode: "n3", type: "constrained_by" },
    { fromNode: "n5", toNode: "n2", type: "caused_by" },
    { fromNode: "n6", toNode: "n4", type: "caused_by" },
    { fromNode: "n6", toNode: "n5", type: "caused_by" },
    { fromNode: "n6", toNode: "n7", type: "verified_by" },
  ],
  nodes: [
    { id: "n1", type: "directive", timestamp: "2026-03-30T00:10:37Z", text: "Add user search to the admin panel with typeahead suggestions", author: "wade", sessionId: "demo-session" },
    { id: "n2", type: "interpretation", timestamp: "2026-03-30T00:10:38Z", text: "Implement a search endpoint at GET /api/admin/users/search with query parameter, returning paginated results. Build a React component with debounced typeahead using the existing Elasticsearch index on the users collection.", agentId: "claude-code", modelId: "claude-sonnet-4-20250514", confidence: 0.92, sessionId: "demo-session" },
    { id: "n3", type: "constraint", timestamp: "2026-03-30T00:10:38Z", text: "Must use existing API authentication middleware - no new auth patterns allowed", source: "project_rule", sessionId: "demo-session" },
    { id: "n4", type: "decision", timestamp: "2026-03-30T00:10:39Z", chosen: "Use Elasticsearch for search backend", rationale: "Elasticsearch index on users collection already exists (created for customer-facing search). Supports fuzzy matching and relevance scoring out of the box. Reusing existing infrastructure avoids new operational burden.", alternatives: [{ description: "PostgreSQL full-text search with pg_trgm", rejectionReason: "No existing full-text index on users table; would require migration and index build time" }, { description: "In-memory search with Fuse.js on the frontend", rejectionReason: "Admin panel has 50K+ users; loading all into browser memory is not feasible" }], domainTags: ["search", "database", "elasticsearch", "performance"], confidence: 0.95, sessionId: "demo-session" },
    { id: "n5", type: "decision", timestamp: "2026-03-30T00:10:39Z", chosen: "Debounced input with dropdown results list", rationale: "Typeahead with 300ms debounce balances responsiveness with API efficiency. Dropdown overlay keeps the admin panel layout stable.", alternatives: [{ description: "Full-page search results view", rejectionReason: "Disrupts admin workflow; typeahead keeps user in context" }], domainTags: ["ui", "react", "search", "ux"], confidence: 0.88, sessionId: "demo-session" },
    { id: "n6", type: "implementation", timestamp: "2026-03-30T00:10:40Z", linesAdded: 445, linesRemoved: 2, fileChanges: [{ path: "src/api/routes/admin/users.ts", changeType: "modified", linesAdded: 45, linesRemoved: 2 }, { path: "src/api/services/user-search.ts", changeType: "added", linesAdded: 67, linesRemoved: 0 }, { path: "src/components/admin/UserSearch.tsx", changeType: "added", linesAdded: 120, linesRemoved: 0 }, { path: "src/components/admin/UserSearch.module.css", changeType: "added", linesAdded: 48, linesRemoved: 0 }, { path: "src/hooks/useDebounce.ts", changeType: "added", linesAdded: 18, linesRemoved: 0 }, { path: "tests/api/user-search.test.ts", changeType: "added", linesAdded: 85, linesRemoved: 0 }, { path: "tests/components/UserSearch.test.tsx", changeType: "added", linesAdded: 62, linesRemoved: 0 }], commitSha: "a1b2c3d4", sessionId: "demo-session" },
    { id: "n7", type: "verification", timestamp: "2026-03-30T00:10:41Z", verificationType: "test", result: "pass", details: "All 12 tests passed. Coverage: 94% on new code.", sessionId: "demo-session" },
  ],
};

// ─── Color system ───────────────────────────────────────────

const NODE_COLORS: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  directive:      { bg: "#EEEDFE", border: "#534AB7", text: "#3C3489", badge: "#534AB7" },
  interpretation: { bg: "#E1F5EE", border: "#0F6E56", text: "#085041", badge: "#1D9E75" },
  decision:       { bg: "#FAECE7", border: "#993C1D", text: "#712B13", badge: "#D85A30" },
  constraint:     { bg: "#FBEAF0", border: "#993556", text: "#72243E", badge: "#D4537E" },
  implementation: { bg: "#E6F1FB", border: "#185FA5", text: "#0C447C", badge: "#378ADD" },
  verification:   { bg: "#EAF3DE", border: "#3B6D11", text: "#27500A", badge: "#639922" },
};

// ─── Main App ───────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState<"trail" | "graph" | "search">("trail");
  const [trail, setTrail] = useState<TrailPath>(DEMO_TRAIL);
  const [selectedNode, setSelectedNode] = useState<TrailNode | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isDemo, setIsDemo] = useState(true);

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAF8", fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif" }}>
      {/* Header */}
      <header style={{
        borderBottom: "1px solid #E8E6DF",
        padding: "16px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "#fff",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6,
            background: "linear-gradient(135deg, #534AB7 0%, #1D9E75 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 14, fontWeight: 700,
          }}>P</div>
          <span style={{ fontSize: 17, fontWeight: 600, color: "#2C2C2A", letterSpacing: "-0.02em" }}>Prufs</span>
          {isDemo && (
            <span style={{
              fontSize: 10, fontWeight: 600, textTransform: "uppercase",
              background: "#FAEEDA", color: "#854F0B", padding: "2px 8px",
              borderRadius: 4, letterSpacing: "0.05em",
            }}>demo data</span>
          )}
        </div>
        <nav style={{ display: "flex", gap: 2, background: "#F1EFE8", borderRadius: 8, padding: 2 }}>
          {(["trail", "graph", "search"] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: "6px 16px", borderRadius: 6, border: "none", cursor: "pointer",
              fontSize: 13, fontWeight: view === v ? 600 : 400, fontFamily: "inherit",
              background: view === v ? "#fff" : "transparent",
              color: view === v ? "#2C2C2A" : "#888780",
              boxShadow: view === v ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
              transition: "all 0.15s",
            }}>
              {v === "trail" ? "Decision trail" : v === "graph" ? "Session graph" : "Search"}
            </button>
          ))}
        </nav>
      </header>

      {/* Content */}
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 24px 80px" }}>
        {view === "trail" && <TrailView trail={trail} selectedNode={selectedNode} onSelectNode={setSelectedNode} />}
        {view === "graph" && <GraphView trail={trail} onSelectNode={setSelectedNode} />}
        {view === "search" && <SearchView query={searchQuery} onQueryChange={setSearchQuery} />}
      </main>
    </div>
  );
}

// ─── Trail View ─────────────────────────────────────────────

function TrailView({ trail, selectedNode, onSelectNode }: {
  trail: TrailPath;
  selectedNode: TrailNode | null;
  onSelectNode: (n: TrailNode | null) => void;
}) {
  // Sort nodes in causal order (directives first, verifications last)
  const typeOrder = ["directive", "interpretation", "constraint", "decision", "implementation", "verification"];
  const sorted = [...trail.nodes].sort((a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type));

  return (
    <div>
      {/* Stats bar */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        {Object.entries(
          trail.nodes.reduce((acc, n) => { acc[n.type] = (acc[n.type] ?? 0) + 1; return acc; }, {} as Record<string, number>)
        ).map(([type, count]) => (
          <div key={type} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "4px 12px", borderRadius: 6,
            background: NODE_COLORS[type]?.bg ?? "#F1EFE8",
            border: `1px solid ${NODE_COLORS[type]?.border ?? "#D3D1C7"}20`,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: NODE_COLORS[type]?.badge ?? "#888" }} />
            <span style={{ fontSize: 12, fontWeight: 500, color: NODE_COLORS[type]?.text ?? "#444" }}>
              {count} {type}{count > 1 ? "s" : ""}
            </span>
          </div>
        ))}
        <div style={{ marginLeft: "auto", fontSize: 12, color: "#888780", alignSelf: "center" }}>
          Depth: {trail.depth} | {trail.edges.length} edges
        </div>
      </div>

      {/* Trail timeline */}
      <div style={{ position: "relative" }}>
        {/* Vertical line */}
        <div style={{
          position: "absolute", left: 19, top: 0, bottom: 0,
          width: 2, background: "#E8E6DF", borderRadius: 1,
        }} />

        {sorted.map((node, i) => (
          <TrailNodeCard
            key={node.id}
            node={node}
            edges={trail.edges.filter(e => e.fromNode === node.id || e.toNode === node.id)}
            isSelected={selectedNode?.id === node.id}
            onClick={() => onSelectNode(selectedNode?.id === node.id ? null : node)}
            index={i}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Trail Node Card ────────────────────────────────────────

function TrailNodeCard({ node, edges, isSelected, onClick, index }: {
  node: TrailNode;
  edges: TrailEdge[];
  isSelected: boolean;
  onClick: () => void;
  index: number;
}) {
  const colors = NODE_COLORS[node.type] ?? NODE_COLORS.directive;

  return (
    <div
      onClick={onClick}
      style={{
        position: "relative",
        marginBottom: 16,
        paddingLeft: 48,
        cursor: "pointer",
        animation: `fadeSlideIn 0.3s ease-out ${index * 0.05}s both`,
      }}
    >
      {/* Timeline dot */}
      <div style={{
        position: "absolute", left: 12, top: 16,
        width: 16, height: 16, borderRadius: "50%",
        background: colors.badge, border: "3px solid #FAFAF8",
        zIndex: 1, transition: "transform 0.15s",
        transform: isSelected ? "scale(1.3)" : "scale(1)",
      }} />

      {/* Card */}
      <div style={{
        background: "#fff",
        border: `1px solid ${isSelected ? colors.border : "#E8E6DF"}`,
        borderRadius: 10,
        padding: "14px 18px",
        transition: "all 0.15s",
        boxShadow: isSelected ? `0 2px 12px ${colors.border}15` : "0 1px 3px rgba(0,0,0,0.03)",
      }}>
        {/* Type badge + timestamp */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.06em", color: colors.text,
            background: colors.bg, padding: "2px 8px", borderRadius: 4,
          }}>{node.type}</span>
          {node.confidence !== undefined && (
            <span style={{ fontSize: 11, color: "#888780" }}>
              {Math.round(node.confidence * 100)}% confidence
            </span>
          )}
          <span style={{ fontSize: 11, color: "#B4B2A9", marginLeft: "auto" }}>
            {new Date(node.timestamp).toLocaleTimeString()}
          </span>
        </div>

        {/* Content by type */}
        {node.type === "directive" && (
          <div>
            <p style={{ fontSize: 15, fontWeight: 500, color: "#2C2C2A", lineHeight: 1.5, margin: 0 }}>
              "{node.text}"
            </p>
            <p style={{ fontSize: 12, color: "#888780", marginTop: 4 }}>by {node.author}</p>
          </div>
        )}

        {node.type === "interpretation" && (
          <div>
            <p style={{ fontSize: 14, color: "#444441", lineHeight: 1.6, margin: 0 }}>{node.text}</p>
            <p style={{ fontSize: 11, color: "#888780", marginTop: 6 }}>
              {node.agentId} / {node.modelId}
            </p>
          </div>
        )}

        {node.type === "decision" && (
          <div>
            <p style={{ fontSize: 14, fontWeight: 500, color: "#2C2C2A", margin: "0 0 6px" }}>
              Chose: {node.chosen}
            </p>
            <p style={{ fontSize: 13, color: "#5F5E5A", lineHeight: 1.5, margin: "0 0 8px", fontStyle: "italic" }}>
              {node.rationale}
            </p>
            {node.alternatives && node.alternatives.length > 0 && isSelected && (
              <div style={{ borderTop: "1px solid #F1EFE8", paddingTop: 8, marginTop: 4 }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: "#888780", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 4px" }}>
                  Rejected alternatives
                </p>
                {node.alternatives.map((alt, i) => (
                  <div key={i} style={{ padding: "4px 0", fontSize: 13 }}>
                    <span style={{ color: "#888780", textDecoration: "line-through" }}>{alt.description}</span>
                    {alt.rejectionReason && (
                      <span style={{ color: "#B4B2A9", marginLeft: 8 }}> - {alt.rejectionReason}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {node.domainTags && node.domainTags.length > 0 && (
              <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
                {node.domainTags.map(tag => (
                  <span key={tag} style={{
                    fontSize: 10, padding: "1px 6px", borderRadius: 3,
                    background: "#F1EFE8", color: "#5F5E5A",
                  }}>{tag}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {node.type === "constraint" && (
          <div>
            <p style={{ fontSize: 14, color: "#444441", lineHeight: 1.5, margin: 0 }}>{node.text}</p>
            <p style={{ fontSize: 11, color: "#888780", marginTop: 4 }}>Source: {node.source}</p>
          </div>
        )}

        {node.type === "implementation" && (
          <div>
            <p style={{ fontSize: 14, fontWeight: 500, color: "#2C2C2A", margin: "0 0 6px" }}>
              <span style={{ color: "#639922" }}>+{node.linesAdded}</span>
              {" / "}
              <span style={{ color: "#A32D2D" }}>-{node.linesRemoved}</span>
              {" lines"}
              {node.commitSha && <span style={{ color: "#B4B2A9", marginLeft: 8 }}>({node.commitSha?.slice(0, 8)})</span>}
            </p>
            {node.fileChanges && isSelected && (
              <div style={{ marginTop: 4 }}>
                {node.fileChanges.map((fc, i) => (
                  <div key={i} style={{
                    fontSize: 12, fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    padding: "2px 0", color: "#5F5E5A",
                  }}>
                    <span style={{ color: fc.changeType === "added" ? "#639922" : fc.changeType === "deleted" ? "#A32D2D" : "#854F0B", marginRight: 6 }}>
                      {fc.changeType === "added" ? "A" : fc.changeType === "deleted" ? "D" : "M"}
                    </span>
                    {fc.path}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {node.type === "verification" && (
          <div>
            <p style={{ fontSize: 14, color: "#2C2C2A", margin: 0 }}>
              <span style={{
                display: "inline-block", width: 18, height: 18, borderRadius: "50%",
                background: node.result === "pass" ? "#639922" : "#A32D2D",
                color: "#fff", fontSize: 11, fontWeight: 700,
                textAlign: "center", lineHeight: "18px", marginRight: 6,
                verticalAlign: "middle",
              }}>
                {node.result === "pass" ? "\u2713" : "\u2717"}
              </span>
              {node.verificationType}: {node.result}
            </p>
            {node.details && <p style={{ fontSize: 12, color: "#888780", marginTop: 4 }}>{node.details}</p>}
          </div>
        )}

        {/* Edge indicators (collapsed) */}
        {!isSelected && edges.length > 0 && (
          <div style={{ fontSize: 11, color: "#B4B2A9", marginTop: 6 }}>
            {edges.length} connection{edges.length > 1 ? "s" : ""}
          </div>
        )}
      </div>

      {/* CSS animation */}
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ─── Graph View ─────────────────────────────────────────────

function GraphView({ trail, onSelectNode }: {
  trail: TrailPath;
  onSelectNode: (n: TrailNode) => void;
}) {
  // Simple force-directed-ish layout using fixed positions per type
  const typeX: Record<string, number> = {
    directive: 400, interpretation: 400,
    constraint: 200, decision: 400,
    implementation: 400, verification: 600,
  };
  const typeY: Record<string, number> = {
    directive: 40, interpretation: 120,
    constraint: 200, decision: 200,
    implementation: 320, verification: 320,
  };

  // Offset nodes of the same type
  const typeCounts: Record<string, number> = {};
  const positions = trail.nodes.map(n => {
    const count = typeCounts[n.type] ?? 0;
    typeCounts[n.type] = count + 1;
    return {
      node: n,
      x: (typeX[n.type] ?? 400) + count * 180,
      y: (typeY[n.type] ?? 200) + (count % 2) * 30,
    };
  });

  const posMap = new Map(positions.map(p => [p.node.id, p]));

  // Compute viewBox to fit all nodes
  const maxX = Math.max(...positions.map(p => p.x)) + 100;
  const maxY = Math.max(...positions.map(p => p.y)) + 80;

  return (
    <div>
      <p style={{ fontSize: 13, color: "#888780", marginBottom: 16 }}>
        Session graph - click any node to see details. Edges show causal relationships.
      </p>
      <div style={{ background: "#fff", border: "1px solid #E8E6DF", borderRadius: 10, overflow: "hidden" }}>
        <svg viewBox={`0 0 ${maxX} ${maxY}`} width="100%" style={{ display: "block" }}>
          <defs>
            <marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M2 1L8 5L2 9" fill="none" stroke="#B4B2A9" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round"/>
            </marker>
          </defs>

          {/* Edges */}
          {trail.edges.map((e, i) => {
            const from = posMap.get(e.fromNode);
            const to = posMap.get(e.toNode);
            if (!from || !to) return null;
            return (
              <line key={i}
                x1={from.x} y1={from.y + 16}
                x2={to.x} y2={to.y + 16}
                stroke="#D3D1C7" strokeWidth={1}
                markerEnd="url(#arrowhead)"
              />
            );
          })}

          {/* Nodes */}
          {positions.map(({ node, x, y }) => {
            const colors = NODE_COLORS[node.type] ?? NODE_COLORS.directive;
            const label = node.type === "decision" ? (node.chosen?.slice(0, 25) ?? "")
              : node.type === "directive" ? (node.text?.slice(0, 25) ?? "")
              : node.type;
            return (
              <g key={node.id} onClick={() => onSelectNode(node)} style={{ cursor: "pointer" }}>
                <rect x={x - 70} y={y} width={140} height={32} rx={6}
                  fill={colors.bg} stroke={colors.border} strokeWidth={1} />
                <text x={x} y={y + 12} textAnchor="middle" dominantBaseline="central"
                  fontSize={10} fontWeight={600} fill={colors.text}
                  style={{ textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
                  {node.type}
                </text>
                <text x={x} y={y + 24} textAnchor="middle" dominantBaseline="central"
                  fontSize={9} fill={colors.text} opacity={0.7}>
                  {label.length > 25 ? label.slice(0, 22) + "..." : label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ─── Search View ────────────────────────────────────────────

function SearchView({ query, onQueryChange }: {
  query: string;
  onQueryChange: (q: string) => void;
}) {
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <input
          type="text"
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          placeholder="Search decision trails... (e.g. 'Elasticsearch', 'authentication')"
          style={{
            width: "100%", padding: "12px 16px", fontSize: 14,
            border: "1px solid #E8E6DF", borderRadius: 8,
            background: "#fff", outline: "none", fontFamily: "inherit",
            boxSizing: "border-box",
          }}
        />
      </div>
      <div style={{
        textAlign: "center", padding: "60px 24px",
        color: "#B4B2A9", fontSize: 14,
      }}>
        {query.length === 0
          ? "Enter a search term to find decisions, constraints, and directives across all trails."
          : "Search requires the Trail API to be running (port 3200). In demo mode, explore the trail view instead."
        }
      </div>
    </div>
  );
}
