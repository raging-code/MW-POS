-- Widen sale_items.discount_type CHECK constraint to allow the new
-- 15% and 100% discount types ('p15', 'p100') alongside 'sc'/'pwd'.
-- SQLite can't ALTER a CHECK constraint directly, so we rebuild the
-- table (standard 12-step pattern) and restore its index.

PRAGMA foreign_keys=OFF;

CREATE TABLE sale_items_new (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  item_id_ref TEXT,
  item_name TEXT NOT NULL,
  size_name TEXT,
  base_price REAL NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  discount_type TEXT CHECK(discount_type IN ('sc','pwd','p15','p100')),
  discount_pct REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  addons_total REAL NOT NULL DEFAULT 0,
  final_price REAL NOT NULL
);

INSERT INTO sale_items_new
  (id, sale_id, item_id_ref, item_name, size_name, base_price, qty,
   discount_type, discount_pct, discount_amount, addons_total, final_price)
SELECT
  id, sale_id, item_id_ref, item_name, size_name, base_price, qty,
  discount_type, discount_pct, discount_amount, addons_total, final_price
FROM sale_items;

DROP TABLE sale_items;
ALTER TABLE sale_items_new RENAME TO sale_items;

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);

PRAGMA foreign_keys=ON;
