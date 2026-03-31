-- Prufs Cloud Platform - Initial Schema
-- Migration 001: Core tables for org management, auth, commit storage, metering
-- Compatible with: Neon, standard Postgres 14+
-- Run: psql $DATABASE_URL -f 001_initial.sql

BEGIN;

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()

-- =============================================================================
-- Organizations
-- =============================================================================

CREATE TABLE orgs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    slug        TEXT UNIQUE NOT NULL,
    tier        TEXT NOT NULL DEFAULT 'free'
                CHECK (tier IN ('free', 'pro', 'enterprise')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settings    JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_orgs_slug ON orgs(slug);

-- =============================================================================
-- Users
-- =============================================================================

CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT UNIQUE NOT NULL,
    name        TEXT,
    auth_method TEXT NOT NULL DEFAULT 'api_key'
                CHECK (auth_method IN ('api_key', 'saml', 'oidc')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

-- =============================================================================
-- Org membership (join table)
-- =============================================================================

CREATE TABLE org_members (
    org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'member'
                CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_id, user_id)
);

CREATE INDEX idx_org_members_user ON org_members(user_id);

-- =============================================================================
-- API keys (authentication tokens)
-- =============================================================================

CREATE TABLE api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_hash    TEXT NOT NULL,
    prefix      TEXT NOT NULL,           -- first 8 chars, e.g. "prfs_abc"
    name        TEXT,                    -- human label
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    expires_at  TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_prefix ON api_keys(prefix);
CREATE INDEX idx_api_keys_org ON api_keys(org_id);

-- =============================================================================
-- Ed25519 signing keys (registered per org for commit verification)
-- =============================================================================

CREATE TABLE signing_keys (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    key_id        TEXT NOT NULL,          -- matches signer_key_id in CausalCommit
    public_key    TEXT NOT NULL,          -- hex-encoded Ed25519 public key
    label         TEXT,                   -- human-friendly name
    registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at    TIMESTAMPTZ,
    registered_by UUID REFERENCES users(id),
    UNIQUE (org_id, key_id)
);

CREATE INDEX idx_signing_keys_org ON signing_keys(org_id);

-- =============================================================================
-- Commits (lightweight index - full commit JSON goes to S3/R2)
-- =============================================================================

CREATE TABLE commits (
    commit_id    TEXT PRIMARY KEY,
    org_id       UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    parent_hash  TEXT NOT NULL,
    branch       TEXT NOT NULL DEFAULT 'main',
    agent_id     TEXT,
    message      TEXT,
    timestamp    TIMESTAMPTZ NOT NULL,
    verified_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    size_bytes   INTEGER,
    signer_key_id TEXT
);

CREATE INDEX idx_commits_org_branch ON commits(org_id, branch, timestamp DESC);
CREATE INDEX idx_commits_parent ON commits(parent_hash);
CREATE INDEX idx_commits_org ON commits(org_id);

-- =============================================================================
-- Branch heads (per org, per branch)
-- =============================================================================

CREATE TABLE branch_heads (
    org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    branch      TEXT NOT NULL,
    commit_id   TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_id, branch)
);

-- =============================================================================
-- Merge log
-- =============================================================================

CREATE TABLE merge_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    branch          TEXT NOT NULL,
    source_commits  TEXT[] NOT NULL,
    strategy        TEXT NOT NULL
                    CHECK (strategy IN ('disjoint', 'lww', 'human_gate')),
    outcome         TEXT NOT NULL
                    CHECK (outcome IN ('merged', 'pending_human', 'failed')),
    detail          JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_merge_log_org ON merge_log(org_id, created_at DESC);

-- =============================================================================
-- Rejected commits (Enterprise audit trail)
-- =============================================================================

CREATE TABLE rejected_commits (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    commit_payload    JSONB NOT NULL,
    rejection_reason  TEXT NOT NULL,
    rejection_step    TEXT NOT NULL,
    received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rejected_org ON rejected_commits(org_id, received_at DESC);

-- =============================================================================
-- Meter log (event counting for billing)
-- =============================================================================

CREATE TABLE meter_log (
    id              BIGSERIAL PRIMARY KEY,
    org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    event_type      TEXT NOT NULL,        -- 'commit_push'
    commit_id       TEXT,
    billing_period  TEXT NOT NULL,        -- '2026-04'
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_meter_org_period ON meter_log(org_id, billing_period);

-- =============================================================================
-- Audit log (Enterprise - tracks admin actions)
-- =============================================================================

CREATE TABLE audit_log (
    id          BIGSERIAL PRIMARY KEY,
    org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id),
    action      TEXT NOT NULL,            -- 'key.register', 'member.invite', etc.
    target_type TEXT,                     -- 'signing_key', 'user', 'org'
    target_id   TEXT,
    detail      JSONB,
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_org ON audit_log(org_id, created_at DESC);

-- =============================================================================
-- updated_at trigger function
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orgs_updated_at
    BEFORE UPDATE ON orgs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;
