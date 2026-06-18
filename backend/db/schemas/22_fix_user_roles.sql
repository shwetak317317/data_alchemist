-- ============================================================
-- Migration 22: Fix user roles and connection org-id defaults
--
-- Migration 19 added `role` (DEFAULT 'viewer') and `org_id`
-- (DEFAULT 'default') columns. Pre-existing rows ended up with
-- those sentinel values, which block connection management.
--
-- Part A — promote viewer users:
--   • First user per org (lowest id)  → 'admin'
--   • All other existing 'viewer' users → 'data_engineer'
--
-- Part B — re-home orphaned connections:
--   Any connection with org_id='default' is migrated to the
--   org of the first admin (or any non-default) user. This
--   covers connections created before the org_id column existed
--   and the demo connection seeded without an explicit org.
-- ============================================================

-- Part A: fix roles
WITH ranked AS (
    SELECT email,
           ROW_NUMBER() OVER (PARTITION BY org_id ORDER BY id ASC) AS rn
    FROM users
    WHERE role = 'viewer'
)
UPDATE users
SET    role = CASE WHEN r.rn = 1 THEN 'admin' ELSE 'data_engineer' END
FROM   ranked r
WHERE  users.email = r.email;

-- Part B: migrate orphaned connections to the first non-default user's org
UPDATE connections
SET    org_id = (
           SELECT org_id
           FROM   users
           WHERE  org_id != 'default'
           ORDER  BY id ASC
           LIMIT  1
       )
WHERE  org_id = 'default'
AND    EXISTS (SELECT 1 FROM users WHERE org_id != 'default');
