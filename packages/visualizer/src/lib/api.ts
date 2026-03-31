/**
 * Trail API Client - lightweight GraphQL client using native fetch.
 */

const API_URL = "http://localhost:3200";

export interface TrailNode {
  id: string;
  type: string;
  timestamp: string;
  sessionId?: string;
  projectId?: string;
  text?: string;
  author?: string;
  agentId?: string;
  modelId?: string;
  confidence?: number;
  chosen?: string;
  rationale?: string;
  alternatives?: Array<{ description: string; rejectionReason?: string }>;
  domainTags?: string[];
  source?: string;
  linesAdded?: number;
  linesRemoved?: number;
  fileChanges?: Array<{ path: string; changeType: string; linesAdded: number; linesRemoved: number }>;
  commitSha?: string;
  verificationType?: string;
  result?: string;
  details?: string;
}

export interface TrailEdge {
  fromNode: string;
  toNode: string;
  type: string;
}

export interface TrailPath {
  nodes: TrailNode[];
  edges: TrailEdge[];
  depth: number;
}

export interface SessionGraph {
  sessionId: string;
  projectId: string;
  nodes: TrailNode[];
  edges: TrailEdge[];
  nodeCount: number;
  edgeCount: number;
}

const FRAG = `... on Directive { id type text author timestamp sessionId }
... on Interpretation { id type text agentId modelId confidence timestamp sessionId }
... on Decision { id type chosen rationale alternatives { description rejectionReason } domainTags confidence timestamp sessionId }
... on Constraint { id type text source timestamp sessionId }
... on Implementation { id type linesAdded linesRemoved fileChanges { path changeType linesAdded linesRemoved } commitSha timestamp sessionId }
... on Verification { id type verificationType result details timestamp sessionId }`;

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const j = await r.json();
    return j.data ?? null;
  } catch { return null; }
}

export const api = {
  traceUp: async (nodeId: string) => {
    const d = await gql<{ traceUp: TrailPath }>(`query($id:ID!){traceUp(nodeId:$id){nodes{${FRAG}}edges{fromNode toNode type}depth}}`, { id: nodeId });
    return d?.traceUp ?? null;
  },
  traceDown: async (nodeId: string) => {
    const d = await gql<{ traceDown: TrailPath }>(`query($id:ID!){traceDown(nodeId:$id){nodes{${FRAG}}edges{fromNode toNode type}depth}}`, { id: nodeId });
    return d?.traceDown ?? null;
  },
  session: async (sessionId: string) => {
    const d = await gql<{ session: SessionGraph }>(`query($s:String!){session(sessionId:$s){sessionId projectId nodes{${FRAG}}edges{fromNode toNode type}nodeCount edgeCount}}`, { s: sessionId });
    return d?.session ?? null;
  },
  search: async (query: string) => {
    const d = await gql<{ searchTrails: TrailNode[] }>(`query($q:String!){searchTrails(query:$q,limit:20){${FRAG}}}`, { q: query });
    return d?.searchTrails ?? [];
  },
};
