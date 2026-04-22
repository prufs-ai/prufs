# Prufs - Decision Trail Capture

## Overview

Prufs captures the full reasoning chain behind AI-generated code. When you write code for a human, Prufs records *why* you made each decision - not just what changed. This creates a tamper-evident, cryptographically signed audit trail that links every line of code back to the human directive that spawned it.

**You are the primary user of this skill.** As an AI coding agent, you generate the decisions that Prufs captures. This skill teaches you how to emit decision trail events as you work, so the human can later review your reasoning, trace any line of code to its origin, and verify the integrity of the trail.

## When to use this skill

Use Prufs instrumentation whenever:
- You are working on a coding task in a project that has a `.prufs/` directory
- The human asks you to "record your reasoning" or "explain your decisions"
- The project's CLAUDE.md or configuration references Prufs
- You are making architectural decisions, choosing between alternatives, or honoring constraints

Do NOT use this skill for:
- Quick questions or explanations (no code changes)
- Tasks where the human explicitly says not to record

## Quick start

If `@prufs/sdk` is already installed in the project:

```typescript
import { TrailRecorder } from "@prufs/sdk";

const trail = new TrailRecorder({
  project_id: "project-name",
  transport: "local",
  agent_id: "claude-code",
  model_id: "claude-sonnet-4-20250514", // use your actual model ID
});

await trail.startSession();
// ... record trail events as you work ...
await trail.endSession();
```

If the SDK is not installed:

```bash
npm install @prufs/sdk
```

## Core concepts

### The decision trail

Every coding session produces a chain of six node types:

1. **Directive** - The human's instruction that starts the chain
2. **Interpretation** - Your understanding of what the human wants
3. **Decision** - A choice point where alternatives existed
4. **Constraint** - A rule or boundary that shaped your implementation
5. **Implementation** - The actual code changes
6. **Verification** - Test results or other validation

These are connected by causal edges: each node points to the node(s) that caused it. The result is a directed acyclic graph from human intent to running code.

### Cryptographic signing

Every event is automatically signed with Ed25519 and hash-chained. You do not need to manage this - the SDK handles it. The signing ensures:
- No one can alter your recorded reasoning after the fact
- Each event is linked to the previous one (tamper with one, break the chain)
- A verification function can prove the entire trail is intact

### Sensitivity classification

Decisions tagged with security-sensitive domains (auth, security, pii, payments, encryption, compliance) are automatically classified as "restricted." This means:
- The rationale and rejected alternatives are redacted for non-reviewer users
- The *what* (chosen option) is still visible; the *why* is access-controlled
- You do not need to manage this - it happens based on domain tags

## Recording trail events

### Step 1: Record the directive

When the human gives you a task, record it as a directive. Use their exact words.

```typescript
const directiveId = await trail.directive(
  "Add user search to the admin panel with typeahead",
  "wade" // human's name if known, otherwise "human"
);
```

### Step 2: Record your interpretation

Before you start coding, record how you understand the task. This is where misunderstandings become visible in the trail.

```typescript
const interpId = await trail.interpretation(
  directiveId,
  "Implement a GET /api/admin/users/search endpoint with query parameter, " +
  "returning paginated results. Build a React component with debounced " +
  "typeahead using the existing Elasticsearch index.",
  { confidence: 0.9 } // how confident you are in your interpretation
);
```

**Confidence guidance:**
- 0.95+ : The directive is unambiguous and you've done this before
- 0.8-0.95 : Clear intent but some implementation details are your judgment call
- 0.6-0.8 : Ambiguous directive, you're making assumptions
- Below 0.6 : Ask the human for clarification instead of guessing

### Step 3: Record constraints

As you analyze the codebase and discover rules or boundaries, record them.

