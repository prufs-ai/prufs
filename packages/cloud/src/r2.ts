/**
 * @prufs/cloud - R2 blob storage
 *
 * Stores commit JSON and file blobs in Cloudflare R2 using the
 * S3-compatible API. Two key patterns:
 *
 *   commits/{org_id}/{commit_id}.json   Full CausalCommit (blobs stripped)
 *   blobs/{org_id}/{content_hash}       Deduplicated file content
 *
 * Environment variables:
 *   R2_ACCOUNT_ID       - Cloudflare account ID
 *   R2_ACCESS_KEY_ID    - R2 API token access key
 *   R2_SECRET_ACCESS_KEY - R2 API token secret key
 *   R2_BUCKET_NAME      - Bucket name (default: prufs-storage)
 *   R2_ENDPOINT         - Override endpoint (optional, for testing)
 */

import { createHash, createHmac } from 'node:crypto';

// ─── Configuration ──────────────────────────────────────────────────

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  endpoint?: string;
}

export function getR2Config(): R2Config {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME ?? 'prufs-storage';
  const endpoint = process.env.R2_ENDPOINT;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'R2 not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.',
    );
  }

  return { accountId, accessKeyId, secretAccessKey, bucketName, endpoint };
}

export function isR2Configured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY
  );
}

// ─── AWS Signature V4 (minimal, R2-compatible) ─────────────────────

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function getSignatureKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function signRequest(
  method: string,
  url: URL,
  headers: Record<string, string>,
  body: Buffer | string,
  config: R2Config,
): SignedRequest {
  const region = 'auto';
  const service = 's3';
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const payloadHash = sha256Hex(body);

  const signedHeaders: Record<string, string> = {
    ...headers,
    host: url.host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
  };

  const sortedHeaderKeys = Object.keys(signedHeaders).sort();
  const canonicalHeaders = sortedHeaderKeys
    .map((k) => `${k.toLowerCase()}:${signedHeaders[k].trim()}`)
    .join('\n') + '\n';
  const signedHeaderStr = sortedHeaderKeys.map((k) => k.toLowerCase()).join(';');

  const canonicalRequest = [
    method,
    url.pathname,
    url.search?.slice(1) ?? '',
    canonicalHeaders,
    signedHeaderStr,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = getSignatureKey(config.secretAccessKey, dateStamp, region, service);
  const signature = hmacSha256(signingKey, stringToSign).toString('hex');

  const authHeader =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaderStr}, Signature=${signature}`;

  return {
    url: url.toString(),
    headers: {
      ...signedHeaders,
      Authorization: authHeader,
    },
  };
}

// ─── R2 Client ──────────────────────────────────────────────────────

function getEndpoint(config: R2Config): string {
  if (config.endpoint) return config.endpoint;
  return `https://${config.accountId}.r2.cloudflarestorage.com`;
}

export async function putObject(
  config: R2Config,
  key: string,
  body: Buffer | string,
  contentType: string = 'application/octet-stream',
): Promise<{ ok: boolean; status: number }> {
  const endpoint = getEndpoint(config);
  const url = new URL(`/${config.bucketName}/${key}`, endpoint);
  const bodyBuf = typeof body === 'string' ? Buffer.from(body, 'utf-8') : body;

  const signed = signRequest('PUT', url, { 'content-type': contentType }, bodyBuf, config);

  const response = await fetch(signed.url, {
    method: 'PUT',
    headers: signed.headers,
    body: new Uint8Array(bodyBuf),
  });

  return { ok: response.ok, status: response.status };
}

export async function getObject(
  config: R2Config,
  key: string,
): Promise<{ ok: boolean; status: number; body: Buffer | null; contentType: string | null }> {
  const endpoint = getEndpoint(config);
  const url = new URL(`/${config.bucketName}/${key}`, endpoint);

  const signed = signRequest('GET', url, {}, '', config);

  const response = await fetch(signed.url, {
    method: 'GET',
    headers: signed.headers,
  });

  if (!response.ok) {
    return { ok: false, status: response.status, body: null, contentType: null };
  }

  const arrayBuf = await response.arrayBuffer();
  return {
    ok: true,
    status: response.status,
    body: Buffer.from(arrayBuf),
    contentType: response.headers.get('content-type'),
  };
}

