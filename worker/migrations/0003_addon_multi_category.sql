-- ============================================================
-- MULTI-CATEGORY ADD-ONS
-- ============================================================
-- Introduces a join table so a single add-on can belong to MANY
-- categories instead of just one. The old `addons.category_id`
-- column is left in place (nullable) for backward compatibility
-- with any in-flight requests during deploy, but is no longer the
-- source of truth once this migration runs — read/write paths
-- should use `addon_categories` going forward.

CREATE TABLE IF NOT EXISTS addon_categories (
  addon_id    TEXT NOT NULL REFERENCES addons(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  PRIMARY KEY (addon_id, category_id)
);

-- Backfill: every add-on that already had a single category_id
-- keeps that assignment as its first (and only, initially) row
-- in the new join table. Add-ons with NULL category_id (global /
-- unassigned) get no rows, same as before.
INSERT INTO addon_categories (addon_id, category_id)
SELECT id, category_id FROM addons WHERE category_id IS NOT NULL;
