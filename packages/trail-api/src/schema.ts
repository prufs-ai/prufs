/**
 * Trail API - GraphQL Schema
 *
 * Defines the full query surface for decision trail exploration.
 * Three primary query patterns:
 *   1. traceUp   - from code/implementation to root directive
 *   2. traceDown - from directive to all downstream nodes
 *   3. session   - full session graph with nodes and edges
 */

export const typeDefs = `#graphql
  scalar DateTime
  scalar JSON

  # ─── Node types ──────────────────────────────────────────────

  interface TrailNode {
    id: ID!
    type: NodeType!
    timestamp: DateTime!
    sessionId: String!
    projectId: String!
  }

  enum NodeType {
    directive
    interpretation
    decision
    constraint
    implementation
    verification
  }

  type Directive implements TrailNode {
    id: ID!
    type: NodeType!
    timestamp: DateTime!
    sessionId: String!
    projectId: String!
    text: String!
    author: String!
  }

  type Interpretation implements TrailNode {
    id: ID!
    type: NodeType!
    timestamp: DateTime!
    sessionId: String!
    projectId: String!
    text: String!
    agentId: String!
    modelId: String!
    confidence: Float!
  }

  type Alternative {
    description: String!
    rejectionReason: String
  }

  type Decision implements TrailNode {
    id: ID!
    type: NodeType!
    timestamp: DateTime!
    sessionId: String!
    projectId: String!
    chosen: String!
    alternatives: [Alternative!]!
    rationale: String!
    domainTags: [String!]!
    confidence: Float!
    """Sensitivity level - restricted decisions have redacted rationale for non-reviewers"""
    sensitivity: SensitivityLevel
  }

  enum SensitivityLevel {
    public
    internal
    restricted
  }

  type Constraint implements TrailNode {
    id: ID!
    type: NodeType!
    timestamp: DateTime!
    sessionId: String!
    projectId: String!
    text: String!
    source: ConstraintSource!
    scope: String
  }

  enum ConstraintSource {
    project_rule
    agent_inferred
    human_stated
  }

  type FileChange {
    path: String!
    changeType: String!
    linesAdded: Int!
    linesRemoved: Int!
  }

  type TestResult {
    passed: Int!
    failed: Int!
    skipped: Int!
    durationMs: Int!
  }

  type Implementation implements TrailNode {
    id: ID!
    type: NodeType!
    timestamp: DateTime!
    sessionId: String!
    projectId: String!
    fileChanges: [FileChange!]!
    commitSha: String
    linesAdded: Int!
    linesRemoved: Int!
    testResults: TestResult
  }

  type Verification implements TrailNode {
    id: ID!
    type: NodeType!
    timestamp: DateTime!
    sessionId: String!
    projectId: String!
    verificationType: String!
    result: String!
    details: String
  }

  # ─── Edge types ──────────────────────────────────────────────

  type TrailEdge {
    id: ID!
    type: EdgeType!
    fromNode: ID!
    toNode: ID!
    timestamp: DateTime!
  }

  enum EdgeType {
    caused_by
    constrained_by
    verified_by
    supersedes
  }

  # ─── Code mapping ───────────────────────────────────────────

  type CodeMapping {
    id: ID!
    implementationNodeId: ID!
    filePath: String!
    lineStart: Int!
    lineEnd: Int!
    astNodeHash: String
    repoId: String!
    commitSha: String!
  }

  # ─── Session and trail views ─────────────────────────────────

  type SessionGraph {
    sessionId: String!
    projectId: String!
    nodes: [TrailNode!]!
    edges: [TrailEdge!]!
    nodeCount: Int!
    edgeCount: Int!
  }

  type TrailPath {
    nodes: [TrailNode!]!
    edges: [TrailEdge!]!
    depth: Int!
  }

  # ─── Queries ─────────────────────────────────────────────────

  type Query {
    """Trace from an implementation/code back to its root directive"""
    traceUp(nodeId: ID!): TrailPath!

    """Trace from a directive down to all implementations"""
    traceDown(nodeId: ID!): TrailPath!

    """Get the full graph for a session"""
    session(sessionId: String!): SessionGraph!

    """Find the trail for a specific code location"""
    traceCode(
      filePath: String!
      line: Int!
      repoId: String
    ): TrailPath

    """Get a single node by ID"""
    node(id: ID!): TrailNode

    """Search trail nodes by text content"""
    searchTrails(
      query: String!
      projectId: String
      nodeTypes: [NodeType!]
      limit: Int
    ): [TrailNode!]!

    """List recent sessions for a project"""
    recentSessions(
      projectId: String!
      limit: Int
    ): [SessionGraph!]!

    """Get decisions with their alternatives for a session"""
    decisions(
      sessionId: String!
    ): [Decision!]!
  }
`;