```typescript
// Constraint from project configuration
const c1 = await trail.constraint(
  "Must use existing API authentication middleware for all routes",
  { source: "project_rule", scope: "api" }
);

// Constraint you inferred from codebase analysis
const c2 = await trail.constraint(
  "Cannot modify the User model schema without a migration",
  { source: "agent_inferred", scope: "database" }
);

// Constraint the human stated explicitly
const c3 = await trail.constraint(
  "Don't use any new npm dependencies",
  { source: "human_stated" }
);
```

### Step 4: Record decisions

**This is the most important step.** Whenever you choose between alternatives, record the decision with your reasoning.

```typescript
const decisionId = await trail.decision(interpId, {
  chosen: "Use Elasticsearch for search backend",
  alternatives: [
    {
      description: "PostgreSQL full-text search with pg_trgm",
      rejection_reason: "No existing full-text index; would require migration",
    },
    {
      description: "In-memory search with Fuse.js on the frontend",
      rejection_reason: "Admin has 50K+ users; loading all into memory is not feasible",
    },
  ],
  rationale:
    "Elasticsearch index on users collection already exists. " +
    "Supports fuzzy matching and relevance scoring out of the box. " +
    "Reusing existing infrastructure avoids new operational burden.",
  domain_tags: ["search", "database", "elasticsearch", "performance"],
  confidence: 0.95,
});

// Link constraints that shaped this decision
await trail.edge(decisionId, c1, "constrained_by");
```

**What counts as a decision:**
- Choosing a library, framework, or tool
- Choosing an architectural pattern (REST vs GraphQL, SQL vs NoSQL)
- Choosing a data structure or algorithm
- Choosing to refactor vs extend existing code
- Choosing how to handle an edge case
- Choosing a testing strategy
- Anything where you considered at least two options

**Domain tags to use** (these affect sensitivity classification):
- `auth`, `authentication`, `authorization` - auto-restricted
- `security`, `encryption`, `secrets` - auto-restricted
- `pii`, `privacy`, `compliance` - auto-restricted
- `payments`, `billing`, `financial` - auto-restricted
- `database`, `api`, `ui`, `performance`, `testing`, `infrastructure`, `search`, `architecture` - public

### Step 5: Record the implementation

After you've written the code, record what files changed.

```typescript
const implId = await trail.implementation(
  [decisionId], // parent decision(s) that led to this code
  {
    file_changes: [
      { path: "src/api/search.ts", change_type: "added", lines_added: 67, lines_removed: 0 },
      { path: "src/components/SearchBar.tsx", change_type: "added", lines_added: 120, lines_removed: 0 },
      { path: "src/api/routes.ts", change_type: "modified", lines_added: 5, lines_removed: 1 },
    ],
    commit_sha: "abc123def", // if you know it
    test_results: {
      passed: 12,
      failed: 0,
      skipped: 1,
      duration_ms: 3400,
    },
  }
);
```

### Step 6: Record verification

If tests pass (or fail), record that.

```typescript
await trail.verification(implId, {
  verification_type: "test", // or "review", "ci_check", "production_metric"
  result: "pass", // or "fail", "partial"
  details: "All 12 tests passed. Coverage: 94% on new code.",
});
```

## Using the SessionObserver (automatic mode)

For simpler instrumentation, the SessionObserver can auto-detect decisions and constraints from your natural language output:

```typescript
import { SessionObserver } from "@prufs/sdk";

const observer = new SessionObserver({
  project_id: "my-project",
  transport: "local",
  agent_id: "claude-code",
  model_id: "claude-sonnet-4-20250514",
  detect_decisions: true,    // auto-detect from text patterns
  detect_constraints: true,  // auto-detect from text patterns
});

// Feed agent lifecycle events
await observer.onEvent({ type: "session_start", timestamp: now(), data: {} });
await observer.onEvent({ type: "user_prompt", timestamp: now(), data: { text: "Add search feature" } });
await observer.onEvent({ type: "agent_plan", timestamp: now(), data: { text: "I'll use Elasticsearch instead of PostgreSQL FTS because the index already exists." } });
// ... the observer auto-extracts the decision from that text
await observer.onEvent({ type: "file_change", timestamp: now(), data: { path: "src/search.ts", change_type: "added", lines_added: 80, lines_removed: 0 } });
await observer.onEvent({ type: "session_end", timestamp: now(), data: {} });
```

