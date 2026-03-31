/**
 * Phase 2 Tests - Decision detection, constraint detection, and SessionObserver
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { unlinkSync, existsSync } from "node:fs";
import {
  detectDecisions,
  detectConstraints,
  SessionObserver,
} from "./session-observer.js";
import { LocalTransport } from "../transport-local.js";
import type { TrailNode, TrailEdge, TrailEvent } from "../types.js";

// ---------------------------------------------------------------------------
// Decision detection
// ---------------------------------------------------------------------------

describe("detectDecisions", () => {
  it("detects 'use X instead of Y because Z' pattern", () => {
    const text =
      "I'll use Elasticsearch instead of PostgreSQL full-text search because the index already exists.";
    const decisions = detectDecisions(text);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].chosen, "Elasticsearch");
    assert.equal(decisions[0].alternatives[0].description, "PostgreSQL full-text search");
    assert.ok(decisions[0].rationale.includes("index already exists"));
    assert.ok(decisions[0].confidence >= 0.7);
  });

  it("detects 'chose X over Y' pattern", () => {
    const text = "I chose Redis over Memcached because Redis supports sorted sets.";
    const decisions = detectDecisions(text);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].chosen, "Redis");
    assert.equal(decisions[0].alternatives[0].description, "Memcached");
  });

  it("extracts domain tags from surrounding text", () => {
    const text =
      "For the API endpoint, I'll use GraphQL instead of REST because the frontend needs flexible queries.";
    const decisions = detectDecisions(text);
    assert.ok(decisions.length >= 1);
    const tags = decisions[0].domain_tags;
    assert.ok(tags.includes("api"), `Expected 'api' tag, got: ${tags}`);
  });

  it("returns empty array for text without decisions", () => {
    const text = "I will now implement the user search feature as requested.";
    const decisions = detectDecisions(text);
    assert.equal(decisions.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Constraint detection
// ---------------------------------------------------------------------------

describe("detectConstraints", () => {
  it("detects 'must use' constraints", () => {
    const text =
      "We must use the existing authentication middleware for all API routes.";
    const constraints = detectConstraints(text);
    assert.ok(constraints.length >= 1);
    assert.ok(
      constraints.some((c: {text: string; source: string}) => c.text.includes("existing authentication middleware"))
    );
  });

  it("detects 'cannot' constraints", () => {
    const text =
      "We cannot modify the database schema without a migration.";
    const constraints = detectConstraints(text);
    assert.ok(constraints.length >= 1);
    assert.ok(constraints[0].source === "agent_inferred");
  });

  it("detects project rule constraints", () => {
    const text =
      "Per the project guidelines, all components must follow the atomic design pattern.";
    const constraints = detectConstraints(text);
    assert.ok(constraints.length >= 1);
    assert.ok(constraints.some((c: {text: string; source: string}) => c.source === "project_rule"));
  });

  it("returns empty for text without constraints", () => {
    const text = "The function takes a string parameter and returns a boolean.";
    const constraints = detectConstraints(text);
    assert.equal(constraints.length, 0);
  });
});

// ---------------------------------------------------------------------------
// SessionObserver integration
// ---------------------------------------------------------------------------

const TEST_DB = ".prufs/observer-test.ndjson";

describe("SessionObserver", () => {
  before(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });
  after(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  it("processes a simulated agent session into a valid trail", async () => {
    const observer = new SessionObserver({
      project_id: "test-observer",
      transport: "local",
      agent_id: "test-agent",
      model_id: "test-model",
      local_db_path: TEST_DB.replace(".ndjson", ".db"),
    });

    const ts = () => new Date().toISOString();

    // Simulate a full agent session
    await observer.onEvent({ type: "session_start", timestamp: ts(), data: {} });

    await observer.onEvent({
      type: "user_prompt",
      timestamp: ts(),
      data: { text: "Add a search feature to the admin panel", author: "wade" },
    });

    await observer.onEvent({
      type: "agent_plan",
      timestamp: ts(),
      data: {
        text: "I will implement a search endpoint. We must use the existing auth middleware for all routes.",
        confidence: 0.9,
      },
    });

    await observer.onEvent({
      type: "agent_reasoning",
      timestamp: ts(),
      data: {
        text: "I'll use Elasticsearch instead of PostgreSQL FTS because the index already exists.",
      },
    });

    await observer.onEvent({
      type: "file_change",
      timestamp: ts(),
      data: {
        path: "src/api/search.ts",
        change_type: "added",
        lines_added: 80,
        lines_removed: 0,
      },
    });

    await observer.onEvent({
      type: "file_change",
      timestamp: ts(),
      data: {
        path: "src/components/SearchBar.tsx",
        change_type: "added",
        lines_added: 45,
        lines_removed: 0,
      },
    });

    await observer.onEvent({
      type: "test_result",
      timestamp: ts(),
      data: { passed: 5, failed: 0, skipped: 0, duration_ms: 1200 },
    });

    await observer.onEvent({ type: "session_end", timestamp: ts(), data: {} });

    // Read back and validate
    const transport = new LocalTransport(TEST_DB.replace(".ndjson", ".db"));
    const events = transport.readAll();

    const nodes = events
      .filter((e: TrailEvent) => e.event_type === "node_created")
      .map((e) => e.payload as TrailNode);
    const edges = events
      .filter((e: TrailEvent) => e.event_type === "edge_created")
      .map((e) => e.payload as TrailEdge);

    // Should have: directive, interpretation, decision (auto-detected),
    // constraint (auto-detected), implementation, verification
    assert.ok(
      nodes.some((n: TrailNode) => n.type === "directive"),
      "Missing auto-generated directive"
    );
    assert.ok(
      nodes.some((n: TrailNode) => n.type === "interpretation"),
      "Missing auto-generated interpretation"
    );
    assert.ok(
      nodes.some((n: TrailNode) => n.type === "implementation"),
      "Missing auto-generated implementation"
    );
    assert.ok(
      nodes.some((n: TrailNode) => n.type === "verification"),
      "Missing auto-generated verification"
    );

    // Check the implementation node has the file changes
    const impl = nodes.find((n: TrailNode) => n.type === "implementation") as unknown as {
      file_changes: string;
      lines_added: number;
    };
    assert.ok(impl, "Implementation node should exist");
    assert.equal(impl.lines_added, 125, "Should have 80 + 45 = 125 lines added");

    // Check causal edges exist
    assert.ok(edges.length >= 2, `Expected at least 2 edges, got ${edges.length}`);

    // Verify at least one caused_by edge
    assert.ok(
      edges.some((e: TrailEdge) => e.type === "caused_by"),
      "Should have at least one caused_by edge"
    );

    console.log(`\nSessionObserver test passed:`);
    console.log(`  Nodes: ${nodes.length} (${nodes.map((n: TrailNode) => n.type).join(", ")})`);
    console.log(`  Edges: ${edges.length}`);
  });
});
