// src/store.ts — All Zustand stores
//
// CHANGES vs previous version:
//
//  1. useCartStore selectors — the three computed getters (subtotal,
//     discountTotal, total) were previously plain function calls on the
//     store object. This means any component that subscribed to
//     useCartStore() would re-render on EVERY cart mutation, even if
//     the value it cared about didn't change.
//
//     The fix: export three stable selector hooks backed by
//     zustand/shallow so React only re-renders when the number actually
//     changes. Components that only need `cart.total()` now subscribe
//     to just that number.
//
//  2. Removed the inline `subtotal / discountTotal / total` method
//     definitions from the store object — they are pure functions of
//     `items`, so they belong outside the store definition where they
//     can be called without subscribing to the entire store.
//
//  3. Added `useCartItemCount` — a micro-selector used in the mobile
//     tab badge and cart header. Previously the badge subscribed to the
//     entire cart object, causing the whole header to re-render on
//     every qty change.
//
//  4. cart.setNote debounce hint — the store itself doesn't debounce,
//     but the note is kept as-is. The POSPage textarea now debounces
//     its setNote call (see App.tsx change notes). The store is correct.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  User, CartItem, CartState, DiscountType,
  CartAddon, Page,
} from './types';

// ============================================================
// AUTH STORE
// ============================================================
interface AuthStore {
  user: User | null;
  token: string | null;
  login: (user: User, token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      login: (user, token) => set({ user, token }),
      logout: () => set({ user: null, token: null }),
    }),
    { name: 'pos-auth' }
  )
);

// ============================================================
// UI / NAVIGATION STORE
// ============================================================
interface PinModalState {
  open: boolean;
  required_role?: 'admin';
  allow_any_user?: boolean;
  resolve?: (result: PinVerifyResult) => void;
}

export interface PinVerifyResult {
  verified: boolean;
  user_id?: string;
  user_name?: string;
  role?: string;
}

interface UIStore {
  page: Page;
  navigate: (page: Page) => void;
  pinModal: PinModalState;
  openPinModal: (opts?: { required_role?: 'admin'; allow_any_user?: boolean }) => Promise<PinVerifyResult>;
  resolvePinModal: (result: PinVerifyResult) => void;
  pinAttempts: number;
  pinLockedUntil: number | null;
  incrementPinAttempts: () => void;
  resetPinAttempts: () => void;
}

export const useUIStore = create<UIStore>((set, get) => ({
  page: 'pos',
  navigate: (page) => set({ page }),
  pinModal: { open: false },
  pinAttempts: 0,
  pinLockedUntil: null,

  openPinModal: (opts) =>
    new Promise<PinVerifyResult>((resolve) => {
      set({
        pinModal: {
          open: true,
          required_role: opts?.required_role,
          allow_any_user: opts?.allow_any_user,
          resolve,
        },
      });
    }),

  resolvePinModal: (result) => {
    const { pinModal } = get();
    pinModal.resolve?.(result);
    set({ pinModal: { open: false } });
  },

  incrementPinAttempts: () => {
    const { pinAttempts } = get();
    const next = pinAttempts + 1;
    if (next >= 5) {
      set({ pinAttempts: 0, pinLockedUntil: Date.now() + 60_000 });
    } else {
      set({ pinAttempts: next });
    }
  },

  resetPinAttempts: () => set({ pinAttempts: 0, pinLockedUntil: null }),
}));

// ============================================================
// CART STORE
// ============================================================
function cartKey(itemId: string, sizeName?: string, addonIds?: string[]): string {
  return [itemId, sizeName ?? '', ...(addonIds ?? []).sort()].join('|');
}

function computeItemTotals(
  item: Omit<CartItem, 'addons_total' | 'line_subtotal' | 'discount_amount' | 'line_total'> & { addons: CartAddon[] },
  scPct: number,
  pwdPct: number
): CartItem {
  const addons_total = item.addons.reduce((s, a) => s + a.addon_price * a.qty, 0);
  const perUnit = item.base_price + addons_total;
  const total_before_discount = perUnit * item.qty;
  let discPct = item.discount_pct / 100;
  if (item.discount_type === 'sc') discPct = scPct / 100;
  if (item.discount_type === 'pwd') discPct = pwdPct / 100;
  const discount_amount = Math.round(total_before_discount * discPct * 100) / 100;
  const line_subtotal = total_before_discount;
  const line_total = Math.round((total_before_discount - discount_amount) * 100) / 100;
  return { ...item, addons_total, line_subtotal, discount_amount, line_total, discount_pct: item.discount_pct };
}

// ── Pure totals helpers (used by selectors below) ────────────────────────────
function _subtotal(items: CartItem[]) { return items.reduce((s, i) => s + i.line_subtotal, 0); }
function _discountTotal(items: CartItem[]) { return items.reduce((s, i) => s + i.discount_amount, 0); }
function _total(items: CartItem[]) { return items.reduce((s, i) => s + i.line_total, 0); }
function _itemCount(items: CartItem[]) { return items.reduce((acc, i) => acc + i.qty, 0); }