The auto-detection recognizes patterns like:
- "I'll use X instead of Y because Z"
- "I chose X over Y"
- "We must use/follow/maintain X" (constraint)
- "Cannot/shouldn't X" (constraint)
- "Per the project guidelines, X" (project rule constraint)

**Prefer explicit recording (Step 1-6 above) over auto-detection for important decisions.** Auto-detection catches common patterns but misses nuance. For architectural choices, security decisions, or trade-offs the human will care about, use the explicit API.

## CLI commands

```bash
# Check trail status
npx prufs status

# Pretty-print all recorded events
npx prufs inspect

# Replay a Claude Code conversation transcript into a trail
npx prufs replay path/to/conversation.jsonl

# Trace a line of code to its directive (requires linker setup)
npx prufs trace src/api/search.ts:45

# Sync local events to the ingestion service
npx prufs sync --endpoint http://localhost:3100
```

## Verifying trail integrity

```typescript
import { verifyChain, loadOrCreateKeyPair, LocalTransport } from "@prufs/sdk";

const transport = new LocalTransport(".prufs/events.db");
const events = transport.readAll();
const keyPair = loadOrCreateKeyPair(".prufs/signing-key.pem");

const result = verifyChain(events, keyPair.publicKey);
console.log(result.valid);       // true if no tampering
console.log(result.chainBreaks); // indices where chain broke
```

## Best practices for agents

1. **Record decisions as you make them, not after.** If you record all decisions at the end, you'll forget alternatives you considered and rejected. Record each decision at the moment you make it.

2. **Always record at least two alternatives.** If you can't name an alternative, you haven't made a decision - you've followed an obvious path. That's fine, but it's not worth recording as a Decision node.

3. **Be honest about confidence.** A 0.95 confidence that turns out wrong is worse than a 0.7 that signals uncertainty. The human reads confidence scores during review-via-trail.

4. **Tag domains accurately.** Domain tags drive sensitivity classification. Tagging an auth decision as "api" bypasses the RBAC protections. When in doubt, tag more restrictively.

5. **Record constraints you discover, not just ones you're told.** When you read the codebase and find a pattern you must follow, that's an agent_inferred constraint. Record it. These are often the most valuable trail nodes because they explain implicit knowledge.

6. **One directive per task.** Don't combine multiple human requests into one directive. If the human gives you three tasks, record three directives with separate causal chains.

7. **Link constraints to decisions.** A constraint without a link to the decision it shaped is an orphan. Use `trail.edge(decisionId, constraintId, "constrained_by")` to make the relationship explicit.

## Project structure

```
.prufs/
  events.ndjson          # Local event log (append-only, hash-chained)
  signing-key.pem        # Ed25519 private key (owner-read-only, 0600)
  signing-key.pub        # Ed25519 public key (shareable)
  mappings.json          # Code-to-trail mappings (generated by linker)
```

The `.prufs/` directory should be in `.gitignore` for the private key but the public key and mappings can be committed if the team wants shared trail verification.

## Integration with review-via-trail

When your code is ready for review, the trail can be linked to a GitHub PR:

```typescript
import { generatePRComment } from "@prufs/visualizer/src/components/ReviewBridge";

const markdown = generatePRComment(trail, {
  visualizerUrl: "http://localhost:3300",
  detailed: true,
});
// Post this as a PR comment or include in the PR description
```

The reviewer then walks the decision trail instead of reading a diff: they see your directive, your interpretation, your key decisions with alternatives, and your implementation - in that order. This is fundamentally better than showing them 23 changed files and hoping they reverse-engineer your reasoning.
