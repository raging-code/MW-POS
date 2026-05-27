// src/types.ts — All application types

// ─── Auth ────────────────────────────────────────────────────
export type Role = 'crew' | 'admin'

export interface User {
  id: string
  name: string
  role: Role
}

export interface AuthState {
  user: User | null
  token: string | null
}

// ─── Menu ────────────────────────────────────────────────────
export interface Addon {
  id: string
  name: string
  price: number
  is_available: boolean
}

export interface ItemSize {
  id: string
  item_id: string
  name: string
  price: number
}

export interface MenuItem {
  id: string
  name: string
  category_id: string | null
  is_active: boolean
  is_available: boolean
  created_at: string
  sizes: ItemSize[]
  addons: Addon[]
}

export interface Category {
  id: string
  name: string
  sort_order: number
  items: MenuItem[]
}

// ─── Cart / Order ─────────────────────────────────────────────
export type DiscountType = 'sc' | 'pwd' | null

export interface CartAddon {
  addon_id: string
  addon_name: string
  addon_price: number
  qty: number
}

export interface CartItem {
  cart_key: string          // unique key per line (item+size+addons)
  item_id: string
  item_name: string
  size_name?: string
  base_price: number
  qty: number
  discount_type: DiscountType
  discount_pct: number      // 0-100
  addons: CartAddon[]
  // Computed fields (derived in store)
  addons_total: number
  line_subtotal: number
  discount_amount: number
  line_total: number
}

export type OrderType = 'dine_in' | 'take_out'

export interface CartState {
  items: CartItem[]
  order_type: OrderType
  note: string
  idempotency_key: string
}

// ─── Payments ────────────────────────────────────────────────
export type PaymentMethod = 'cash' | 'gcash' | 'maya'

export interface PaymentLine {
  method: PaymentMethod
  amount: number
}

// ─── Sales ───────────────────────────────────────────────────
export type SaleStatus = 'completed' | 'voided' | 'refunded' | 'soft_deleted'
export type SaleType = 'normal' | 'missed'

export interface SaleListItem {
  id: string
  receipt_number: string
  cashier_id: string
  order_type: OrderType
  status: SaleStatus
  sale_type: SaleType
  total: number
  discount_total: number
  subtotal: number
  created_at: string
  is_reprinted: boolean
}

export interface SaleDetail extends SaleListItem {
  cashier_name: string
  shift_id: string | null
  note: string | null
  tendered_amount: number | null
  change_amount: number | null
  items: SaleItemDetail[]
  payments: PaymentLine[]
}

export interface SaleItemDetail {
  id: string
  item_name: string
  size_name: string | null
  base_price: number
  qty: number
  discount_type: DiscountType
  discount_pct: number
  discount_amount: number
  addons_total: number
  final_price: number
  addons: { addon_name: string; addon_price: number; qty: number }[]
}

// ─── Shift ───────────────────────────────────────────────────
export interface Shift {
  id: string
  cashier_id: string
  started_at: string
  closed_at: string | null
  starting_float: number
  closing_cash: number | null
  status: 'open' | 'closed'
  opened_by: string
  notes: string | null
  cash_drops: CashDrop[]
  payment_totals: Record<string, number>
}

export interface CashDrop {
  id: string
  shift_id: string
  user_id: string
  amount: number
  reason: string
  created_at: string
}

// ─── Held Orders ──────────────────────────────────────────────
export interface HeldOrder {
  id: string
  created_by: string
  data: CartState
  expires_at: string
  label: string | null
  created_at: string
}

// ─── Time Logs ───────────────────────────────────────────────
export interface TimeLog {
  id: string
  user_id: string
  user_name: string
  clock_in: string
  clock_out: string | null
  edited_by: string | null
  edit_reason: string | null
}

// ─── Reports ─────────────────────────────────────────────────
export interface SalesReport {
  total_revenue: number
  total_discount: number
  transaction_count: number
  payment_breakdown: Record<string, number>
  sales: SaleListItem[]
}

export interface WorkHoursReport {
  summary: {
    user_id: string
    user_name: string
    total_minutes: number
    total_hours: number
    estimated_salary: number
  }[]
  logs: TimeLog[]
  hourly_rate: number
}

// ─── Inventory ───────────────────────────────────────────────
export interface InventoryItem {
  id: string
  name: string
  unit: string
  current_stock: number
}

export interface InventoryTransaction {
  id: string
  item_id: string
  type: 'stock_in' | 'stock_out' | 'wastage'
  qty: number
  cost: number | null
  reason: string | null
  created_at: string
  user_name: string
}

// ─── Settings ────────────────────────────────────────────────
export type Settings = Record<string, string>

// ─── Audit ───────────────────────────────────────────────────
export interface AuditLog {
  id: string
  action: string
  entity_type: string
  entity_id: string | null
  old_value: string | null
  new_value: string | null
  reason: string | null
  created_at: string
  user_name: string
}

// ─── UI Navigation ───────────────────────────────────────────
export type Page =
  | 'login'
  | 'pos'
  | 'sales'
  | 'employee'
  | 'admin_dashboard'
  | 'admin_menu'
  | 'admin_employees'
  | 'admin_inventory'
  | 'admin_settings'
  | 'admin_audit'

// ─── API Response wrapper ─────────────────────────────────────
export interface ApiResponse<T> {
  data: T | null
  error: string | null
}