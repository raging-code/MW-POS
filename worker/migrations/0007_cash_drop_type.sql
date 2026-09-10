-- Add a type column to cash_drops so the same table can represent both
-- cash removed from the drawer ('drop', the existing behavior) and cash
-- added to the drawer ('cash_in', e.g. change fund top-ups). Existing rows
-- default to 'drop' so historical data keeps its original meaning.
--
-- This is a plain ADD COLUMN (not a CHECK constraint change), so SQLite
-- allows it without rebuilding the table.

ALTER TABLE cash_drops ADD COLUMN type TEXT NOT NULL DEFAULT 'drop' CHECK(type IN ('drop','cash_in'));
