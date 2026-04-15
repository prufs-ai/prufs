-- Prufs Cloud Migration 003: audit_log
-- Creates the audit log table for regulated-industry evidence trail.

CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT,
  action      TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'system',
  target_type TEXT,
  target_id   TEXT,
  metadata    JSONB,
  ip_address  TEXT,
  result      TEXT NOT NULL DEFAULT 'success',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_org_id_created_at
  ON audit_log(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action
  ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_category
  ON audit_log(category);
