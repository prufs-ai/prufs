/**
 * Tests for HttpCloudClient - the production client speaking the Prufs Cloud REST API.
 *
 * Uses a fetch stub to verify URL construction, headers, request bodies, and
 * response interpretation. Does not make real network calls.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { HttpCloudClient } from "./http-client.js";
import { makeCommit } from "./test-helpers.js";

interface StubCall {
  url: string;
  init: RequestInit;
}

function makeStubFetch(
  responder: (call: StubCall) => Response | Promise<Response>
): [typeof fetch, StubCall[]] {
  const calls: StubCall[] = [];
  const stub = (async (url: string | URL | Request, init?: RequestInit) => {
    const call: StubCall = {
      url: typeof url === "string" ? url : url.toString(),
      init: init ?? {},
    };
    calls.push(call);
    return responder(call);
  }) as unknown as typeof fetch;
  return [stub, calls];
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("HttpCloudClient - constructor", () => {
  it("throws when apiKey is missing", () => {
    assert.throws(() => new HttpCloudClient({ apiKey: "", orgSlug: "org" }));
  });

  it("throws when orgSlug is missing", () => {
    assert.throws(() => new HttpCloudClient({ apiKey: "prfs_xxx", orgSlug: "" }));
  });

  it("uses https://api.prufs.ai as default base URL", async () => {
    const [stub, calls] = makeStubFetch(() => jsonResponse(200, { commits: [] }));
    const client = new HttpCloudClient({
      apiKey: "prfs_xxx",
      orgSlug: "cognitionhive",
      fetchImpl: stub,
    });
    await client.fetchLog();
    assert.ok(calls[0].url.startsWith("https://api.prufs.ai/"));
  });

  it("strips trailing slash from custom base URL", async () => {
    const [stub, calls] = makeStubFetch(() => jsonResponse(200, { commits: [] }));
    const client = new HttpCloudClient({
      apiKey: "prfs_xxx",
      orgSlug: "cognitionhive",
      baseUrl: "https://custom.example.com//",
      fetchImpl: stub,
    });
    await client.fetchLog();
    assert.ok(calls[0].url.startsWith("https://custom.example.com/v1/log"));
  });
});

describe("HttpCloudClient - pushCommit", () => {
  it("returns accepted on 201", async () => {
    const [stub] = makeStubFetch(() => new Response(null, { status: 201 }));
    const client = new HttpCloudClient({
      apiKey: "prfs_xxx",
      orgSlug: "cognitionhive",
      fetchImpl: stub,
    });
    const result = await client.pushCommit(makeCommit("a", "genesis"));
    assert.equal(result.status, "accepted");
    assert.equal(result.commit_id, "a");
  });

  it("returns duplicate on 409", async () => {
    const [stub] = makeStubFetch(() => new Response(null, { status: 409 }));
    const client = new HttpCloudClient({
      apiKey: "prfs_xxx",
      orgSlug: "cognitionhive",
      fetchImpl: stub,
    });
    const result = await client.pushCommit(makeCommit("a", "genesis"));
    assert.equal(result.status, "duplicate");
  });

  it("returns rejected on 4xx with reason", async () => {
    const [stub] = makeStubFetch(
      () => new Response("invalid signature", { status: 400 })
    );
    const client = new HttpCloudClient({
      apiKey: "prfs_xxx",
      orgSlug: "cognitionhive",
      fetchImpl: stub,
    });
    const result = await client.pushCommit(makeCommit("a", "genesis"));
    assert.equal(result.status, "rejected");
    assert.match(result.reason ?? "", /invalid signature/);
  });

  it("throws on 5xx for retry handling", async () => {
    const [stub] = makeStubFetch(() => new Response(null, { status: 503 }));
    const client = new HttpCloudClient({
      apiKey: "prfs_xxx",
      orgSlug: "cognitionhive",
      fetchImpl: stub,
    });
    await assert.rejects(() => client.pushCommit(makeCommit("a", "genesis")), /503/);
  });

  it("sends Authorization header with Bearer scheme", async () => {
    const [stub, calls] = makeStubFetch(() => new Response(null, { status: 201 }));
    const client = new HttpCloudClient({
      apiKey: "prfs_abc123",
      orgSlug: "cognitionhive",
      fetchImpl: stub,
    });
    await client.pushCommit(makeCommit("a", "genesis"));
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer prfs_abc123");
  });
});

describe("HttpCloudClient - fetchLog", () => {
  it("returns the commits array from the response", async () => {
    const [stub] = makeStubFetch(() =>
      jsonResponse(200, {
        commits: [
          {
            commit_id: "a",
            parent_hash: "genesis",
            branch: "main",
            timestamp: "2026-04-07T00:00:00Z",
          },
        ],
      })
    );
    const client = new HttpCloudClient({
      apiKey: "prfs_xxx",
      orgSlug: "cognitionhive",
      fetchImpl: stub,
    });
    const log = await client.fetchLog();
    assert.equal(log.length, 1);
    assert.equal(log[0].commit_id, "a");
  });

  it("includes branch in query string when provided", async () => {
    const [stub, calls] = makeStubFetch(() => jsonResponse(200, { commits: [] }));
    const client = new HttpCloudClient({
      apiKey: "prfs_xxx",
      orgSlug: "cognitionhive",
      fetchImpl: stub,
    });
    await client.fetchLog("feature-x");
    assert.match(calls[0].url, /branch=feature-x/);
  });

  it("throws on non-2xx response", async () => {
    const [stub] = makeStubFetch(() => new Response(null, { status: 500 }));
    const client = new HttpCloudClient({
      apiKey: "prfs_xxx",
      orgSlug: "cognitionhive",
      fetchImpl: stub,
    });
    await assert.rejects(() => client.fetchLog(), /500/);
  });
});

describe("HttpCloudClient - fetchCommit", () => {
  it("returns the commit on 200", async () => {
    const commit = makeCommit("a", "genesis");
    const [stub] = makeStubFetch(() => jsonResponse(200, { commit }));
    const client = new HttpCloudClient({
      apiKey: "prfs_xxx",
      orgSlug: "cognitionhive",
      fetchImpl: stub,
    });
    const result = await client.fetchCommit("a");
    assert.equal(result?.commit_id, "a");
  });

  it("returns null on 404", async () => {
    const [stub] = makeStubFetch(() => new Response(null, { status: 404 }));
    const client = new HttpCloudClient({
      apiKey: "prfs_xxx",
      orgSlug: "cognitionhive",
      fetchImpl: stub,
    });
    const result = await client.fetchCommit("missing");
    assert.equal(result, null);
  });

  it("requests full=true", async () => {
    const [stub, calls] = makeStubFetch(() =>
      jsonResponse(200, { commit: makeCommit("a", "genesis") })
    );
    const client = new HttpCloudClient({
      apiKey: "prfs_xxx",
      orgSlug: "cognitionhive",
      fetchImpl: stub,
    });
    await client.fetchCommit("a");
    assert.match(calls[0].url, /full=true/);
  });
});

describe("HttpCloudClient - fetchBranches", () => {
  it("returns the branches array", async () => {
    const [stub] = makeStubFetch(() =>
      jsonResponse(200, { branches: ["main", "dev", "feature-x"] })
    );
    const client = new HttpCloudClient({
      apiKey: "prfs_xxx",
      orgSlug: "cognitionhive",
      fetchImpl: stub,
    });
    const branches = await client.fetchBranches();
    assert.deepEqual(branches, ["main", "dev", "feature-x"]);
  });

  it("returns empty array if response omits branches field", async () => {
    const [stub] = makeStubFetch(() => jsonResponse(200, {}));
    const client = new HttpCloudClient({
      apiKey: "prfs_xxx",
      orgSlug: "cognitionhive",
      fetchImpl: stub,
    });
    const branches = await client.fetchBranches();
    assert.deepEqual(branches, []);
  });
});
