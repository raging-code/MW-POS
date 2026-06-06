-- ============================================================
-- USERS & SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('crew','admin')),
  pin_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pin_attempts (
  identifier TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- MENU
-- ============================================================
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS menu_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_available INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS item_sizes (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS addons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  is_available INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS item_addons (
  item_id TEXT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  addon_id TEXT NOT NULL REFERENCES addons(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, addon_id)
);

-- ============================================================
-- SHIFTS
-- ============================================================
CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  cashier_id TEXT NOT NULL REFERENCES users(id),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  starting_float REAL NOT NULL DEFAULT 0,
  closing_cash REAL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  opened_by TEXT NOT NULL REFERENCES users(id),
  closed_by TEXT REFERENCES users(id),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS cash_drops (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL REFERENCES shifts(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  amount REAL NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- HELD ORDERS
-- ============================================================
CREATE TABLE IF NOT EXISTS held_orders (
  id TEXT PRIMARY KEY,
  created_by TEXT NOT NULL REFERENCES users(id),
  data_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- SALES (IMMUTABLE SNAPSHOT RECORDS)
-- ============================================================
CREATE TABLE IF NOT EXISTS receipt_counters (
  date_key TEXT PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  receipt_number TEXT NOT NULL UNIQUE,
  shift_id TEXT REFERENCES shifts(id),
  cashier_id TEXT NOT NULL REFERENCES users(id),
  order_type TEXT NOT NULL CHECK(order_type IN ('dine_in','take_out')),
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK(status IN ('completed','voided','refunded','soft_deleted')),
  sale_type TEXT NOT NULL DEFAULT 'normal' CHECK(sale_type IN ('normal','missed')),
  note TEXT,
  subtotal REAL NOT NULL,
  discount_total REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  tendered_amount REAL,
  change_amount REAL,
  idempotency_key TEXT NOT NULL UNIQUE,
  is_reprinted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  item_id_ref TEXT,
  item_name TEXT NOT NULL,
  size_name TEXT,
  base_price REAL NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  discount_type TEXT CHECK(discount_type IN ('sc','pwd')),
  discount_pct REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  addons_total REAL NOT NULL DEFAULT 0,
  final_price REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS sale_item_addons (
  id TEXT PRIMARY KEY,
  sale_item_id TEXT NOT NULL REFERENCES sale_items(id),
  addon_id_ref TEXT,
  addon_name TEXT NOT NULL,
  addon_price REAL NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sale_payments (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  method TEXT NOT NULL CHECK(method IN ('cash','gcash','maya')),
  amount REAL NOT NULL
);

-- ============================================================
-- AUDIT LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- SETTINGS & INVENTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  current_stock REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES inventory_items(id),
  type TEXT NOT NULL CHECK(type IN ('stock_in','stock_out','wastage')),
  qty REAL NOT NULL,
  cost REAL,
  reason TEXT,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_sessions_token       ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user        ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sales_receipt        ON sales(receipt_number);
CREATE INDEX IF NOT EXISTS idx_sales_created        ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_shift          ON sales(shift_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale      ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_payments_sale   ON sale_payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity         ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_user           ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_held_orders_expiry   ON held_orders(expires_at);
CREATE INDEX IF NOT EXISTS idx_menu_items_category  ON menu_items(category_id);

-- ============================================================
-- DEFAULT SYSTEM SETTINGS
-- ============================================================
INSERT OR IGNORE INTO system_settings(key, value) VALUES
  ('sc_discount_pct',   '20'),
  ('pwd_discount_pct',  '20'),
  ('store_name',        'MangoWarrior'),
  ('store_address',     '123 Mango St, Dasmariñas, Cavite'),
  ('store_contact',     '09XX-XXX-XXXX'),
  ('receipt_footer',    'Thank you for visiting MangoWarrior!'),
  ('timezone',          'Asia/Manila');