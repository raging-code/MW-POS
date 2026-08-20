-- ============================================================
-- ADD CATEGORY-SCOPED ADD-ONS
-- ============================================================
-- Adds a nullable category_id to addons so each category can have
-- its own add-on set. Existing add-ons keep category_id = NULL
-- (treated as unassigned/global) until reassigned via the UI.
ALTER TABLE addons ADD COLUMN category_id TEXT REFERENCES categories(id);
