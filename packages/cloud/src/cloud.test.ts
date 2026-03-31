/**
 * @prufs/cloud - API key unit tests
 *
 * Tests key generation, hashing, and prefix extraction.
 * These are pure-function tests - no database required.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateRawKey, hashKey, extractPrefix } from './models/api-keys.js';

describe('API key generation', () => {
  it('generates a key with prfs_ prefix', () => {
    const key = generateRawKey();
    assert.ok(key.startsWith('prfs_'), `Key should start with prfs_: ${key}`);
  });

  it('generates a key of consistent length', () => {
    const key = generateRawKey();
    // prfs_ (5) + 64 hex chars (32 bytes) = 69
    assert.equal(key.length, 69, `Key length should be 69: got ${key.length}`);
  });

  it('generates unique keys', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) {
      keys.add(generateRawKey());
    }
    assert.equal(keys.size, 100, 'All 100 generated keys should be unique');
  });

  it('contains only valid hex characters after prefix', () => {
    const key = generateRawKey();
    const hexPart = key.slice(5);
    assert.match(hexPart, /^[0-9a-f]+$/, 'Hex portion should be lowercase hex');
  });
});

describe('API key hashing', () => {
  it('produces a 64-char hex hash', () => {
    const hash = hashKey('prfs_test1234');
    assert.equal(hash.length, 64, 'SHA-256 hash should be 64 hex chars');
    assert.match(hash, /^[0-9a-f]+$/);
  });

  it('is deterministic', () => {
    const key = 'prfs_abc123def456';
    const hash1 = hashKey(key);
    const hash2 = hashKey(key);
    assert.equal(hash1, hash2, 'Same input should produce same hash');
  });

  it('different keys produce different hashes', () => {
    const hash1 = hashKey('prfs_aaaa');
    const hash2 = hashKey('prfs_bbbb');
    assert.notEqual(hash1, hash2, 'Different keys should produce different hashes');
  });
});

describe('API key prefix extraction', () => {
  it('extracts prefix of correct length', () => {
    const key = generateRawKey();
    const prefix = extractPrefix(key);
    // prfs_ (5) + 8 hex chars = 13
    assert.equal(prefix.length, 13, `Prefix should be 13 chars: got ${prefix.length}`);
  });

  it('prefix starts with prfs_', () => {
    const key = generateRawKey();
    const prefix = extractPrefix(key);
    assert.ok(prefix.startsWith('prfs_'));
  });

  it('prefix is a substring of the key', () => {
    const key = generateRawKey();
    const prefix = extractPrefix(key);
    assert.ok(key.startsWith(prefix), 'Prefix should be the start of the key');
  });
});

describe('Slug validation', async () => {
  const { validateSlug } = await import('./models/orgs.js');

  it('accepts valid slugs', () => {
    assert.ok(validateSlug('my-org'));
    assert.ok(validateSlug('prufs-cloud'));
    assert.ok(validateSlug('abc'));
    assert.ok(validateSlug('a1b2c3'));
    assert.ok(validateSlug('test-org-123'));
  });

  it('rejects invalid slugs', () => {
    assert.ok(!validateSlug(''), 'empty');
    assert.ok(!validateSlug('ab'), 'too short');
    assert.ok(!validateSlug('-bad'), 'starts with hyphen');
    assert.ok(!validateSlug('bad-'), 'ends with hyphen');
    assert.ok(!validateSlug('My-Org'), 'uppercase');
    assert.ok(!validateSlug('has spaces'), 'spaces');
    assert.ok(!validateSlug('has_underscores'), 'underscores');
  });
});

describe('Signing key validation', async () => {
  const { validatePublicKey } = await import('./models/signing-keys.js');

  it('accepts valid 64-char hex key', () => {
    const validKey = 'a'.repeat(64);
    assert.ok(validatePublicKey(validKey));
  });

  it('accepts mixed hex chars', () => {
    assert.ok(validatePublicKey('0123456789abcdef'.repeat(4)));
  });

  it('rejects wrong length', () => {
    assert.ok(!validatePublicKey('abcd'));
    assert.ok(!validatePublicKey('a'.repeat(63)));
    assert.ok(!validatePublicKey('a'.repeat(65)));
  });

  it('rejects non-hex characters', () => {
    assert.ok(!validatePublicKey('g'.repeat(64)));
    assert.ok(!validatePublicKey('Z'.repeat(64)));
  });
});
