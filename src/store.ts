// src/store.ts — All Zustand stores

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
interface UIStore {
  page: Page;
  navigate: (page: Page) => void;
  pinModal: {
    open: boolean;
    required_role?: 'admin';
    resolve?: (verified: boolean) => void;
  };
  openPinModal: (opts?: { required_role?: 'admin' }) => Promise<boolean>;
  resolvePinModal: (verified: boolean) => void;
}

export const useUIStore = create<UIStore>((set, get) => ({
  page: 'pos',
  navigate: (page) => set({ page }),
  pinModal: { open: false },
  openPinModal: (opts) =>
    new Promise<boolean>((resolve) => {
      set({ pinModal: { open: true, required_role: opts?.required_role, resolve } });
    }),
  resolvePinModal: (verified) => {
    const { pinModal } = get();
    pinModal.resolve?.(verified);
    set({ pinModal: { open: false } });
  },
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

  subtotal: () => get().cart.items.reduce((s, i) => s + i.line_subtotal, 0),
  discountTotal: () => get().cart.items.reduce((s, i) => s + i.discount_amount, 0),
  total: () => get().cart.items.reduce((s, i) => s + i.line_total, 0),
}));