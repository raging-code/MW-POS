// fix-0006-migration-fk.mjs
//
// Fixes the FOREIGN KEY constraint failure hit when running
// `npm run db:migrate:remote` against 0006_discount_type_p10.sql.
//
// ROOT CAUSE (confirmed by testing against real SQLite with FK
// enforcement on, using a populated sale_items + sale_item_addons
// pair):
//
//   The original migration rebuilt ONLY sale_items (create
//   sale_items_new -> copy -> drop old -> rename). That alone isn't
//   enough, because SQLite's ALTER TABLE ... RENAME automatically
//   rewrites foreign key references in *other* tables to follow the
//   rename. So the instant sale_items is renamed to sale_items_old,
//   sale_item_addons.sale_item_id silently gets repointed at
//   "sale_items_old" instead of "sale_items". When sale_items_old is
//   dropped at the end of the migration, sale_item_addons is left
//   referencing a table that no longer exists -> FK violation.
//
//   This is true regardless of drop-first vs rename-first ordering,
//   and independent of whether PRAGMA foreign_keys=OFF is honored by
//   D1 -- the dangling reference is created by SQLite's own rename
//   behavior, not by a mid-migration window where the table is
//   briefly missing.
//
// FIX: rebuild sale_items AND sale_item_addons together in the same
// migration, so sale_item_addons_new's FK is declared against the
// NEW sale_items_new table explicitly, then rename both into place
// at the end. Verified against a populated local SQLite DB with
// PRAGMA foreign_keys=ON and PRAGMA foreign_key_check afterward.
//
// Usage (run from worker/ directory, where wrangler.toml lives):
//   node ../fix-0006-migration-fk.mjs
//
// This only rewrites worker/migrations/0006_discount_type_p10.sql.
// No other files are touched. After running, re-apply:
//   npm run db:migrate:local
//   npm run db:migrate:remote

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_PATH = join("migrations", "0006_discount_type_p10.sql");

const FIXED_SQL = `-- Widen sale_items.discount_type CHECK constraint to allow the new
-- flat \u20B110 discount type ('p10') alongside 'sc'/'pwd'/'p15'/'p100'.
--
-- SQLite can't ALTER a CHECK constraint directly, so we rebuild the
-- table. sale_item_addons.sale_item_id REFERENCES sale_items(id), and
-- SQLite's ALTER TABLE ... RENAME auto-updates FK references in OTHER
-- tables to follow a rename -- so rebuilding sale_items alone (even
-- rename-first) leaves sale_item_addons pointing at a dropped table.
-- Both tables must be rebuilt together in one migration, with
-- sale_item_addons_new's FK declared against sale_items_new.

CREATE TABLE sale_items_new (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  item_id_ref TEXT,
  item_name TEXT NOT NULL,
  size_name TEXT,
  base_price REAL NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  discount_type TEXT CHECK(discount_type IN ('sc','pwd','p15','p100','p10')),
  discount_pct REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  addons_total REAL NOT NULL DEFAULT 0,
  final_price REAL NOT NULL
);

CREATE TABLE sale_item_addons_new (
  id TEXT PRIMARY KEY,
  sale_item_id TEXT NOT NULL REFERENCES sale_items_new(id),
  addon_id_ref TEXT,
  addon_name TEXT NOT NULL,
  addon_price REAL NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1
);

INSERT INTO sale_items_new
  (id, sale_id, item_id_ref, item_name, size_name, base_price, qty,
   discount_type, discount_pct, discount_amount, addons_total, final_price)
SELECT
  id, sale_id, item_id_ref, item_name, size_name, base_price, qty,
  discount_type, discount_pct, discount_amount, addons_total, final_price
FROM sale_items;

INSERT INTO sale_item_addons_new
  (id, sale_item_id, addon_id_ref, addon_name, addon_price, qty)
SELECT
  id, sale_item_id, addon_id_ref, addon_name, addon_price, qty
FROM sale_item_addons;

DROP TABLE sale_item_addons;
DROP TABLE sale_items;

ALTER TABLE sale_items_new RENAME TO sale_items;
ALTER TABLE sale_item_addons_new RENAME TO sale_item_addons;

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
`;

function main() {
  if (!existsSync(MIGRATION_PATH)) {
    console.error(`ERROR: ${MIGRATION_PATH} not found.`);
    console.error("Run this script from the worker/ directory (where wrangler.toml lives).");
    process.exit(1);
  }

  const current = readFileSync(MIGRATION_PATH, "utf8");

  if (current.trim() === FIXED_SQL.trim()) {
    console.log("0006_discount_type_p10.sql already matches the fixed version. Nothing to do.");
    return;
  }

  writeFileSync(MIGRATION_PATH, FIXED_SQL, "utf8");
  console.log(`Fixed: ${MIGRATION_PATH}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. npm run db:migrate:local   (sanity check locally first)");
  console.log("  2. npm run db:migrate:remote  (then apply to production)");
}

main();