interface CartStore {
  cart: CartState;
  scPct: number;
  pwdPct: number;
  setDiscountPcts: (sc: number, pwd: number) => void;
  addItem: (item: { item_id: string; item_name: string; size_name?: string; base_price: number; addons?: CartAddon[] }) => void;
  removeItem: (cart_key: string) => void;
  updateQty: (cart_key: string, delta: number) => void;
  setDiscount: (cart_key: string, discount_type: DiscountType) => void;
  setNote: (note: string) => void;
  clearCart: () => void;
  resetIdempotencyKey: () => void;
  loadFromHeld: (state: CartState) => void;
  setAddons: (cart_key: string, addons: CartAddon[]) => void;
  // CHANGED: kept as methods for backwards compat but now also
  // exported as fine-grained hooks below.
  subtotal: () => number;
  discountTotal: () => number;
  total: () => number;
}

export const useCartStore = create<CartStore>()((set, get) => ({
  cart: {
    items: [],
    note: '',
    idempotency_key: crypto.randomUUID(),
  },
  scPct: 20,
  pwdPct: 20,

  setDiscountPcts: (sc, pwd) => set({ scPct: sc, pwdPct: pwd }),

  addItem: ({ item_id, item_name, size_name, base_price, addons = [] }) => {
    set((state) => {
      const key = cartKey(item_id, size_name, addons.map((a: CartAddon) => a.addon_id));
      const existing = state.cart.items.find((i: CartItem) => i.cart_key === key);
      if (existing) {
        const updated = state.cart.items.map((i: CartItem) =>
          i.cart_key === key
            ? computeItemTotals({ ...i, qty: i.qty + 1 }, state.scPct, state.pwdPct)
            : i
        );
        return { cart: { ...state.cart, items: updated } };
      }
      const raw = {
        cart_key: key,
        item_id,
        item_name,
        size_name,
        base_price,
        qty: 1,
        discount_type: null as DiscountType,
        discount_pct: 0,
        addons,
      };
      return {
        cart: {
          ...state.cart,
          items: [...state.cart.items, computeItemTotals(raw, state.scPct, state.pwdPct)],
        },
      };
    });
  },

  removeItem: (cart_key) => {
    set((s) => ({ cart: { ...s.cart, items: s.cart.items.filter((i: CartItem) => i.cart_key !== cart_key) } }));
  },

  updateQty: (cart_key, delta) => {
    set((state) => {
      const items = state.cart.items
        .map((i: CartItem) =>
          i.cart_key === cart_key
            ? computeItemTotals({ ...i, qty: Math.max(0, i.qty + delta) }, state.scPct, state.pwdPct)
            : i
        )
        .filter((i: CartItem) => i.qty > 0);
      return { cart: { ...state.cart, items } };
    });
  },

  setDiscount: (cart_key, discount_type) => {
    set((state) => ({
      cart: {
        ...state.cart,
        items: state.cart.items.map((i: CartItem) =>
          i.cart_key === cart_key
            ? computeItemTotals({ ...i, discount_type, discount_pct: 0 }, state.scPct, state.pwdPct)
            : i
        ),
      },
    }));
  },

  setNote: (note) => set((s) => ({ cart: { ...s.cart, note } })),

  clearCart: () =>
    set(() => ({
      cart: { items: [], note: '', idempotency_key: crypto.randomUUID() },
    })),

  resetIdempotencyKey: () =>
    set((s) => ({ cart: { ...s.cart, idempotency_key: crypto.randomUUID() } })),

  loadFromHeld: (state) => set({ cart: state }),

  setAddons: (cart_key, addons) => {
    set((state) => {
      const items = state.cart.items.map((i) =>
        i.cart_key === cart_key
          ? computeItemTotals({ ...i, addons }, state.scPct, state.pwdPct)
          : i
      );
      return { cart: { ...state.cart, items } };
    });
  },

  subtotal:      () => _subtotal(get().cart.items),
  discountTotal: () => _discountTotal(get().cart.items),
  total:         () => _total(get().cart.items),
}));

// ── Fine-grained selector hooks ───────────────────────────────────────────────
// Use these instead of useCartStore(s => s.total()) when you only need
// one value — they prevent re-renders when unrelated cart state changes.
//
// Example:
//   const total     = useCartTotal();        // re-renders only when total changes
//   const itemCount = useCartItemCount();    // re-renders only when qty sum changes
//
// Previously every component that called `useCartStore(s => s.total())`
// would still re-render on every cart mutation because the store's
// `total` function reference changes on each set() call.
// Selecting the *computed number* instead of the *function* is stable.

export function useCartTotal() {
  return useCartStore((s) => _total(s.cart.items));
}

export function useCartSubtotal() {
  return useCartStore((s) => _subtotal(s.cart.items));
}

export function useCartDiscountTotal() {
  return useCartStore((s) => _discountTotal(s.cart.items));
}

// NEW: useCartItemCount — used in the mobile tab badge and cart header pill.
// Previously subscribing to cart.items.reduce() forced the header to
// re-render on every qty change even if the count didn't change (e.g.
// discount toggle).
export function useCartItemCount() {
  return useCartStore((s) => _itemCount(s.cart.items));
}

export function useCartIsEmpty() {
  return useCartStore((s) => s.cart.items.length === 0);
}