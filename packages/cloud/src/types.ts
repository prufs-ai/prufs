/**
 * @prufs/cloud - Shared types
 */

// --- Orgs ---

export interface Org {
  id: string;
  name: string;
  slug: string;
  tier: 'free' | 'pro' | 'enterprise';
  created_at: string;
  updated_at: string;
  settings: Record<string, unknown>;
}

export interface CreateOrgInput {
  name: string;
  slug: string;
  tier?: 'free' | 'pro' | 'enterprise';
}

export interface UpdateOrgInput {
  name?: string;
  tier?: 'free' | 'pro' | 'enterprise';
  settings?: Record<string, unknown>;
}

// --- Users ---

export interface User {
  id: string;
  email: string;
  name: string | null;
  auth_method: 'api_key' | 'saml' | 'oidc';
  created_at: string;
  updated_at: string;
}

export interface CreateUserInput {
  email: string;
  name?: string;
}

// --- Org membership ---

export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface OrgMember {
  org_id: string;
  user_id: string;
  role: OrgRole;
  joined_at: string;
  // Joined from users table
  email?: string;
  name?: string | null;
}

// --- API keys ---

export interface ApiKey {
  id: string;
  org_id: string;
  user_id: string;
  prefix: string;
  name: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

/** Returned only on creation - the raw key is never stored */
export interface ApiKeyWithSecret extends ApiKey {
  raw_key: string;
}

/** Attached to request context after auth */
export interface AuthContext {
  org_id: string;
  user_id: string;
  org_slug: string;
  org_tier: 'free' | 'pro' | 'enterprise';
  role: OrgRole;
}

// --- Signing keys ---

export interface SigningKey {
  id: string;
  org_id: string;
  key_id: string;
  public_key: string;
  label: string | null;
  registered_at: string;
  revoked_at: string | null;
  registered_by: string | null;
}

export interface RegisterSigningKeyInput {
  key_id: string;
  public_key: string;
  label?: string;
}

// --- Meter ---

export interface UsageSummary {
  org_id: string;
  billing_period: string;
  event_count: number;
  tier: string;
  limit: number | null;  // null = unlimited
}

// --- Errors ---

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id: string) {
    super(404, `${entity} not found: ${id}`, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, 'CONFLICT');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(403, message, 'FORBIDDEN');
  }
}

export class RateLimitError extends AppError {
  constructor(remaining: number, limit: number) {
    super(429, `Rate limit exceeded. ${remaining}/${limit} events remaining.`, 'RATE_LIMIT');
  }
}
