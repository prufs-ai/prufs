#!/usr/bin/env node
/**
 * Prufs Demo - Record a Decision Trail
 *
 * This script simulates a real agentic coding session and records
 * the full decision trail. Run it to see what a captured trail
 * looks like.
 *
 * Usage:
 *   # Local mode (SQLite - no Neo4j needed):
 *   npx tsx scripts/demo-trail.ts
 *
 *   # HTTP mode (requires ingestion service + Neo4j):
 *   PRUFS_TRANSPORT=http://localhost:3100 npx tsx scripts/demo-trail.ts
 */

import { TrailRecorder } from "../packages/sdk/src/index.js";

async function main() {
  const transport = process.env.PRUFS_TRANSPORT ?? "local";

  console.log("\n=== Prufs Demo: Recording a Decision Trail ===\n");
  console.log(`Transport: ${transport}`);
  console.log();

  const trail = new TrailRecorder({
    project_id: "demo-admin-panel",
    transport,
    agent_id: "claude-code",
    model_id: "claude-sonnet-4-20250514",
    local_db_path: ".prufs/demo-events.db",
  });

  // --- Start session ---
  const sessionId = await trail.startSession();
  console.log(`Session started: ${sessionId}\n`);

  // --- Human issues a directive ---
  const directiveId = await trail.directive(
    "Add user search to the admin panel with typeahead suggestions",
    "wade"
  );
  console.log(`1. Directive recorded: "${directiveId.slice(0, 8)}..."`);
  console.log(`   "Add user search to the admin panel with typeahead suggestions"\n`);

  // --- Agent interprets the directive ---
  const interpId = await trail.interpretation(
    directiveId,
    "Implement a search endpoint at GET /api/admin/users/search with " +
      "query parameter, returning paginated results. Build a React " +
      "component with debounced typeahead using the existing " +
      "Elasticsearch index on the users collection.",
    { confidence: 0.92 }
  );
  console.log(`2. Interpretation recorded: "${interpId.slice(0, 8)}..."`);
  console.log(`   Confidence: 0.92\n`);

  // --- Agent encounters a constraint ---
  const constraintId = await trail.constraint(
    "Must use existing API authentication middleware - no new auth patterns allowed",
    {
      source: "project_rule",
      scope: "api",
    }
  );
  console.log(`3. Constraint recorded: "${constraintId.slice(0, 8)}..."`);
  console.log(`   Source: project_rule\n`);

  // --- Agent makes a key decision ---
  const decisionId = await trail.decision(interpId, {
    chosen: "Use Elasticsearch for search backend",
    alternatives: [
      {
        description: "PostgreSQL full-text search with pg_trgm",
        rejection_reason:
          "No existing full-text index on users table; would require migration and index build time",
      },
      {
        description: "In-memory search with Fuse.js on the frontend",
        rejection_reason:
          "Admin panel has 50K+ users; loading all into browser memory is not feasible",
      },
    ],
    rationale:
      "Elasticsearch index on users collection already exists (created for customer-facing search). " +
      "Supports fuzzy matching and relevance scoring out of the box. " +
      "Reusing existing infrastructure avoids new operational burden.",
    domain_tags: ["search", "database", "elasticsearch", "performance"],
    confidence: 0.95,
  });
  console.log(`4. Decision recorded: "${decisionId.slice(0, 8)}..."`);
  console.log(`   Chosen: Elasticsearch (over PostgreSQL FTS and Fuse.js)`);
  console.log(`   Confidence: 0.95\n`);

  // Link the constraint to the decision
  await trail.edge(decisionId, constraintId, "constrained_by");
  console.log(`   Linked constraint -> decision\n`);

  // --- Second decision: UI pattern ---
  const uiDecisionId = await trail.decision(interpId, {
    chosen: "Debounced input with dropdown results list",
    alternatives: [
      {
        description: "Full-page search results view",
        rejection_reason:
          "Disrupts admin workflow; typeahead keeps user in context",
      },
    ],
    rationale:
      "Typeahead with 300ms debounce balances responsiveness with API efficiency. " +
      "Dropdown overlay keeps the admin panel layout stable.",
    domain_tags: ["ui", "react", "search", "ux"],
    confidence: 0.88,
  });
  console.log(`5. UI Decision recorded: "${uiDecisionId.slice(0, 8)}..."`);
  console.log(`   Chosen: Debounced typeahead dropdown\n`);

  // --- Implementation ---
  const implId = await trail.implementation(
    [decisionId, uiDecisionId],
    {
      file_changes: [
        { path: "src/api/routes/admin/users.ts", change_type: "modified", lines_added: 45, lines_removed: 2 },
        { path: "src/api/services/user-search.ts", change_type: "added", lines_added: 67, lines_removed: 0 },
        { path: "src/components/admin/UserSearch.tsx", change_type: "added", lines_added: 120, lines_removed: 0 },
        { path: "src/components/admin/UserSearch.module.css", change_type: "added", lines_added: 48, lines_removed: 0 },
        { path: "src/hooks/useDebounce.ts", change_type: "added", lines_added: 18, lines_removed: 0 },
        { path: "tests/api/user-search.test.ts", change_type: "added", lines_added: 85, lines_removed: 0 },
        { path: "tests/components/UserSearch.test.tsx", change_type: "added", lines_added: 62, lines_removed: 0 },
      ],
      commit_sha: "a1b2c3d4e5f6",
      test_results: {
        passed: 12,
        failed: 0,
        skipped: 1,
        duration_ms: 3400,
      },
    }
  );
  console.log(`6. Implementation recorded: "${implId.slice(0, 8)}..."`);
  console.log(`   7 files changed, 445 lines added, 2 removed`);
  console.log(`   Tests: 12 passed, 0 failed\n`);

  // --- Verification ---
  const verifId = await trail.verification(implId, {
    verification_type: "test",
    result: "pass",
    details: "All 12 tests passed. Coverage: 94% on new code.",
  });
  console.log(`7. Verification recorded: "${verifId.slice(0, 8)}..."`);
  console.log(`   Result: pass\n`);

  // --- End session ---
  await trail.endSession();
  console.log("Session ended.\n");

  // --- Summary ---
  console.log("=== Trail Summary ===");
  console.log("Nodes created: 7 (1 directive, 1 interpretation, 2 decisions,");
  console.log("                   1 constraint, 1 implementation, 1 verification)");
  console.log("Edges created: 6 (4 caused_by, 1 constrained_by, 1 verified_by)");
  console.log();
  console.log("The full causal chain:");
  console.log("  Human directive");
  console.log("    -> Agent interpretation");
  console.log("       -> Decision: Elasticsearch (constrained by: auth middleware rule)");
  console.log("       -> Decision: Debounced typeahead");
  console.log("          -> Implementation: 7 files, 445 lines");
  console.log("             -> Verification: all tests pass");
  console.log();

  if (transport === "local") {
    console.log("Events stored in: .prufs/demo-events.db");
    console.log("Run with NEO4J to see the graph visualization.\n");
  }
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
