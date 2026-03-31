/**
 * Prufs Trail API
 *
 * GraphQL server for querying decision trails. Connects to the
 * same Neo4j instance as the ingestion service.
 *
 * Start: node dist/server.js
 * GraphQL playground: http://localhost:3200/graphql
 */

import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import neo4j from "neo4j-driver";
import { typeDefs } from "./schema.js";
import { createResolvers } from "./resolvers.js";

const NEO4J_URI = process.env.NEO4J_URI ?? "bolt://localhost:7687";
const NEO4J_USER = process.env.NEO4J_USER ?? "neo4j";
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD ?? "prufs";
const PORT = parseInt(process.env.PORT ?? "3200", 10);

async function main() {
  const driver = neo4j.driver(
    NEO4J_URI,
    neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD)
  );

  // Verify connectivity
  try {
    await driver.verifyConnectivity();
    console.log("[trail-api] Connected to Neo4j");
  } catch (err) {
    console.warn("[trail-api] Could not connect to Neo4j:", err);
    console.warn("[trail-api] Starting anyway - queries will fail until Neo4j is available");
  }

  const resolvers = createResolvers(driver);

  const server = new ApolloServer({
    typeDefs,
    resolvers,
  });

  const { url } = await startStandaloneServer(server, {
    listen: { port: PORT },
  });

  console.log(`[trail-api] GraphQL API ready at ${url}`);
  console.log(`[trail-api] Example queries:`);
  console.log(`  traceUp(nodeId: "...")     - trace code to its directive`);
  console.log(`  traceDown(nodeId: "...")    - trace directive to implementations`);
  console.log(`  session(sessionId: "...")   - get full session graph`);
  console.log(`  traceCode(filePath: "...", line: N) - trace a code line`);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await server.stop();
    await driver.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
