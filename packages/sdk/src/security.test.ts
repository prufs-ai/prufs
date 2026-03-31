/**
 * Security Tests - Signing, Hash Chaining, Tamper Detection, Sensitivity
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { unlinkSync, existsSync, readFileSync } from "node:fs";
import { createPublicKey } from "node:crypto";
import { TrailRecorder, LocalTransport, verifyChain, loadOrCreateKeyPair } from "./index.js";
import type { TrailEvent, TrailNode, SignedEvent } from "./index.js";

const TEST_DB = ".prufs/security-test";
const KEY_PATH = ".prufs/security-test-key.pem";

function cleanup() {
  for (const f of [
    `${TEST_DB}.ndjson`,
    KEY_PATH,
    KEY_PATH.replace(".pem", ".pub"),
  ]) {
    if (existsSync(f)) unlinkSync(f);
  }
}

describe("Cryptographic signing", () => {
  before(cleanup);
  after(cleanup);

  it("every event has a valid signature and content hash", async () => {
    const recorder = new TrailRecorder({
      project_id: "sec-test",
      transport: "local",
      agent_id: "test-agent",
      model_id: "test-model",
      local_db_path: `${TEST_DB}.db`,
      signing_key_path: KEY_PATH,
    });

    await recorder.startSession();
    const dId = await recorder.directive("Test directive", "tester");
    await recorder.interpretation(dId, "Test interpretation", { confidence: 0.9 });
    await recorder.decision(dId, {
      chosen: "Option A",
      alternatives: [{ description: "Option B", rejection_reason: "Worse" }],
      rationale: "A is better",
      domain_tags: ["testing"],
    });
    await recorder.endSession();

    // Read events
    const transport = new LocalTransport(`${TEST_DB}.db`);
    const events = transport.readAll();

    // Every event must have signing fields
    for (const event of events) {
      assert.ok(event.content_hash, `Event ${event.event_id} missing content_hash`);
      assert.ok(event.prev_hash, `Event ${event.event_id} missing prev_hash`);
      assert.ok(event.signature, `Event ${event.event_id} missing signature`);
      assert.ok(event.signer_id, `Event ${event.event_id} missing signer_id`);
      assert.equal(event.content_hash.length, 64, "content_hash should be SHA-256 (64 hex chars)");
      assert.ok(event.signature.length > 100, "signature should be an Ed25519 signature");
    }

    console.log(`  All ${events.length} events have valid signing fields`);
  });

  it("hash chain is intact - first event has prev_hash '0'", async () => {
    const transport = new LocalTransport(`${TEST_DB}.db`);
    const events = transport.readAll();

    assert.equal(events[0].prev_hash, "0", "First event should have prev_hash '0' (genesis)");

    // Each subsequent event's prev_hash should match the previous event's content_hash
    for (let i = 1; i < events.length; i++) {
      assert.equal(
        events[i].prev_hash,
        events[i - 1].content_hash,
        `Chain break at index ${i}: prev_hash doesn't match previous content_hash`
      );
    }

    console.log(`  Hash chain intact across ${events.length} events`);
  });

  it("verifyChain passes on untampered events", async () => {
    const transport = new LocalTransport(`${TEST_DB}.db`);
    const events = transport.readAll() as unknown as SignedEvent[];

    const keyPair = loadOrCreateKeyPair(KEY_PATH);
    const result = verifyChain(events, keyPair.publicKey);

    assert.ok(result.valid, `Chain verification failed: ${JSON.stringify(result.results.filter((r) => !r.valid))}`);
    assert.equal(result.chainBreaks.length, 0, "Should have no chain breaks");

    console.log(`  verifyChain passed: ${events.length} events, 0 breaks`);
  });

  it("detects tampered event content", async () => {
    const transport = new LocalTransport(`${TEST_DB}.db`);
    const events = transport.readAll() as unknown as SignedEvent[];

    // Tamper with the third event's payload
    const tampered = [...events];
    const tamperedEvent = { ...tampered[2] };
    const payload = tamperedEvent.payload as Record<string, unknown>;
    payload.text = "TAMPERED - this was not the original text";
    tampered[2] = { ...tamperedEvent, payload };

    const keyPair = loadOrCreateKeyPair(KEY_PATH);
    const result = verifyChain(tampered, keyPair.publicKey);

    assert.ok(!result.valid, "Tampered chain should fail verification");

    // The tampered event should have a content hash mismatch
    const failedEvent = result.results.find((r) => !r.valid);
    assert.ok(failedEvent, "Should have at least one failed event");
    assert.ok(
      failedEvent.errors.some((e) => e.includes("hash mismatch") || e.includes("Signature")),
      `Expected hash mismatch or signature error, got: ${failedEvent.errors}`
    );

    console.log(`  Tampering detected at event ${failedEvent.eventId.slice(0, 8)}...`);
  });

  it("signing key is persisted and reusable", () => {
    assert.ok(existsSync(KEY_PATH), "Private key should be saved to disk");
    assert.ok(existsSync(KEY_PATH.replace(".pem", ".pub")), "Public key should be saved");

    // Load the key again and verify it produces the same signer_id
    const kp1 = loadOrCreateKeyPair(KEY_PATH);
    const kp2 = loadOrCreateKeyPair(KEY_PATH);
    assert.equal(kp1.signerId, kp2.signerId, "Same key should produce same signer_id");

    console.log(`  Signer ID: ${kp1.signerId}`);
  });
});

describe("Sensitivity classification", () => {
  before(cleanup);
  after(cleanup);

  it("auto-classifies auth/security decisions as restricted", async () => {
    const recorder = new TrailRecorder({
      project_id: "sec-test",
      transport: "local",
      agent_id: "test-agent",
      model_id: "test-model",
      local_db_path: `${TEST_DB}.db`,
      signing_key_path: KEY_PATH,
    });

    await recorder.startSession();
    const dId = await recorder.directive("Update auth module", "tester");

    // Auth-tagged decision should be restricted
    await recorder.decision(dId, {
      chosen: "JWT tokens",
      rationale: "More scalable",
      domain_tags: ["auth", "security"],
    });

    // Non-sensitive decision should be public
    await recorder.decision(dId, {
      chosen: "React component",
      rationale: "Team standard",
      domain_tags: ["ui", "frontend"],
    });

    await recorder.endSession();

    const transport = new LocalTransport(`${TEST_DB}.db`);
    const events = transport.readAll();

    const decisions = events
      .filter((e: TrailEvent) => e.event_type === "node_created")
      .map((e: TrailEvent) => e.payload as TrailNode)
      .filter((n: TrailNode) => n.type === "decision");

    assert.equal(decisions.length, 2, "Should have 2 decisions");

    const authDecision = decisions.find((d) => (d as unknown as Record<string, unknown>).chosen === "JWT tokens") as unknown as Record<string, unknown>;
    const uiDecision = decisions.find((d) => (d as unknown as Record<string, unknown>).chosen === "React component") as unknown as Record<string, unknown>;

    assert.equal(authDecision.sensitivity, "restricted", "Auth decision should be restricted");
    assert.equal(uiDecision.sensitivity, "public", "UI decision should be public");

    console.log(`  Auth decision: ${authDecision.sensitivity} (correct)`);
    console.log(`  UI decision: ${uiDecision.sensitivity} (correct)`);
  });

  it("classifies payments and PII as restricted", async () => {
    const recorder = new TrailRecorder({
      project_id: "sec-test-2",
      transport: "local",
      agent_id: "test-agent",
      model_id: "test-model",
      local_db_path: `${TEST_DB}.db`,
      signing_key_path: KEY_PATH,
    });

    await recorder.startSession();
    const dId = await recorder.directive("Process payments", "tester");

    await recorder.decision(dId, {
      chosen: "Stripe API",
      rationale: "PCI compliant",
      domain_tags: ["payments", "billing"],
    });

    await recorder.decision(dId, {
      chosen: "Hash SSN before storage",
      rationale: "Compliance requirement",
      domain_tags: ["pii", "compliance"],
    });

    await recorder.endSession();

    const transport = new LocalTransport(`${TEST_DB}.db`);
    const events = transport.readAll();

    const decisions = events
      .filter((e: TrailEvent) => e.event_type === "node_created")
      .map((e: TrailEvent) => e.payload as TrailNode)
      .filter((n: TrailNode) => n.type === "decision");

    // All decisions from this session should be restricted
    // (filter to just this session's decisions by checking content)
    const paymentDec = decisions.find((d) => (d as unknown as Record<string, unknown>).chosen === "Stripe API") as unknown as Record<string, unknown>;
    const piiDec = decisions.find((d) => (d as unknown as Record<string, unknown>).chosen === "Hash SSN before storage") as unknown as Record<string, unknown>;

    assert.equal(paymentDec?.sensitivity, "restricted", "Payment decision should be restricted");
    assert.equal(piiDec?.sensitivity, "restricted", "PII decision should be restricted");

    console.log(`  Payments: ${paymentDec?.sensitivity}, PII: ${piiDec?.sensitivity}`);
  });
});