export async function headObject(
  config: R2Config,
  key: string,
): Promise<{ exists: boolean; size: number | null }> {
  const endpoint = getEndpoint(config);
  const url = new URL(`/${config.bucketName}/${key}`, endpoint);

  const signed = signRequest('HEAD', url, {}, '', config);

  const response = await fetch(signed.url, {
    method: 'HEAD',
    headers: signed.headers,
  });

  return {
    exists: response.ok,
    size: response.ok
      ? parseInt(response.headers.get('content-length') ?? '0', 10)
      : null,
  };
}

export async function deleteObject(
  config: R2Config,
  key: string,
): Promise<{ ok: boolean; status: number }> {
  const endpoint = getEndpoint(config);
  const url = new URL(`/${config.bucketName}/${key}`, endpoint);

  const signed = signRequest('DELETE', url, {}, '', config);

  const response = await fetch(signed.url, {
    method: 'DELETE',
    headers: signed.headers,
  });

  return { ok: response.ok || response.status === 204, status: response.status };
}

// ─── Prufs-specific storage operations ──────────────────────────────

export async function storeCommitJson(
  config: R2Config,
  orgId: string,
  commitId: string,
  commit: Record<string, unknown>,
): Promise<{ ok: boolean; key: string; sizeBytes: number }> {
  const envelope = structuredClone(commit);
  if (envelope.changeset && typeof envelope.changeset === 'object') {
    const cs = envelope.changeset as { files?: Array<Record<string, unknown>> };
    if (Array.isArray(cs.files)) {
      for (const file of cs.files) {
        delete file.content;
      }
    }
  }

  const json = JSON.stringify(envelope);
  const key = `commits/${orgId}/${commitId}.json`;
  const result = await putObject(config, key, json, 'application/json');
  return { ok: result.ok, key, sizeBytes: Buffer.byteLength(json, 'utf-8') };
}

export async function storeBlob(
  config: R2Config,
  orgId: string,
  contentHash: string,
  content: Buffer,
): Promise<{ ok: boolean; key: string; stored: boolean; sizeBytes: number }> {
  const key = `blobs/${orgId}/${contentHash}`;

  const existing = await headObject(config, key);
  if (existing.exists) {
    return { ok: true, key, stored: false, sizeBytes: existing.size ?? content.length };
  }

  const result = await putObject(config, key, content, 'application/octet-stream');
  return { ok: result.ok, key, stored: true, sizeBytes: content.length };
}

export async function getCommitJson(
  config: R2Config,
  orgId: string,
  commitId: string,
): Promise<Record<string, unknown> | null> {
  const key = `commits/${orgId}/${commitId}.json`;
  const result = await getObject(config, key);
  if (!result.ok || !result.body) return null;
  return JSON.parse(result.body.toString('utf-8'));
}

export async function getBlob(
  config: R2Config,
  orgId: string,
  contentHash: string,
): Promise<Buffer | null> {
  const key = `blobs/${orgId}/${contentHash}`;
  const result = await getObject(config, key);
  return result.ok ? result.body : null;
}

export async function storeCommitBlobs(
  config: R2Config,
  orgId: string,
  changeset: { files: Array<{ content_hash: string; content?: string; change_type: string }> },
): Promise<{ total: number; stored: number; skipped: number; totalBytes: number }> {
  let stored = 0;
  let skipped = 0;
  let totalBytes = 0;

  for (const file of changeset.files) {
    if (file.change_type === 'delete' || !file.content) continue;

    const content = Buffer.from(file.content, 'base64');
    const result = await storeBlob(config, orgId, file.content_hash, content);

    if (result.stored) {
      stored++;
    } else {
      skipped++;
    }
    totalBytes += result.sizeBytes;
  }

  return { total: changeset.files.length, stored, skipped, totalBytes };
}
