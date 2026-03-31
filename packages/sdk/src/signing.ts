/**
 * Prufs SDK - Cryptographic Signing
 *
 * Provides tamper-evident event signing and hash-chaining using
 * Node.js built-in crypto (Ed25519). No external dependencies.
 *
 * Each trail event is:
 *   1. Serialized to a canonical JSON string (sorted keys, no whitespace)
 *   2. SHA-256 hashed to produce a content_hash
 *   3. Chained to the previous event via prev_hash
 *   4. Signed with Ed25519 to produce a signature
 *
 * This makes the event log tamper-evident: modifying any event
 * invalidates its signature and breaks the hash chain for all
 * subsequent events.
 *
 * Verification is independent of the SDK - any tool with the public
 * key can verify the chain.
 */

import {
  generateKeyPairSync,
  createHash,
  sign,
  verify,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
} from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ---------------------------------------------------------------------------
// Key management
// ---------------------------------------------------------------------------

export interface SigningKeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
  signerId: string; // first 8 hex chars of public key hash
}

/**
 * Load or generate an Ed25519 signing keypair.
 *
 * If keyPath exists, loads the private key from it.
 * If not, generates a new keypair and saves both the private key
 * (.pem) and public key (.pub) to disk.
 */
export function loadOrCreateKeyPair(keyPath: string): SigningKeyPair {
  const pubPath = keyPath.replace(/\.pem$/, ".pub");

  if (existsSync(keyPath)) {
    const privatePem = readFileSync(keyPath, "utf-8");
    const privateKey = createPrivateKey(privatePem);
    const publicKey = createPublicKey(privateKey);

    return {
      privateKey,
      publicKey,
      signerId: computeSignerId(publicKey),
    };
  }

  // Generate new keypair
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");

  // Save to disk
  const dir = dirname(keyPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(
    keyPath,
    privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    { mode: 0o600 } // owner-read-only
  );

  writeFileSync(
    pubPath,
    publicKey.export({ type: "spki", format: "pem" }) as string
  );

  return {
    privateKey,
    publicKey,
    signerId: computeSignerId(publicKey),
  };
}

/**
 * Compute the signer ID from a public key.
 * First 8 hex characters of the SHA-256 hash of the public key DER encoding.
 */
function computeSignerId(publicKey: KeyObject): string {
  const der = publicKey.export({ type: "spki", format: "der" });
  const hash = createHash("sha256").update(der).digest("hex");
  return hash.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Event signing and hash chaining
// ---------------------------------------------------------------------------

/**
 * Signable event - the fields that go into the content hash.
 * Excludes content_hash, prev_hash, signature, and signer_id
 * since those are computed during signing.
 */
export interface UnsignedEvent {
  event_id: string;
  event_type: string;
  timestamp: string;
  session_id: string;
  project_id: string;
  payload: unknown;
}

/**
 * Compute the content hash of an event.
 * Uses canonical JSON serialization (sorted keys) to ensure
 * deterministic hashing regardless of property insertion order.
 */
export function computeContentHash(event: UnsignedEvent): string {
  const canonical = canonicalize(event);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Sign an event and add the hash chain link.
 *
 * Returns the four signing fields to add to the TrailEvent:
 *   content_hash, prev_hash, signature, signer_id
 */
export function signEvent(
  event: UnsignedEvent,
  keyPair: SigningKeyPair,
  prevHash: string
): {
  content_hash: string;
  prev_hash: string;
  signature: string;
  signer_id: string;
} {
  const contentHash = computeContentHash(event);

  // Sign the concatenation of content_hash + prev_hash
  // This binds the event both to its content and its position in the chain
  const signable = Buffer.from(contentHash + prevHash, "utf-8");
  const signature = sign(null, signable, keyPair.privateKey).toString("hex");

  return {
    content_hash: contentHash,
    prev_hash: prevHash,
    signature,
    signer_id: keyPair.signerId,
  };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export interface SignedEvent {
  event_id: string;
  event_type: string;
  timestamp: string;
  session_id: string;
  project_id: string;
  payload: unknown;
  content_hash: string;
  prev_hash: string;
  signature: string;
  signer_id: string;
}

export interface VerificationResult {
  valid: boolean;
  eventId: string;
  errors: string[];
}

/**
 * Verify a single event's signature and content hash.
 */
export function verifyEvent(
  event: SignedEvent,
  publicKey: KeyObject
): VerificationResult {
  const errors: string[] = [];

  // 1. Verify content hash
  const unsigned: UnsignedEvent = {
    event_id: event.event_id,
    event_type: event.event_type,
    timestamp: event.timestamp,
    session_id: event.session_id,
    project_id: event.project_id,
    payload: event.payload,
  };
  const expectedHash = computeContentHash(unsigned);
  if (expectedHash !== event.content_hash) {
    errors.push(
      `Content hash mismatch: expected ${expectedHash.slice(0, 16)}..., got ${event.content_hash.slice(0, 16)}...`
    );
  }

  // 2. Verify signature
  const signable = Buffer.from(event.content_hash + event.prev_hash, "utf-8");
  const sigBuffer = Buffer.from(event.signature, "hex");
  const sigValid = verify(null, signable, publicKey, sigBuffer);
  if (!sigValid) {
    errors.push("Signature verification failed");
  }

  return {
    valid: errors.length === 0,
    eventId: event.event_id,
    errors,
  };
}

/**
 * Verify an entire event chain - checks signatures, content hashes,
 * and hash chain integrity.
 *
 * Returns results for each event plus an overall chain validity flag.
 */
export function verifyChain(
  events: SignedEvent[],
  publicKey: KeyObject
): {
  valid: boolean;
  results: VerificationResult[];
  chainBreaks: number[];
} {
  const results: VerificationResult[] = [];
  const chainBreaks: number[] = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const result = verifyEvent(event, publicKey);

    // Check hash chain link
    const expectedPrevHash = i === 0 ? "0" : events[i - 1].content_hash;
    if (event.prev_hash !== expectedPrevHash) {
      result.valid = false;
      result.errors.push(
        `Chain break at index ${i}: prev_hash ${event.prev_hash.slice(0, 16)}... does not match previous event's content_hash ${expectedPrevHash.slice(0, 16)}...`
      );
      chainBreaks.push(i);
    }

    results.push(result);
  }

  return {
    valid: results.every((r) => r.valid),
    results,
    chainBreaks,
  };
}

// ---------------------------------------------------------------------------
// Canonical JSON serialization
// ---------------------------------------------------------------------------

/**
 * Produce a canonical JSON string with sorted keys and no whitespace.
 * This ensures deterministic hashing regardless of property order.
 */
function canonicalize(obj: unknown): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "string") return JSON.stringify(obj);
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj);

  if (Array.isArray(obj)) {
    const items = obj.map((item) => canonicalize(item));
    return "[" + items.join(",") + "]";
  }

  if (typeof obj === "object") {
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const pairs = keys
      .filter((k) => (obj as Record<string, unknown>)[k] !== undefined)
      .map((k) => JSON.stringify(k) + ":" + canonicalize((obj as Record<string, unknown>)[k]));
    return "{" + pairs.join(",") + "}";
  }

  return String(obj);
}
