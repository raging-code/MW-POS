// src/types.ts

export type Page =
  | 'pos'
  | 'sales'
  | 'admin_dashboard'
  | 'admin_menu'
  | 'admin_employees'
  | 'admin_inventory'
  | 'admin_settings'
  | 'admin_audit';

export type OrderType = 'dine_in' | 'take_out';
export type DiscountType = 'sc' | 'pwd' | null;
export type PaymentMethod = 'cash' | 'gcash' | 'maya';

// ─── Auth ─────────────────────────────────────────────────────
export interface User {
  id: string;
  name: string;
  role: 'crew' | 'admin';
  is_active: boolean;
}

// ─── Menu ─────────────────────────────────────────────────────
export interface ItemSize {
  id: string;
  name: string;
  price: number;
}

export interface Addon {
  id: string;
  name: string;
  price: number;
  is_available: boolean;
}

export interface MenuItem {
  id: string;
  name: string;
  category_id: string;
  sizes: ItemSize[];
  addons: Addon[];          // still returned by API but not used in creation/editing
  is_active: boolean;
  is_available: boolean;
}

export interface Category {
  id: string;
  name: string;
  sort_order: number;
  items: MenuItem[];
}

// ─── Cart ─────────────────────────────────────────────────────
export interface CartAddon {
  addon_id: string;
  addon_name: string;
  addon_price: number;
  qty: number;
}

export interface CartItem {
  cart_key: string;
  item_id: string;
  item_name: string;
  size_name?: string;
  base_price: number;
  qty: number;
  discount_type: DiscountType;
  discount_pct: number;
  addons: CartAddon[];
  addons_total: number;
  line_subtotal: number;
  discount_amount: number;
  line_total: number;
}

export interface CartState {
  items: CartItem[];
  note: string;
  idempotency_key: string;
}

export interface PaymentLine {
  method: PaymentMethod;
  amount: number;
}

// ─── Sales ────────────────────────────────────────────────────
export interface SaleItemAddon {
  addon_name: string;
  addon_price: number;
  qty: number;
}

export interface SaleItemDetail {
  id: string;
  item_name: string;
  size_name: string | null;
  base_price: number;
  qty: number;
  discount_type: DiscountType;
  discount_pct: number;
  discount_amount: number;
  addons_total: number;
  final_price: number;
  addons: SaleItemAddon[];
}

export type SaleStatus = 'completed' | 'voided' | 'refunded' | 'soft_deleted';
export type SaleType = 'normal' | 'missed';

export interface SaleDetail {
  id: string;
  receipt_number: string;
  cashier_id: string;
  cashier_name: string;
  order_type: OrderType;
  status: SaleStatus;
  sale_type: SaleType;
  total: number;
  discount_total: number;
  subtotal: number;
  created_at: string;
  is_reprinted: boolean;
  shift_id: string | null;
  note: string | null;
  tendered_amount: number | null;
  change_amount: number | null;
  items: SaleItemDetail[];
  payments: PaymentLine[];
}

export interface SaleListItem {
  id: string;
  receipt_number: string;
  status: SaleStatus;
  sale_type: SaleType;
  total: number;
  discount_total: number;
  created_at: string;
  order_type: OrderType;
  is_reprinted: boolean;
}

// ─── Shifts ───────────────────────────────────────────────────
export interface CashDrop {
  id: string;
  amount: number;
  reason: string;
  created_at: string;
}

export interface Shift {
  id: string;
  starting_float: number;
  started_at: string;
  closed_at: string | null;
  closing_cash: number | null;
  payment_totals: Record<string, number>;
  cash_drops: CashDrop[];
}

// ─── Held Orders ──────────────────────────────────────────────
export interface HeldOrder {
  id: string;
  label: string | null;
  data: CartState;
  expires_at: string;
  created_at: string;
}

// ─── Reports ─────────────────────────────────────────────────
export interface SalesReport {
  total_revenue: number;
  transaction_count: number;
  total_discount: number;
  payment_breakdown: Record<string, number>;
}

// ─── Settings ─────────────────────────────────────────────────
export interface Settings {
  store_name: string;
  store_address: string;
  store_contact: string;
  receipt_footer: string;
  sc_discount_pct: string;
  pwd_discount_pct: string;
  [key: string]: string;
}

// ─── Audit Logs ───────────────────────────────────────────────
export interface AuditLog {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  user_name: string;
  reason: string | null;
  new_value: string | null;
  created_at: string;
}