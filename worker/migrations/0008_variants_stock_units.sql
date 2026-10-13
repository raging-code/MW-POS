-- 0008: size means size; variants/add-ons get their own kind; stock units;
-- sale lines snapshot category + kind + units at sale time.
--
-- All plain ADD COLUMNs (no table rebuilds), so existing rows and FKs are safe.
-- BACK UP FIRST:  npx wrangler d1 export <DB_NAME> --remote --output backup.sql

-- ── item_sizes: what is this option, and how many physical units is one order?
ALTER TABLE item_sizes ADD COLUMN option_kind TEXT NOT NULL DEFAULT 'size'
  CHECK(option_kind IN ('size','variant','addon'));
ALTER TABLE item_sizes ADD COLUMN stock_units REAL NOT NULL DEFAULT 1;

-- ── sale_items: snapshot so later menu edits can't shift old reports
ALTER TABLE sale_items ADD COLUMN category_name TEXT;
ALTER TABLE sale_items ADD COLUMN option_kind TEXT;
ALTER TABLE sale_items ADD COLUMN stock_units REAL;

-- ── Backfill item_sizes from the categories that used size_name as a
--    flavor / add-on name (this replaces the old CATEGORY_KIND_OVERRIDES).
UPDATE item_sizes SET option_kind = 'variant'
 WHERE item_id IN (
   SELECT mi.id FROM menu_items mi JOIN categories c ON c.id = mi.category_id
    WHERE c.name IN ('Rice Meals', 'Snacks'));

UPDATE item_sizes SET option_kind = 'addon'
 WHERE item_id IN (
   SELECT mi.id FROM menu_items mi JOIN categories c ON c.id = mi.category_id
    WHERE c.name = 'Add-ons');

-- ── Backfill sale_items from the CURRENT menu (best available for history).
--    Lines whose menu item was deleted stay NULL on purpose, so the report
--    keeps them under "Uncategorized / Deleted Items" instead of guessing.
UPDATE sale_items SET category_name = (
  SELECT c.name FROM menu_items mi JOIN categories c ON c.id = mi.category_id
   WHERE mi.id = sale_items.item_id_ref)
 WHERE category_name IS NULL AND item_id_ref IS NOT NULL;

UPDATE sale_items SET option_kind = CASE
    WHEN category_name IN ('Rice Meals', 'Snacks') THEN 'variant'
    WHEN category_name = 'Add-ons' THEN 'addon'
    ELSE 'size' END
 WHERE option_kind IS NULL AND category_name IS NOT NULL;

UPDATE sale_items SET stock_units = 1
 WHERE stock_units IS NULL AND item_id_ref IS NOT NULL;

-- ── Mango Kitkat has two sizes both called "Large". Only touched when the
--    two have different prices: the cheaper one becomes "Regular".
UPDATE item_sizes SET name = 'Regular'
 WHERE name = 'Large'
   AND item_id IN (SELECT id FROM menu_items WHERE name = 'Mango Kitkat')
   AND price = (SELECT MIN(s2.price) FROM item_sizes s2
                 WHERE s2.item_id = item_sizes.item_id AND s2.name = 'Large')
   AND (SELECT COUNT(DISTINCT s3.price) FROM item_sizes s3
         WHERE s3.item_id = item_sizes.item_id AND s3.name = 'Large') > 1;
