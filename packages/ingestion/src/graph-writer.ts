/**
 * Neo4j Graph Writer
 *
 * Takes trail events from the ingestion pipeline and writes them
 * to the Neo4j graph database. Each node type gets its own label
 * for efficient querying, and all nodes share a :TrailNode label
 * for cross-type traversals.
 */

import neo4j, { type Driver, type Session } from "neo4j-driver";
import type { TrailNode, TrailEdge, EdgeType } from "@prufs/sdk";

export class GraphWriter {
  private driver: Driver;

  constructor(uri: string, username: string, password: string) {
    this.driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  }

  /**
   * Initialize the graph schema - constraints and indexes.
   * Call once on startup.
   */
  async initSchema(): Promise<void> {
    const session = this.driver.session();
    try {
      // Unique constraint on node IDs (also creates an index)
      await session.run(
        `CREATE CONSTRAINT trail_node_id IF NOT EXISTS
         FOR (n:TrailNode) REQUIRE n.id IS UNIQUE`
      );

      // Index on session_id for session-scoped queries
      await session.run(
        `CREATE INDEX trail_node_session IF NOT EXISTS
         FOR (n:TrailNode) ON (n.session_id)`
      );

      // Index on project_id for project-scoped queries
      await session.run(
        `CREATE INDEX trail_node_project IF NOT EXISTS
         FOR (n:TrailNode) ON (n.project_id)`
      );

      // Index on type for type-filtered queries
      await session.run(
        `CREATE INDEX trail_node_type IF NOT EXISTS
         FOR (n:TrailNode) ON (n.type)`
      );

      // Full-text index on directive and decision text for search
      try {
        await session.run(
          `CREATE FULLTEXT INDEX trail_text IF NOT EXISTS
           FOR (n:TrailNode) ON EACH [n.text, n.chosen, n.rationale]`
        );
      } catch {
        // Full-text indexes may already exist or not be supported in all editions
      }

      console.log("[graph] Schema initialized");
    } finally {
      await session.close();
    }
  }

