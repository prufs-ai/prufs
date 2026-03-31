/**
 * SDK Integration Test
 *
 * Verifies that the TrailRecorder produces a valid, complete decision
 * trail with correct causal relationships.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { unlinkSync, existsSync } from "node:fs";
import { TrailRecorder, LocalTransport } from "./index.js";
import type { TrailEvent, TrailNode, TrailEdge } from "./index.js";

const TEST_DB = ".prufs/test-events.ndjson";

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

describe("TrailRecorder", () => {
  before(cleanup);
  after(cleanup);

  it("records a complete decision trail with valid causal chain", async () => {
    const recorder = new TrailRecorder({
      project_id: "test-project",
      transport: "local",
      agent_id: "test-agent",
      model_id: "test-model-v1",
      local_db_path: TEST_DB.replace(".ndjson", ".db"), // transport converts to .ndjson
    });

    await recorder.startSession();

    // Build a trail
    const dId = await recorder.directive("Implement feature X", "tester");
    const iId = await recorder.interpretation(dId, "Will implement X using pattern Y", {
      confidence: 0.9,
    });
    const cId = await recorder.constraint("Must follow existing patterns", {
      source: "project_rule",
    });
    const decId = await recorder.decision(iId, {
      chosen: "Pattern Y",
      alternatives: [{ description: "Pattern Z", rejection_reason: "Too complex" }],
      rationale: "Y is simpler and matches existing code",
      domain_tags: ["architecture"],
      confidence: 0.85,
    });
    await recorder.edge(decId, cId, "constrained_by");

    const implId = await recorder.implementation([decId], {
      file_changes: [
        { path: "src/feature.ts", change_type: "added", lines_added: 50, lines_removed: 0 },
      ],
      commit_sha: "abc123",
    });
    const vId = await recorder.verification(implId, {
      verification_type: "test",
      result: "pass",
      details: "All tests passed",
    });

    await recorder.endSession();

    // Read back the events
    const transport = new LocalTransport(TEST_DB.replace(".ndjson", ".db"));
    const events = transport.readAll();

    // Separate nodes and edges
    const nodes = events
      .filter((e) => e.event_type === "node_created")
      .map((e) => e.payload as TrailNode);
    const edges = events
      .filter((e) => e.event_type === "edge_created")
      .map((e) => e.payload as TrailEdge);

    // --- Assertions ---

    // 1. Correct number of nodes and edges
    assert.equal(nodes.length, 6, "Should have 6 nodes");
    assert.equal(edges.length, 5, "Should have 5 edges (4 auto + 1 manual)");

    // 2. All node types present
    const types = new Set(nodes.map((n) => n.type));
    assert.ok(types.has("directive"), "Missing directive node");
    assert.ok(types.has("interpretation"), "Missing interpretation node");
    assert.ok(types.has("decision"), "Missing decision node");
    assert.ok(types.has("constraint"), "Missing constraint node");
    assert.ok(types.has("implementation"), "Missing implementation node");
    assert.ok(types.has("verification"), "Missing verification node");

    // 3. All edges reference existing nodes
    const nodeIds = new Set(nodes.map((n) => n.id));
    for (const edge of edges) {
      assert.ok(
        nodeIds.has(edge.from_node),
        `Edge from_node ${edge.from_node} not found in nodes`
      );
      assert.ok(
        nodeIds.has(edge.to_node),
        `Edge to_node ${edge.to_node} not found in nodes`
      );
    }

    // 4. Causal chain: interpretation -> directive
    const interpToDirEdge = edges.find(
      (e) => e.from_node === iId && e.to_node === dId && e.type === "caused_by"
    );
    assert.ok(interpToDirEdge, "Missing caused_by edge: interpretation -> directive");

    // 5. Causal chain: decision -> interpretation
    const decToInterpEdge = edges.find(
      (e) => e.from_node === decId && e.to_node === iId && e.type === "caused_by"
    );
    assert.ok(decToInterpEdge, "Missing caused_by edge: decision -> interpretation");

    // 6. Constraint edge: decision -> constraint
    const constraintEdge = edges.find(
      (e) => e.from_node === decId && e.to_node === cId && e.type === "constrained_by"
    );
    assert.ok(constraintEdge, "Missing constrained_by edge: decision -> constraint");

    // 7. Implementation -> decision
    const implToDecEdge = edges.find(
      (e) => e.from_node === implId && e.to_node === decId && e.type === "caused_by"
    );
    assert.ok(implToDecEdge, "Missing caused_by edge: implementation -> decision");

    // 8. Verification -> implementation
    const verifEdge = edges.find(
      (e) => e.from_node === implId && e.to_node === vId && e.type === "verified_by"
    );
    assert.ok(verifEdge, "Missing verified_by edge: implementation -> verification");

    // 9. Decision has alternatives
    const decNode = nodes.find((n) => n.id === decId) as TrailNode & {
      alternatives: unknown[];
    };
    assert.ok(
      Array.isArray(decNode.alternatives) && decNode.alternatives.length === 1,
      "Decision should have 1 alternative"
    );

    // 10. All events share the same session_id
    const sessionIds = new Set(events.map((e) => e.session_id));
    assert.equal(sessionIds.size, 1, "All events should share one session_id");

    // 11. Session lifecycle events present
    const sessionEvents = events.filter(
      (e) => e.event_type === "session_started" || e.event_type === "session_ended"
    );
    assert.equal(sessionEvents.length, 2, "Should have session start + end");

    console.log("\nAll 11 assertions passed.");
    console.log(`  Nodes: ${nodes.length}`);
    console.log(`  Edges: ${edges.length}`);
    console.log(`  Events total: ${events.length}`);
  });

  it("throws if session not started", async () => {
    const recorder = new TrailRecorder({
      project_id: "test",
      transport: "local",
      local_db_path: ".prufs/throw-test.db",
    });

    await assert.rejects(
      () => recorder.directive("test"),
      { message: /session not started/i },
      "Should throw when recording without startSession()"
    );

    // Cleanup
    const f = ".prufs/throw-test.ndjson";
    if (existsSync(f)) unlinkSync(f);
  });
});
