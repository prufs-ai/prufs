/**
 * Prufs Ingestion Service
 *
 * HTTP server that receives trail events from the SDK and writes
 * them to the Neo4j graph store. Supports both single-event and
 * batch ingestion.
 *
 * Endpoints:
 *   POST /api/v1/events       - Batch ingest events
 *   GET  /api/v1/health       - Health check
 *   GET  /api/v1/sessions/:id - Get full session trail
 *   GET  /api/v1/trace/up/:id - Trace implementation to directive
 *   GET  /api/v1/trace/down/:id - Trace directive to implementations
 */

import Fastify from "fastify";
import { GraphWriter } from "./graph-writer.js";
import type { TrailEvent, TrailNode, TrailEdge } from "@prufs/sdk";

const NEO4J_URI = process.env.NEO4J_URI ?? "bolt://localhost:7687";
const NEO4J_USER = process.env.NEO4J_USER ?? "neo4j";
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD ?? "prufs";
const PORT = parseInt(process.env.PORT ?? "3100", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

async function main() {
  const fastify = Fastify({
    logger: {
      level: "info",
      transport: {
        target: "pino-pretty",
        options: { translateTime: "HH:MM:ss Z", ignore: "pid,hostname" },
      },
    },
  });

  // Initialize graph connection
  const graph = new GraphWriter(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD);

  try {
    await graph.initSchema();
    fastify.log.info("Connected to Neo4j and initialized schema");
  } catch (err) {
    fastify.log.warn(
      "Could not connect to Neo4j - running in dry-run mode. Events will be logged but not persisted."
    );
    fastify.log.warn(String(err));
  }

  // -----------------------------------------------------------------------
  // Health check
  // -----------------------------------------------------------------------

  fastify.get("/api/v1/health", async () => ({
    status: "ok",
    service: "prufs-ingestion",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
  }));

  // -----------------------------------------------------------------------
  // Event ingestion
  // -----------------------------------------------------------------------

  fastify.post<{
    Body: { events: TrailEvent[] };
  }>("/api/v1/events", async (request, reply) => {
    const { events } = request.body;

    if (!events || !Array.isArray(events)) {
      return reply.status(400).send({
        error: "Request body must contain an 'events' array",
      });
    }

    const nodes: TrailNode[] = [];
    const edges: TrailEdge[] = [];
    let sessions = 0;

    for (const event of events) {
      switch (event.event_type) {
        case "node_created":
          nodes.push(event.payload as TrailNode);
          break;
        case "edge_created":
          edges.push(event.payload as TrailEdge);
          break;
        case "session_started":
        case "session_ended":
          sessions++;
          // Session events are logged but not stored as graph nodes (yet).
          // Post-MVP: session nodes that group all trail nodes for a session.
          fastify.log.info(
            { event_type: event.event_type, session_id: event.session_id },
            "Session event"
          );
          break;
      }
    }

    try {
      // Write nodes first, then edges (edges reference nodes)
      if (nodes.length > 0 || edges.length > 0) {
        const result = await graph.writeBatch(nodes, edges);
        fastify.log.info(
          {
            nodes: result.nodesWritten,
            edges: result.edgesWritten,
            sessions,
          },
          "Batch ingested"
        );
      }

      return {
        accepted: events.length,
        nodes_written: nodes.length,
        edges_written: edges.length,
      };
    } catch (err) {
      fastify.log.error(err, "Failed to write to graph");
      return reply.status(500).send({
        error: "Failed to write events to graph store",
        details: String(err),
      });
    }
  });

  // -----------------------------------------------------------------------
  // Query endpoints
  // -----------------------------------------------------------------------

  fastify.get<{
    Params: { id: string };
  }>("/api/v1/sessions/:id", async (request, reply) => {
    try {
      const result = await graph.getSession(request.params.id);
      return result;
    } catch (err) {
      fastify.log.error(err, "Failed to query session");
      return reply.status(500).send({ error: String(err) });
    }
  });

  fastify.get<{
    Params: { id: string };
  }>("/api/v1/trace/up/:id", async (request, reply) => {
    try {
      const trail = await graph.traceToDirective(request.params.id);
      return { trail };
    } catch (err) {
      fastify.log.error(err, "Failed to trace up");
      return reply.status(500).send({ error: String(err) });
    }
  });

  fastify.get<{
    Params: { id: string };
  }>("/api/v1/trace/down/:id", async (request, reply) => {
    try {
      const trail = await graph.traceFromDirective(request.params.id);
      return { trail };
    } catch (err) {
      fastify.log.error(err, "Failed to trace down");
      return reply.status(500).send({ error: String(err) });
    }
  });

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  fastify.addHook("onClose", async () => {
    await graph.close();
  });

  await fastify.listen({ port: PORT, host: HOST });
  fastify.log.info(`Ingestion service listening on ${HOST}:${PORT}`);
}

main().catch((err) => {
  console.error("Fatal error starting ingestion service:", err);
  process.exit(1);
});
