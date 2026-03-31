/**
 * Trail API - GraphQL Resolvers
 *
 * Maps GraphQL queries to Neo4j Cypher queries. Uses the same
 * graph connection pattern as the ingestion service.
 */

import neo4j, { type Driver } from "neo4j-driver";

export function createResolvers(driver: Driver) {
  return {
    // ─── Interface resolution ─────────────────────────────────
    TrailNode: {
      __resolveType(node: Record<string, unknown>) {
        const typeMap: Record<string, string> = {
          directive: "Directive",
          interpretation: "Interpretation",
          decision: "Decision",
          constraint: "Constraint",
          implementation: "Implementation",
          verification: "Verification",
        };
        return typeMap[node.type as string] ?? "Directive";
      },
    },

    // ─── Queries ──────────────────────────────────────────────
    Query: {
      async traceUp(_: unknown, { nodeId }: { nodeId: string }) {
        const session = driver.session();
        try {
          const result = await session.run(
            `MATCH path = (start:TrailNode {id: $id})-[:CAUSED_BY*0..20]->(root)
             WHERE NOT (root)-[:CAUSED_BY]->()
             WITH nodes(path) AS ns, relationships(path) AS rs
             UNWIND ns AS n
             WITH COLLECT(DISTINCT n) AS nodes, rs
             UNWIND rs AS r
             RETURN nodes,
                    COLLECT(DISTINCT {
                      id: r.id,
                      type: toLower(type(r)),
                      fromNode: startNode(r).id,
                      toNode: endNode(r).id,
                      timestamp: r.timestamp
                    }) AS edges`,
            { id: nodeId }
          );

          if (result.records.length === 0) {
            return { nodes: [], edges: [], depth: 0 };
          }

          const record = result.records[0];
          const nodes = (record.get("nodes") as Array<{ properties: Record<string, unknown> }>)
            .map((n) => mapNode(n.properties));
          const edges = record.get("edges") as Array<Record<string, unknown>>;

          return { nodes, edges, depth: nodes.length - 1 };
        } finally {
          await session.close();
        }
      },

      async traceDown(_: unknown, { nodeId }: { nodeId: string }) {
        const session = driver.session();
        try {
          const result = await session.run(
            `MATCH path = (root:TrailNode {id: $id})<-[:CAUSED_BY*0..20]-(child)
             WITH nodes(path) AS ns, relationships(path) AS rs
             UNWIND ns AS n
             WITH COLLECT(DISTINCT n) AS nodes, rs
             UNWIND rs AS r
             RETURN nodes,
                    COLLECT(DISTINCT {
                      id: r.id,
                      type: toLower(type(r)),
                      fromNode: startNode(r).id,
                      toNode: endNode(r).id,
                      timestamp: r.timestamp
                    }) AS edges`,
            { id: nodeId }
          );

          if (result.records.length === 0) {
            return { nodes: [], edges: [], depth: 0 };
          }

          const record = result.records[0];
          const nodes = (record.get("nodes") as Array<{ properties: Record<string, unknown> }>)
            .map((n) => mapNode(n.properties));
          const edges = record.get("edges") as Array<Record<string, unknown>>;

          return { nodes, edges, depth: nodes.length - 1 };
        } finally {
          await session.close();
        }
      },

      async session(_: unknown, { sessionId }: { sessionId: string }) {
        const session = driver.session();
        try {
          const nodeResult = await session.run(
            `MATCH (n:TrailNode {session_id: $sid})
             RETURN n ORDER BY n.timestamp ASC`,
            { sid: sessionId }
          );

          const edgeResult = await session.run(
            `MATCH (a:TrailNode {session_id: $sid})-[r]->(b:TrailNode {session_id: $sid})
             RETURN {
               id: r.id,
               type: toLower(type(r)),
               fromNode: a.id,
               toNode: b.id,
               timestamp: r.timestamp
             } AS edge`,
            { sid: sessionId }
          );

          const nodes = nodeResult.records.map((r) =>
            mapNode((r.get("n") as { properties: Record<string, unknown> }).properties)
          );
          const edges = edgeResult.records.map((r) =>
            r.get("edge") as Record<string, unknown>
          );

          return {
            sessionId,
            projectId: nodes[0]?.projectId ?? "",
            nodes,
            edges,
            nodeCount: nodes.length,
            edgeCount: edges.length,
          };
        } finally {
          await session.close();
        }
      },

      async traceCode(
        _: unknown,
        { filePath, line, repoId }: { filePath: string; line: number; repoId?: string }
      ) {
        const session = driver.session();
        try {
          // Find implementation nodes whose file_changes include this file
          // Then trace up to the directive
          const result = await session.run(
            `MATCH (impl:Implementation)
             WHERE impl.file_changes CONTAINS $filePath
             WITH impl
             MATCH path = (impl)-[:CAUSED_BY*0..20]->(root)
             WHERE NOT (root)-[:CAUSED_BY]->()
             WITH nodes(path) AS ns, relationships(path) AS rs
             UNWIND ns AS n
             WITH COLLECT(DISTINCT n) AS nodes, rs
             UNWIND rs AS r
             RETURN nodes,
                    COLLECT(DISTINCT {
                      id: r.id,
                      type: toLower(type(r)),
                      fromNode: startNode(r).id,
                      toNode: endNode(r).id,
                      timestamp: r.timestamp
                    }) AS edges
             LIMIT 1`,
            { filePath }
          );

          if (result.records.length === 0) return null;

          const record = result.records[0];
          const nodes = (record.get("nodes") as Array<{ properties: Record<string, unknown> }>)
            .map((n) => mapNode(n.properties));
          const edges = record.get("edges") as Array<Record<string, unknown>>;

          return { nodes, edges, depth: nodes.length - 1 };
        } finally {
          await session.close();
        }
      },

      async node(_: unknown, { id }: { id: string }) {
        const session = driver.session();
        try {
          const result = await session.run(
            `MATCH (n:TrailNode {id: $id}) RETURN n`,
            { id }
          );
          if (result.records.length === 0) return null;
          return mapNode(
            (result.records[0].get("n") as { properties: Record<string, unknown> }).properties
          );
        } finally {
          await session.close();
        }
      },

      async searchTrails(
        _: unknown,
        {
          query,
          projectId,
          nodeTypes,
          limit,
        }: { query: string; projectId?: string; nodeTypes?: string[]; limit?: number }
      ) {
        const session = driver.session();
        try {
          // Input validation - reject obviously malicious input
          if (query.length > 500) {
            throw new Error("Search query too long (max 500 characters)");
          }

          // Build query with parameterized inputs only - never interpolate user strings
          let cypher = `CALL db.index.fulltext.queryNodes("trail_text", $query)
                        YIELD node, score
                        WHERE score > 0.5`;

          const params: Record<string, unknown> = {
            query,
            limit: neo4j.int(limit ?? 20),
          };

          if (projectId) {
            cypher += ` AND node.project_id = $projectId`;
            params.projectId = projectId;
          }
          if (nodeTypes && nodeTypes.length > 0) {
            // Validate node types against allowed values
            const allowedTypes = ["directive", "interpretation", "decision", "constraint", "implementation", "verification"];
            const sanitized = nodeTypes.filter((t) => allowedTypes.includes(t));
            if (sanitized.length > 0) {
              cypher += ` AND node.type IN $nodeTypes`;
              params.nodeTypes = sanitized;
            }
          }

          cypher += ` RETURN node ORDER BY score DESC LIMIT $limit`;

          const result = await session.run(cypher, params);

          return result.records.map((r) =>
            mapNode((r.get("node") as { properties: Record<string, unknown> }).properties)
          );
        } finally {
          await session.close();
        }
      },

      async recentSessions(
        _: unknown,
        { projectId, limit }: { projectId: string; limit?: number }
      ) {
        const session = driver.session();
        try {
          const result = await session.run(
            `MATCH (n:TrailNode {project_id: $pid})
             WITH n.session_id AS sid, MIN(n.timestamp) AS started
             ORDER BY started DESC
             LIMIT $limit
             RETURN sid`,
            { pid: projectId, limit: neo4j.int(limit ?? 10) }
          );

          const sessionIds = result.records.map((r) => r.get("sid") as string);

          // Fetch each session (simplified - production would batch this)
          const sessions = [];
          for (const sid of sessionIds) {
            const nodeResult = await session.run(
              `MATCH (n:TrailNode {session_id: $sid})
               RETURN n ORDER BY n.timestamp ASC`,
              { sid }
            );
            const nodes = nodeResult.records.map((r) =>
              mapNode((r.get("n") as { properties: Record<string, unknown> }).properties)
            );
            sessions.push({
              sessionId: sid,
              projectId,
              nodes,
              edges: [],
              nodeCount: nodes.length,
              edgeCount: 0,
            });
          }

          return sessions;
        } finally {
          await session.close();
        }
      },

      async decisions(_: unknown, { sessionId }: { sessionId: string }) {
        const session = driver.session();
        try {
          const result = await session.run(
            `MATCH (n:Decision {session_id: $sid})
             RETURN n ORDER BY n.timestamp ASC`,
            { sid: sessionId }
          );
          return result.records.map((r) =>
            mapNode((r.get("n") as { properties: Record<string, unknown> }).properties)
          );
        } finally {
          await session.close();
        }
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Node mapping: Neo4j properties -> GraphQL type
// ---------------------------------------------------------------------------

/** Access level of the requesting user. In MVP, passed via X-Prufs-Role header. */
export type AccessRole = "owner" | "reviewer" | "member" | "public";

function mapNode(
  props: Record<string, unknown>,
  accessRole: AccessRole = "owner"
): Record<string, unknown> {
  const jsonFields = [
    "alternatives",
    "domain_tags",
    "file_changes",
    "test_results",
    "metadata",
  ];

  const mapped: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(props)) {
    // Convert snake_case to camelCase for GraphQL
    const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

    if (jsonFields.includes(key) && typeof value === "string") {
      try {
        mapped[camelKey] = JSON.parse(value);
      } catch {
        mapped[camelKey] = value;
      }
    } else {
      mapped[camelKey] = value;
    }
  }

  // Sensitivity-based RBAC filtering for Decision nodes
  // Restricted decisions have their rationale and alternatives redacted
  // for users below "reviewer" access level
  if (mapped.type === "decision" && mapped.sensitivity === "restricted") {
    if (accessRole === "member" || accessRole === "public") {
      mapped.rationale = "[REDACTED - restricted decision. Request reviewer access to view.]";
      mapped.alternatives = [];
      mapped.chosen = mapped.chosen; // chosen is visible (you can see WHAT was decided, not WHY)
    }
  }

  return mapped;
}

// ---------------------------------------------------------------------------
// Event chain verification endpoint support
// ---------------------------------------------------------------------------

/**
 * Verify the integrity of a session's event chain.
 * Called by the /api/v1/verify/:sessionId endpoint on the ingestion service.
 *
 * Returns: { valid, eventCount, chainBreaks, signatureFailures }
 */
export interface ChainVerificationResult {
  valid: boolean;
  eventCount: number;
  chainBreaks: number;
  signatureFailures: number;
  firstFailureAt?: string;
}

