-- ============================================================
-- Migration 19: Enterprise Multi-Tenancy Foundation
--
-- Adds:
--   • org_id to connections + audit_trail (tenant boundary)
--   • org_id + role + uuid to users (JWT identity)
--   • user_connection_roles table (RBAC)
-- ============================================================

-- ── connections: add org_id tenant column ────────────────────────────────────
ALTER TABLE connections ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_connections_org ON connections(org_id);

-- ── connections: soft-delete support ─────────────────────────────────────────
ALTER TABLE connections ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS deleted_by TEXT;

-- ── users: add org_id, role, and UUID ────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE users ADD COLUMN IF NOT EXISTS role   VARCHAR(32) NOT NULL DEFAULT 'viewer';
-- uuid replaces the SERIAL integer PK as the external identifier
ALTER TABLE users ADD COLUMN IF NOT EXISTS uuid   TEXT;
UPDATE users SET uuid = gen_random_uuid()::TEXT WHERE uuid IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_org_id ON users(org_id);

-- ── audit_trail: add org_id for fast compliance queries ──────────────────────
ALTER TABLE audit_trail ADD COLUMN IF NOT EXISTS org_id TEXT;
CREATE INDEX IF NOT EXISTS idx_audit_org_ts ON audit_trail(org_id, event_timestamp DESC);

-- ── RBAC: per-connection role grants ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_connection_roles (
    id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    user_email    TEXT NOT NULL,
    connection_id TEXT REFERENCES connections(id) ON DELETE CASCADE,
    org_id        TEXT NOT NULL,
    role          VARCHAR(32) NOT NULL,   -- admin | data_engineer | data_steward | viewer
    granted_by    TEXT,
    granted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_email, connection_id)
);
CREATE INDEX IF NOT EXISTS idx_ucr_email ON user_connection_roles(user_email);
CREATE INDEX IF NOT EXISTS idx_ucr_conn  ON user_connection_roles(connection_id);
CREATE INDEX IF NOT EXISTS idx_ucr_org   ON user_connection_roles(org_id);
