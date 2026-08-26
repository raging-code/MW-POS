-- Widen sale_items.discount_type CHECK constraint to allow the new
-- flat ₱10 discount type ('p10') alongside 'sc'/'pwd'/'p15'/'p100'.
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
