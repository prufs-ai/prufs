/**
 * Tests for the typed event emitter.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { SyncEmitter } from "./emitter.js";
import type { SyncEventPayload } from "./types.js";

describe("SyncEmitter", () => {
  it("starts with zero listeners", () => {
    const emitter = new SyncEmitter();
    assert.equal(emitter.listenerCount("sync:start"), 0);
    assert.equal(emitter.listenerCount("*"), 0);
  });

  it("registers and counts listeners", () => {
    const emitter = new SyncEmitter();
    emitter.on("sync:start", () => {});
    emitter.on("sync:start", () => {});
    emitter.on("sync:complete", () => {});
    assert.equal(emitter.listenerCount("sync:start"), 2);
    assert.equal(emitter.listenerCount("sync:complete"), 1);
  });

  it("emits to specific listeners", () => {
    const emitter = new SyncEmitter();
    const received: SyncEventPayload[] = [];
    emitter.on("push:commit", (p) => received.push(p));

    emitter.emit({ type: "push:commit", commit_id: "a" });
    emitter.emit({ type: "pull:commit", commit_id: "b" });
    emitter.emit({ type: "push:commit", commit_id: "c" });

    assert.equal(received.length, 2);
    assert.equal(received[0].commit_id, "a");
    assert.equal(received[1].commit_id, "c");
  });

  it("emits to wildcard listeners", () => {
    const emitter = new SyncEmitter();
    const received: SyncEventPayload[] = [];
    emitter.on("*", (p) => received.push(p));

    emitter.emit({ type: "sync:start" });
    emitter.emit({ type: "pull:commit", commit_id: "a" });
    emitter.emit({ type: "sync:complete" });

    assert.equal(received.length, 3);
  });

  it("removes listeners via off()", () => {
    const emitter = new SyncEmitter();
    const received: SyncEventPayload[] = [];
    const listener = (p: SyncEventPayload) => received.push(p);

    emitter.on("sync:start", listener);
    emitter.emit({ type: "sync:start" });
    assert.equal(received.length, 1);

    emitter.off("sync:start", listener);
    emitter.emit({ type: "sync:start" });
    assert.equal(received.length, 1);
  });

  it("supports chained on/off calls", () => {
    const emitter = new SyncEmitter();
    const chained = emitter
      .on("sync:start", () => {})
      .on("sync:complete", () => {});
    assert.equal(chained, emitter);
  });

  it("tolerates emit with no listeners", () => {
    const emitter = new SyncEmitter();
    assert.doesNotThrow(() => emitter.emit({ type: "sync:start" }));
  });
});