  /**
   * Write a trail node to the graph.
   * Applies both a :TrailNode label and a type-specific label
   * (e.g., :Directive, :Decision).
   */
  async writeNode(node: TrailNode): Promise<void> {
    const session = this.driver.session();
    try {
      const typeLabel = labelForType(node.type);
      // Flatten the node into properties. Arrays and nested objects
      // are stored as JSON strings since Neo4j CE doesn't support
      // nested properties.
      const props = flattenNode(node);

      await session.run(
        `MERGE (n:TrailNode {id: $id})
         SET n += $props, n:${typeLabel}`,
        { id: node.id, props }
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Write a trail edge (relationship) to the graph.
   */
  async writeEdge(edge: TrailEdge): Promise<void> {
    const session = this.driver.session();
    try {
      const relType = relTypeForEdge(edge.type);

      await session.run(
        `MATCH (from:TrailNode {id: $from_id})
         MATCH (to:TrailNode {id: $to_id})
         MERGE (from)-[r:${relType} {id: $edge_id}]->(to)
         SET r.timestamp = $timestamp`,
        {
          from_id: edge.from_node,
          to_id: edge.to_node,
          edge_id: edge.id,
          timestamp: edge.timestamp,
        }
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Batch write multiple nodes and edges in a single transaction.
   * More efficient for bulk ingestion.
   */
  async writeBatch(
    nodes: TrailNode[],
    edges: TrailEdge[]
  ): Promise<{ nodesWritten: number; edgesWritten: number }> {
    const session = this.driver.session();
    try {
      const result = await session.executeWrite(async (tx) => {
        let nodesWritten = 0;
        let edgesWritten = 0;

        for (const node of nodes) {
          const typeLabel = labelForType(node.type);
          const props = flattenNode(node);
          await tx.run(
            `MERGE (n:TrailNode {id: $id})
             SET n += $props, n:${typeLabel}`,
            { id: node.id, props }
          );
          nodesWritten++;
        }

        for (const edge of edges) {
          const relType = relTypeForEdge(edge.type);
          await tx.run(
            `MATCH (from:TrailNode {id: $from_id})
             MATCH (to:TrailNode {id: $to_id})
             MERGE (from)-[r:${relType} {id: $edge_id}]->(to)
             SET r.timestamp = $timestamp`,
            {
              from_id: edge.from_node,
              to_id: edge.to_node,
              edge_id: edge.id,
              timestamp: edge.timestamp,
            }
          );
          edgesWritten++;
        }

        return { nodesWritten, edgesWritten };
      });

      return result;
    } finally {
      await session.close();
    }
  }

  // -----------------------------------------------------------------------
  // Query methods (used by the Trail API)
  // -----------------------------------------------------------------------

  /**
   * Trace from a code implementation back to its root directive.
   * Returns the full causal chain.
   */
  async traceToDirective(
    implementation_id: string
  ): Promise<TrailNode[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH path = (impl:TrailNode {id: $id})-[:CAUSED_BY*]->(root:Directive)
         UNWIND nodes(path) AS n
         RETURN DISTINCT n
         ORDER BY n.timestamp ASC`,
        { id: implementation_id }
      );
      return result.records.map((r) => unflattenNode(r.get("n").properties));
    } finally {
      await session.close();
    }
  }

  /**
   * Get all nodes downstream of a directive.
   */
  async traceFromDirective(
    directive_id: string
  ): Promise<TrailNode[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH path = (d:Directive {id: $id})<-[:CAUSED_BY*]-(child)
         UNWIND nodes(path) AS n
         RETURN DISTINCT n
         ORDER BY n.timestamp ASC`,
        { id: directive_id }
      );
      return result.records.map((r) => unflattenNode(r.get("n").properties));
    } finally {
      await session.close();
    }
  }

  /**
   * Get all nodes and edges for a session.
   */
  async getSession(
    session_id: string
  ): Promise<{ nodes: TrailNode[]; edges: Array<{ from: string; to: string; type: string }> }> {
    const session = this.driver.session();
    try {
      const nodeResult = await session.run(
        `MATCH (n:TrailNode {session_id: $session_id})
         RETURN n ORDER BY n.timestamp ASC`,
        { session_id }
      );

      const edgeResult = await session.run(
        `MATCH (a:TrailNode {session_id: $sid})-[r]->(b:TrailNode {session_id: $sid})
         RETURN a.id AS from, b.id AS to, type(r) AS type`,
        { sid: session_id }
      );

      return {
        nodes: nodeResult.records.map((r) =>
          unflattenNode(r.get("n").properties)
        ),
        edges: edgeResult.records.map((r) => ({
          from: r.get("from") as string,
          to: r.get("to") as string,
          type: r.get("type") as string,
        })),
      };
    } finally {
      await session.close();
    }
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function labelForType(type: string): string {
  // Neo4j label: PascalCase
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function relTypeForEdge(type: EdgeType): string {
  // Neo4j relationship type: UPPER_SNAKE_CASE
  return type.toUpperCase();
}

function flattenNode(node: TrailNode): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) || (typeof value === "object" && !(value instanceof Date))) {
      flat[key] = JSON.stringify(value);
    } else {
      flat[key] = value;
    }
  }
  return flat;
}

function unflattenNode(props: Record<string, unknown>): TrailNode {
  const node: Record<string, unknown> = {};
  const jsonFields = [
    "alternatives",
    "domain_tags",
    "file_changes",
    "test_results",
    "metadata",
  ];
  for (const [key, value] of Object.entries(props)) {
    if (jsonFields.includes(key) && typeof value === "string") {
      try {
        node[key] = JSON.parse(value);
      } catch {
        node[key] = value;
      }
    } else {
      node[key] = value;
    }
  }
  return node as unknown as TrailNode;
}
