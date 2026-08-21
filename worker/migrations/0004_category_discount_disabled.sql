-- Add a per-category flag to disable SC/PWD/manual discounts
-- on all items in that category.
ALTER TABLE categories ADD COLUMN discount_disabled INTEGER NOT NULL DEFAULT 0;
