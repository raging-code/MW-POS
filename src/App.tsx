// src/App.tsx — MangoWarrior POS (light theme, responsive)
import React, { useState, useEffect, useCallback } from 'react';
import { format, parseISO } from 'date-fns';
import { clsx } from 'clsx';
import {
  ShoppingCart, Search, X, Plus, Minus, ChevronDown, ChevronUp,
  LogOut, Users, BarChart2, Settings, Package, Receipt,
  AlertTriangle, Printer, Trash2, Edit2, RefreshCw,
  DollarSign, TrendingUp, Menu as MenuIcon, ShieldCheck,
  ArrowLeft, Save, ChevronRight, Coffee, Star, Tag,
} from 'lucide-react';
import { useAuthStore, useCartStore, useUIStore } from './store';
import type {
  User, Category, MenuItem, Addon, CartItem, SaleDetail,
  SaleListItem, Shift, PaymentLine, PaymentMethod, Page,
  HeldOrder, Settings as SettingsType,
  SaleItemDetail, ItemSize, CartAddon, CashDrop,
  InventoryItem, InventoryTransaction, AuditLog,
} from './types';
import {
  useUsersList, useLogin, useVerifyPin, useMenu, useCurrentShift,
  useOpenShift, useCloseShift, useCashDrop, useHeldOrders,
  useCreateHeldOrder, useDeleteHeldOrder, useCheckout, useSales,
  useSaleDetail, useVoidSale, useRefundSale, useSoftDeleteSale,
  useReprintSale, useSalesReport, useSettings, useUpdateSettings,
  useUsers, useCreateUser, useUpdateUser, useDeleteUser, useResetPin,
  useInventory, useCreateInventoryItem, useCreateInventoryTransaction,
  useAuditLogs, useToggleAvailability, useCreateMenuItem,
  useUpdateMenuItem, useDeleteMenuItem, useCreateCategory,
  useUpdateAddon, useCreateAddon,
} from './api';

const MANGO = '#F5A623';
const MANGO_LIGHT = '#FEF3C7';
const WARRIOR = '#E63946';

// ─── UI Primitives ───────────────────────────────────────────

function Btn({
  children, onClick, variant = 'primary', size = 'md', disabled, loading, className, type = 'button', fullWidth, title,
}: {
  children: React.ReactNode; onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'mango';
  size?: 'sm' | 'md' | 'lg'; disabled?: boolean; loading?: boolean;
  className?: string; type?: 'button' | 'submit'; fullWidth?: boolean; title?: string;
}) {
  const base = 'inline-flex items-center justify-center font-semibold rounded-xl transition-all active:scale-95 select-none whitespace-nowrap';
  const sizes = { sm: 'px-3 py-1.5 text-xs gap-1.5', md: 'px-4 py-2.5 text-sm gap-2', lg: 'px-6 py-3 text-base gap-2' };
  const variants = {
    primary:   'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm disabled:opacity-40',
    mango:     'text-amber-900 hover:opacity-90 shadow-sm disabled:opacity-40',
    secondary: 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200 disabled:opacity-40',
    danger:    'bg-red-500 text-white hover:bg-red-600 shadow-sm disabled:opacity-40',
    ghost:     'text-gray-500 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-40',
  };
  return (
    <button
      type={type} onClick={onClick}
      disabled={disabled || loading}
      title={title}
      className={clsx(base, sizes[size], variants[variant], fullWidth && 'w-full', className)}
      style={variant === 'mango' ? { backgroundColor: MANGO } : {}}
    >
      {loading ? <RefreshCw size={14} className="animate-spin" /> : children}
    </button>
  );
}

function Input({
  label, value, onChange, type = 'text', placeholder, className, disabled, min, step, maxLength, autoFocus,
}: {
  label?: string; value: string | number; onChange: (v: string) => void;
  type?: string; placeholder?: string; className?: string; disabled?: boolean;
  min?: number; step?: number; maxLength?: number; autoFocus?: boolean;
}) {
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      {label && <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{label}</label>}
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} disabled={disabled}
        min={min} step={step} maxLength={maxLength} autoFocus={autoFocus}
        className="bg-white border border-gray-300 text-gray-900 rounded-xl px-3 py-2.5 text-sm
          focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20
          placeholder-gray-400 disabled:opacity-50 disabled:bg-gray-50 w-full"
      />
    </div>
  );
}

function Select({
  label, value, onChange, options, className,
}: {
  label?: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; className?: string;
}) {
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      {label && <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{label}</label>}
      <select
        value={value} onChange={e => onChange(e.target.value)}
        className="bg-white border border-gray-300 text-gray-900 rounded-xl px-3 py-2.5 text-sm
          focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function Modal({
  open, onClose, title, children, maxWidth = 'max-w-md',
}: {
  open: boolean; onClose?: () => void; title?: string; children: React.ReactNode; maxWidth?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className={clsx('relative bg-white border border-gray-200 rounded-2xl shadow-2xl w-full', maxWidth)}>
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="text-base font-bold text-gray-900">{title}</h2>
            {onClose && (
              <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1 rounded-lg hover:bg-gray-100 transition-colors">
                <X size={18} />
              </button>
            )}
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Badge({ children, color = 'gray' }: { children: React.ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    gray:   'bg-gray-100 text-gray-600',
    green:  'bg-green-100 text-green-700',
    red:    'bg-red-100 text-red-700',
    yellow: 'bg-amber-100 text-amber-700',
    blue:   'bg-blue-100 text-blue-700',
  };
  return (
    <span className={clsx('px-2 py-0.5 rounded-full text-xs font-semibold', colors[color] ?? colors.gray)}>
      {children}
    </span>
  );
}

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const el = document.createElement('div');
  el.className = clsx(
    'fixed top-5 right-5 z-[999] px-4 py-3 rounded-xl text-sm font-semibold shadow-xl transition-all border',
    type === 'success'
      ? 'bg-green-50 text-green-800 border-green-200'
      : 'bg-red-50 text-red-800 border-red-200'
  );
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function fmt(amount: number) { return `₱${amount.toFixed(2)}`; }
function fmtDate(iso: string) {
  try { return format(parseISO(iso), 'MMM d, yyyy h:mm a'); } catch { return iso; }
}

function Divider() {
  return <div className="border-t border-gray-100 my-1" />;
}

// ─── PIN Modal ───────────────────────────────────────────────
// FIX: pass pin value directly to avoid stale closure bug

function PinModal() {
  const { pinModal, resolvePinModal } = useUIStore();
  const { user } = useAuthStore();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const verifyPin = useVerifyPin();

  useEffect(() => {
    if (pinModal.open) { setPin(''); setError(''); }
  }, [pinModal.open]);

  // Accept pinValue as argument to avoid stale closure
  const doSubmit = useCallback(async (pinValue: string) => {
    if (!user) return;
    try {
      await verifyPin.mutateAsync({ user_id: user.id, pin: pinValue, required_role: pinModal.required_role });
      resolvePinModal(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Invalid PIN');
      setPin('');
    }
  }, [user, verifyPin, pinModal.required_role, resolvePinModal]);

  const press = (val: string) => {
    if (val === 'DEL') { setPin(p => p.slice(0, -1)); return; }
    if (pin.length >= 6) return;
    const next = pin + val;
    setPin(next);
    if (next.length === 6) setTimeout(() => doSubmit(next), 50);
  };

  return (
    <Modal open={pinModal.open} onClose={() => resolvePinModal(false)}
      title={pinModal.required_role === 'admin' ? '🔒 Admin PIN Required' : '🔒 Enter Your PIN'}>
      <div className="flex flex-col items-center gap-5">
        <p className="text-sm text-gray-500">
          Verify your 6-digit PIN to continue
          {pinModal.required_role === 'admin' && ' (Admin access required)'}
        </p>
        <div className="flex gap-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={clsx(
              'w-11 h-11 rounded-full border-2 flex items-center justify-center text-lg transition-all',
              i < pin.length
                ? 'border-amber-400 bg-amber-50 text-amber-600'
                : 'border-gray-200 bg-gray-50'
            )}>
              {i < pin.length ? '●' : ''}
            </div>
          ))}
        </div>
        {error && (
          <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 px-3 py-2 rounded-xl border border-red-100">
            <AlertTriangle size={14} /> {error}
          </div>
        )}
        <div className="grid grid-cols-3 gap-2.5 w-full max-w-[240px]">
          {['1','2','3','4','5','6','7','8','9','','0','DEL'].map((k, i) => (
            k === '' ? <div key={i} /> : (
              <button key={i} onClick={() => press(k)}
                className={clsx(
                  'h-14 rounded-xl font-bold text-lg transition-all active:scale-95 border',
                  k === 'DEL'
                    ? 'bg-gray-100 text-gray-500 text-sm border-gray-200 hover:bg-gray-200'
                    : 'bg-white text-gray-900 border-gray-200 hover:bg-amber-50 hover:border-amber-300 shadow-sm'
                )}>
                {k}
              </button>
            )
          ))}
        </div>
        <Btn onClick={() => resolvePinModal(false)} variant="ghost" size="sm">Cancel</Btn>
      </div>
    </Modal>
  );
}

// ─── Receipt component ───────────────────────────────────────

function SaleReceipt({ sale, settings }: { sale: SaleDetail; settings: SettingsType }) {
  return (
    <div id="receipt-print" className="bg-white text-gray-900 p-4 text-xs font-mono max-w-[280px] mx-auto">
      <div className="text-center mb-3">
        <div className="text-lg font-bold">{settings.store_name ?? 'MangoWarrior'}</div>
        <div>{settings.store_address}</div>
        <div>{settings.store_contact}</div>
      </div>
      <div className="border-t border-dashed border-gray-300 my-2" />
      <div className="flex justify-between"><span>Receipt:</span><span>{sale.receipt_number}</span></div>
      <div className="flex justify-between"><span>Cashier:</span><span>{sale.cashier_name}</span></div>
      <div className="flex justify-between"><span>Date:</span><span>{fmtDate(sale.created_at)}</span></div>
      {sale.note && <div className="flex justify-between"><span>Note:</span><span>{sale.note}</span></div>}
      <div className="border-t border-dashed border-gray-300 my-2" />
      {sale.items.map((item: SaleItemDetail, i: number) => (
        <div key={i} className="mb-1">
          <div className="flex justify-between font-medium">
            <span>{item.qty}x {item.item_name}{item.size_name ? ` (${item.size_name})` : ''}</span>
            <span>{fmt(item.final_price)}</span>
          </div>
          {item.addons.map((a, j) => (
            <div key={j} className="flex justify-between pl-3 text-gray-500">
              <span>+ {a.addon_name} x{a.qty}</span>
              <span>{fmt(a.addon_price * a.qty)}</span>
            </div>
          ))}
          {item.discount_amount > 0 && (
            <div className="flex justify-between pl-3 text-gray-400">
              <span>{item.discount_type?.toUpperCase()} Discount</span>
              <span>-{fmt(item.discount_amount)}</span>
            </div>
          )}
        </div>
      ))}
      <div className="border-t border-dashed border-gray-300 my-2" />
      <div className="flex justify-between"><span>Subtotal:</span><span>{fmt(sale.subtotal)}</span></div>
      {sale.discount_total > 0 && (
        <div className="flex justify-between text-gray-500"><span>Discount:</span><span>-{fmt(sale.discount_total)}</span></div>
      )}
      <div className="flex justify-between font-bold text-sm"><span>TOTAL:</span><span>{fmt(sale.total)}</span></div>
      {sale.payments.map((p: PaymentLine, i: number) => (
        <div key={i} className="flex justify-between"><span>{p.method.toUpperCase()}:</span><span>{fmt(p.amount)}</span></div>
      ))}
      {sale.change_amount != null && sale.change_amount > 0 && (
        <div className="flex justify-between"><span>Change:</span><span>{fmt(sale.change_amount)}</span></div>
      )}
      <div className="border-t border-dashed border-gray-300 my-2" />
      <div className="text-center text-gray-500">{settings.receipt_footer ?? 'Thank you!'}</div>
      {sale.sale_type === 'missed' && (
        <div className="text-center font-bold text-red-600 mt-1">*** MISSED SALE ***</div>
      )}
    </div>
  );
}

// ─── Login Page ──────────────────────────────────────────────

function LoginPage() {
  const { data: usersList, isLoading } = useUsersList();
  const login = useLogin();
  const { login: authLogin } = useAuthStore();
  const { navigate } = useUIStore();
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  // FIX: pass pin value to avoid stale closure
  const doLogin = useCallback(async (pinValue: string, user: User) => {
    try {
      const res = await login.mutateAsync({ user_id: user.id, pin: pinValue });
      authLogin(res.user, res.token);
      navigate(res.user.role === 'admin' ? 'admin_dashboard' : 'pos');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Invalid PIN');
      setPin('');
    }
  }, [login, authLogin, navigate]);

  const pressPin = (val: string) => {
    if (val === 'DEL') { setPin(p => p.slice(0, -1)); return; }
    if (pin.length >= 6) return;
    const next = pin + val;
    setPin(next);
    if (next.length === 6 && selectedUser) {
      setTimeout(() => doLogin(next, selectedUser), 50);
    }
  };

  if (isLoading) return (
    <div className="h-full bg-amber-50 flex items-center justify-center">
      <RefreshCw className="animate-spin" size={32} style={{ color: MANGO }} />
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🥭</div>
          <div className="text-3xl font-black text-gray-900 mb-1">MangoWarrior</div>
          <div className="text-gray-500 text-sm font-medium">Point of Sale System</div>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
          {!selectedUser ? (
            <div>
              <p className="text-gray-500 text-sm text-center mb-4 font-medium">Select your account</p>
              <div className="flex flex-col gap-2">
                {(usersList ?? []).map((u: User) => (
                  <button key={u.id}
                    onClick={() => { setSelectedUser(u); setPin(''); setError(''); }}
                    className="flex items-center gap-3 p-3.5 bg-gray-50 hover:bg-amber-50 border border-gray-200
                      hover:border-amber-300 rounded-xl transition-all text-left group">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-amber-900 text-sm shrink-0"
                      style={{ backgroundColor: MANGO }}>
                      {u.name[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-gray-900 font-semibold text-sm">{u.name}</div>
                      <div className="text-gray-400 text-xs capitalize">{u.role}</div>
                    </div>
                    <ChevronRight size={16} className="text-gray-300 group-hover:text-amber-400 transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-5">
              <button onClick={() => { setSelectedUser(null); setPin(''); setError(''); }}
                className="flex items-center gap-1.5 text-gray-400 hover:text-gray-700 text-sm transition-colors self-start">
                <ArrowLeft size={14} /> Back
              </button>
              <div className="w-16 h-16 rounded-full flex items-center justify-center font-bold text-2xl text-amber-900"
                style={{ backgroundColor: MANGO }}>
                {selectedUser.name[0].toUpperCase()}
              </div>
              <div className="text-center">
                <div className="text-gray-900 font-bold text-lg">{selectedUser.name}</div>
                <div className="text-gray-400 text-xs capitalize">{selectedUser.role}</div>
              </div>
              <div className="flex gap-2.5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className={clsx(
                    'w-11 h-11 rounded-full border-2 flex items-center justify-center transition-all',
                    i < pin.length
                      ? 'border-amber-400 bg-amber-50 text-amber-600'
                      : 'border-gray-200 bg-gray-50'
                  )}>
                    {i < pin.length ? '●' : ''}
                  </div>
                ))}
              </div>
              {error && (
                <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 px-3 py-2 rounded-xl border border-red-100 w-full justify-center">
                  <AlertTriangle size={14} /> {error}
                </div>
              )}
              <div className="grid grid-cols-3 gap-2.5 w-full max-w-[240px]">
                {['1','2','3','4','5','6','7','8','9','','0','DEL'].map((k, i) => (
                  k === '' ? <div key={i} /> : (
                    <button key={i} onClick={() => pressPin(k)}
                      className={clsx(
                        'h-14 rounded-xl font-bold text-lg transition-all active:scale-95 border',
                        k === 'DEL'
                          ? 'bg-gray-100 text-gray-500 text-sm border-gray-200 hover:bg-gray-200'
                          : 'bg-white text-gray-900 border-gray-200 hover:bg-amber-50 hover:border-amber-300 shadow-sm'
                      )}>
                      {k}
                    </button>
                  )
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Header ─────────────────────────────────────────────────

function Header() {
  const { user, logout } = useAuthStore();
  const { page, navigate } = useUIStore();
  const { data: shift } = useCurrentShift();
  const openPinModal = useUIStore(s => s.openPinModal);
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    const ok = await openPinModal();
    if (!ok) return;
    fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${useAuthStore.getState().token}` } });
    logout();
  };

  const navItems: { label: string; page: Page; icon: React.ReactNode; adminOnly?: boolean }[] = [
    { label: 'POS', page: 'pos', icon: <ShoppingCart size={14} /> },
    { label: 'Sales', page: 'sales', icon: <Receipt size={14} /> },
    { label: 'Dashboard', page: 'admin_dashboard', icon: <BarChart2 size={14} />, adminOnly: true },
    { label: 'Menu', page: 'admin_menu', icon: <Coffee size={14} />, adminOnly: true },
    { label: 'Staff', page: 'admin_employees', icon: <Users size={14} />, adminOnly: true },
    { label: 'Inventory', page: 'admin_inventory', icon: <Package size={14} />, adminOnly: true },
    { label: 'Settings', page: 'admin_settings', icon: <Settings size={14} />, adminOnly: true },
    { label: 'Audit', page: 'admin_audit', icon: <ShieldCheck size={14} />, adminOnly: true },
  ];

  const visible = navItems.filter(n => !n.adminOnly || user?.role === 'admin');

  return (
    <header className="flex items-center h-14 px-4 bg-white border-b border-gray-200 shadow-sm shrink-0 z-30 relative">
      <div className="font-black text-lg mr-4" style={{ color: MANGO }}>
        <span className="hidden sm:inline">🥭 MangoWarrior</span>
        <span className="sm:hidden">🥭 MW</span>
      </div>

      {/* Shift indicator */}
      <div className="mr-4 hidden sm:flex items-center gap-1.5">
        <div className={clsx('w-2 h-2 rounded-full', shift ? 'bg-green-500 animate-pulse' : 'bg-gray-300')} />
        <span className="text-xs text-gray-500 font-medium">{shift ? 'Shift Open' : 'No Shift'}</span>
      </div>

      {/* Desktop nav */}
      <nav className="hidden md:flex items-center gap-1 flex-1">
        {visible.map((n) => (
          <button key={n.page} onClick={() => navigate(n.page)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
              page === n.page
                ? 'text-amber-900'
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
            )}
            style={page === n.page ? { backgroundColor: MANGO_LIGHT, color: '#92400e' } : {}}>
            {n.icon} {n.label}
          </button>
        ))}
      </nav>

      {/* Mobile menu */}
      <div className="md:hidden flex-1">
        <button onClick={() => setMenuOpen(v => !v)}
          className="text-gray-500 hover:text-gray-900 p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
          <MenuIcon size={18} />
        </button>
        {menuOpen && (
          <div className="absolute top-14 left-0 right-0 bg-white border-b border-gray-200 shadow-lg z-50 p-2 flex flex-col gap-1">
            {visible.map((n) => (
              <button key={n.page} onClick={() => { navigate(n.page); setMenuOpen(false); }}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all',
                  page === n.page ? 'text-amber-900' : 'text-gray-600 hover:bg-gray-50'
                )}
                style={page === n.page ? { backgroundColor: MANGO_LIGHT, color: '#92400e' } : {}}>
                {n.icon} {n.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 ml-auto">
        <div className="hidden sm:flex flex-col items-end">
          <span className="text-xs font-semibold text-gray-700">{user?.name}</span>
          <span className="text-xs text-gray-400 capitalize">{user?.role}</span>
        </div>
        <button onClick={handleLogout}
          className="text-gray-400 hover:text-red-500 transition-colors p-1.5 rounded-lg hover:bg-red-50"
          title="Sign Out">
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}

// ─── POS Page ────────────────────────────────────────────────

function POSPage() {
  const cart = useCartStore();
  const { data: menuData, isLoading: menuLoading } = useMenu();
  const { data: settings } = useSettings();
  const { data: shift } = useCurrentShift();

  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQ, setSearchQ] = useState('');
  const [showCheckout, setShowCheckout] = useState(false);
  const [showHeld, setShowHeld] = useState(false);
  const [showShift, setShowShift] = useState(false);
  const [sizeModal, setSizeModal] = useState<{ item: MenuItem } | null>(null);
  const [mobileTab, setMobileTab] = useState<'menu' | 'cart'>('menu');

  useEffect(() => {
    if (settings) {
      cart.setDiscountPcts(
        parseFloat(settings.sc_discount_pct ?? '20'),
        parseFloat(settings.pwd_discount_pct ?? '20')
      );
    }
  }, [settings]);

  const categories = menuData?.categories ?? [];
  const allItems = categories.flatMap((c: Category) => c.items);
  const filteredItems = allItems.filter((item: MenuItem) => {
    if (!item.is_available) return false;
    const matchCat = activeCategory === 'all' || item.category_id === activeCategory;
    const matchSearch = item.name.toLowerCase().includes(searchQ.toLowerCase());
    return matchCat && matchSearch;
  });

  const addToCart = (item: MenuItem, sizeName?: string, sizePrice?: number, addons: Addon[] = []) => {
    const price = sizePrice ?? item.sizes[0]?.price ?? 0;
    cart.addItem({
      item_id: item.id, item_name: item.name,
      size_name: sizeName, base_price: price,
      addons: addons.map((a: Addon) => ({ addon_id: a.id, addon_name: a.name, addon_price: a.price, qty: 1 })),
    });
    setSizeModal(null);
  };

  const handleItemTap = (item: MenuItem) => {
    if (item.sizes.length > 1) {
      setSizeModal({ item });
    } else {
      addToCart(item, item.sizes[0]?.name, item.sizes[0]?.price);
    }
  };

  const total = cart.total();
  const itemCount = cart.cart.items.reduce((s, i) => s + i.qty, 0);

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden">
      {!shift && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between shrink-0">
          <span className="text-amber-700 text-xs flex items-center gap-1.5 font-medium">
            <AlertTriangle size={13} /> No shift open
          </span>
          <Btn size="sm" variant="mango" onClick={() => setShowShift(true)}>Open Shift</Btn>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Menu panel */}
        <div className={clsx(
          'flex flex-col flex-1 min-w-0 overflow-hidden bg-gray-50',
          mobileTab === 'cart' ? 'hidden md:flex' : 'flex'
        )}>
          {/* Search + categories */}
          <div className="px-3 py-3 bg-white border-b border-gray-200 shrink-0">
            <div className="relative mb-3">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text" placeholder="Search items…" value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl pl-9 pr-3 py-2.5 text-sm
                  focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 placeholder-gray-400"
              />
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
              <button onClick={() => setActiveCategory('all')}
                className={clsx('shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all',
                  activeCategory === 'all'
                    ? 'text-amber-900 shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                )}
                style={activeCategory === 'all' ? { backgroundColor: MANGO, color: '#78350f' } : {}}>
                All
              </button>
              {categories.map((c: Category) => (
                <button key={c.id} onClick={() => setActiveCategory(c.id)}
                  className={clsx('shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all',
                    activeCategory === c.id
                      ? 'text-amber-900 shadow-sm'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  )}
                  style={activeCategory === c.id ? { backgroundColor: MANGO, color: '#78350f' } : {}}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          {/* Items grid */}
          <div className="flex-1 overflow-y-auto p-3">
            {menuLoading ? (
              <div className="flex items-center justify-center h-32">
                <RefreshCw className="text-gray-400 animate-spin" size={24} />
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="text-center text-gray-400 py-16">
                <Coffee size={40} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">No items found</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                {filteredItems.map((item: MenuItem) => {
                  const minPrice = Math.min(...item.sizes.map((s: ItemSize) => s.price));
                  return (
                    <button key={item.id} onClick={() => handleItemTap(item)}
                      className="bg-white hover:bg-amber-50 border border-gray-200 hover:border-amber-300
                        rounded-xl p-3 text-left transition-all active:scale-95 flex flex-col gap-1 shadow-sm hover:shadow">
                      <div className="text-gray-900 font-semibold text-sm leading-tight line-clamp-2 flex-1">{item.name}</div>
                      <div className="mt-1">
                        <div className="text-sm font-bold" style={{ color: MANGO }}>
                          {item.sizes.length > 1 ? `from ${fmt(minPrice)}` : fmt(minPrice)}
                        </div>
                        {item.sizes.length > 1 && (
                          <div className="text-xs text-gray-400">{item.sizes.length} sizes</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Cart panel */}
        <div className={clsx(
          'flex flex-col bg-white border-l border-gray-200',
          'w-full md:w-72 xl:w-80 shrink-0',
          mobileTab === 'menu' ? 'hidden md:flex' : 'flex'
        )}>
          <div className="flex-1 overflow-y-auto px-3 py-3">
            {cart.cart.items.length === 0 ? (
              <div className="text-center text-gray-300 py-12">
                <ShoppingCart size={40} className="mx-auto mb-3 opacity-50" />
                <p className="text-sm text-gray-400">Tap items to add</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {cart.cart.items.map((item: CartItem) => (
                  <CartItemRow key={item.cart_key} item={item} />
                ))}
              </div>
            )}
          </div>

          {/* Note */}
          <div className="px-3 pb-2 shrink-0">
            <textarea
              value={cart.cart.note}
              onChange={e => cart.setNote(e.target.value)}
              placeholder="Special instructions…"
              rows={2}
              className="w-full bg-gray-50 border border-gray-200 text-gray-700 rounded-xl px-3 py-2 text-xs
                focus:outline-none focus:border-amber-400 placeholder-gray-400 resize-none"
            />
          </div>

          {/* Totals + actions */}
          <div className="border-t border-gray-200 px-3 py-3 shrink-0">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Subtotal</span><span className="font-medium text-gray-700">{fmt(cart.subtotal())}</span>
            </div>
            {cart.discountTotal() > 0 && (
              <div className="flex justify-between text-xs text-green-600 mb-1">
                <span>Discount</span><span>-{fmt(cart.discountTotal())}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-gray-900 mb-3">
              <span>Total</span>
              <span className="text-xl" style={{ color: MANGO }}>{fmt(total)}</span>
            </div>
            <div className="flex gap-2">
              <Btn variant="secondary" size="sm" onClick={() => setShowHeld(true)}
                disabled={cart.cart.items.length === 0} className="flex-1">
                Hold
              </Btn>
              <Btn variant="mango" size="sm" className="flex-1"
                onClick={() => setShowCheckout(true)}
                disabled={cart.cart.items.length === 0}>
                Pay {itemCount > 0 && `(${itemCount})`}
              </Btn>
            </div>
            {shift && (
              <button onClick={() => setShowShift(true)}
                className="w-full mt-2 text-xs text-gray-400 hover:text-gray-600 transition-colors">
                Shift actions
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mobile bottom tab bar */}
      <div className="md:hidden flex border-t border-gray-200 bg-white shrink-0">
        <button
          onClick={() => setMobileTab('menu')}
          className={clsx('flex-1 flex flex-col items-center py-2.5 text-xs font-semibold gap-1 transition-colors',
            mobileTab === 'menu' ? 'text-amber-600' : 'text-gray-400'
          )}>
          <Coffee size={18} />
          Menu
        </button>
        <button
          onClick={() => setMobileTab('cart')}
          className={clsx('flex-1 flex flex-col items-center py-2.5 text-xs font-semibold gap-1 transition-colors relative',
            mobileTab === 'cart' ? 'text-amber-600' : 'text-gray-400'
          )}>
          <ShoppingCart size={18} />
          Cart
          {itemCount > 0 && (
            <span className="absolute top-1.5 right-1/3 w-4 h-4 rounded-full text-white text-xs flex items-center justify-center font-bold"
              style={{ backgroundColor: MANGO, fontSize: '10px' }}>
              {itemCount}
            </span>
          )}
        </button>
      </div>

      {/* Modals */}
      {sizeModal && (
        <SizePickerModal item={sizeModal.item} onClose={() => setSizeModal(null)} onAdd={addToCart} />
      )}
      {showCheckout && (
        <CheckoutModal shift={shift} onClose={() => setShowCheckout(false)}
          onSuccess={() => { setShowCheckout(false); cart.clearCart(); setMobileTab('menu'); }} />
      )}
      {showHeld && (
        <HeldOrdersModal onClose={() => setShowHeld(false)} onRestore={() => setShowHeld(false)} />
      )}
      {showShift && (
        <ShiftModal shift={shift ?? null} onClose={() => setShowShift(false)} />
      )}
    </div>
  );
}

// ─── Cart Item Row ───────────────────────────────────────────

function CartItemRow({ item }: { item: CartItem }) {
  const cart = useCartStore();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-2">
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => cart.updateQty(item.cart_key, -1)}
            className="w-7 h-7 rounded-lg bg-white border border-gray-200 hover:bg-gray-100 flex items-center justify-center text-gray-600 transition-colors shadow-sm">
            <Minus size={10} />
          </button>
          <span className="w-6 text-center text-sm text-gray-900 font-bold">{item.qty}</span>
          <button onClick={() => cart.updateQty(item.cart_key, 1)}
            className="w-7 h-7 rounded-lg bg-white border border-gray-200 hover:bg-amber-50 hover:border-amber-300 flex items-center justify-center text-gray-600 transition-colors shadow-sm">
            <Plus size={10} />
          </button>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-gray-900 text-xs font-semibold truncate">{item.item_name}</div>
          {item.size_name && <div className="text-gray-400 text-xs">{item.size_name}</div>}
          {item.addons.length > 0 && (
            <button onClick={() => setExpanded(v => !v)}
              className="text-xs text-amber-600 hover:text-amber-800 flex items-center gap-0.5 transition-colors">
              +{item.addons.length} add-on{item.addons.length > 1 ? 's' : ''}
              {expanded ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
            </button>
          )}
        </div>
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          <span className="text-xs font-bold" style={{ color: MANGO }}>{fmt(item.line_total)}</span>
          {item.discount_amount > 0 && (
            <span className="text-xs text-green-600">-{fmt(item.discount_amount)}</span>
          )}
        </div>
        <div className="flex flex-col gap-0.5 shrink-0">
          <button
            onClick={() => cart.setDiscount(item.cart_key, item.discount_type === 'sc' ? null : 'sc')}
            className={clsx('px-1.5 py-0.5 rounded-lg text-xs font-bold transition-all',
              item.discount_type === 'sc'
                ? 'bg-blue-500 text-white shadow-sm'
                : 'bg-white border border-gray-200 text-gray-400 hover:text-gray-700')}>
            SC
          </button>
          <button
            onClick={() => cart.setDiscount(item.cart_key, item.discount_type === 'pwd' ? null : 'pwd')}
            className={clsx('px-1.5 py-0.5 rounded-lg text-xs font-bold transition-all',
              item.discount_type === 'pwd'
                ? 'bg-purple-500 text-white shadow-sm'
                : 'bg-white border border-gray-200 text-gray-400 hover:text-gray-700')}>
            PWD
          </button>
        </div>
        <button onClick={() => cart.removeItem(item.cart_key)}
          className="text-gray-300 hover:text-red-500 transition-colors shrink-0 p-0.5">
          <X size={14} />
        </button>
      </div>
      {expanded && item.addons.length > 0 && (
        <div className="px-3 pb-2 border-t border-gray-200 pt-1.5 bg-white">
          {item.addons.map((a: CartAddon, i: number) => (
            <div key={i} className="flex justify-between text-xs text-gray-500">
              <span>+ {a.addon_name} x{a.qty}</span>
              <span>{fmt(a.addon_price * a.qty)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Size/Addon Picker Modal ─────────────────────────────────

function SizePickerModal({
  item, onClose, onAdd,
}: {
  item: MenuItem; onClose: () => void;
  onAdd: (item: MenuItem, sizeName?: string, sizePrice?: number, addons?: Addon[]) => void;
}) {
  const [selectedSize, setSelectedSize] = useState(item.sizes[0]);
  const [selectedAddons, setSelectedAddons] = useState<Addon[]>([]);

  const toggleAddon = (addon: Addon) => {
    setSelectedAddons(prev =>
      prev.some(a => a.id === addon.id)
        ? prev.filter(a => a.id !== addon.id)
        : [...prev, addon]
    );
  };

  const availableAddons = item.addons.filter(a => a.is_available);

  return (
    <Modal open onClose={onClose} title={item.name} maxWidth="max-w-sm">
      <div className="flex flex-col gap-4">
        {item.sizes.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Choose Size</p>
            <div className="flex flex-col gap-2">
              {item.sizes.map((s: ItemSize) => (
                <button key={s.id} onClick={() => setSelectedSize(s)}
                  className={clsx(
                    'flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all text-sm font-semibold',
                    selectedSize?.id === s.id
                      ? 'border-amber-400 bg-amber-50 text-amber-900'
                      : 'border-gray-200 text-gray-700 hover:border-gray-300 bg-white'
                  )}>
                  <span>{s.name}</span>
                  <span className={selectedSize?.id === s.id ? 'text-amber-600' : 'text-gray-500'}>
                    {fmt(s.price)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {availableAddons.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Add-ons (optional)</p>
            <div className="flex flex-col gap-2">
              {availableAddons.map((a: Addon) => {
                const active = selectedAddons.some(s => s.id === a.id);
                return (
                  <button key={a.id} onClick={() => toggleAddon(a)}
                    className={clsx(
                      'flex items-center justify-between px-4 py-2.5 rounded-xl border-2 transition-all text-sm',
                      active
                        ? 'border-amber-400 bg-amber-50 text-amber-900'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300 bg-white'
                    )}>
                    <span className="flex items-center gap-2.5">
                      <div className={clsx(
                        'w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all',
                        active ? 'border-amber-400 bg-amber-400' : 'border-gray-300'
                      )}>
                        {active && <span className="text-white text-xs font-black">✓</span>}
                      </div>
                      {a.name}
                    </span>
                    <span className={clsx('text-xs font-semibold', active ? 'text-amber-600' : 'text-gray-400')}>
                      +{fmt(a.price)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex items-center justify-between py-3 border-t border-gray-100">
          <span className="text-sm text-gray-500 font-medium">Item Total</span>
          <span className="font-black text-lg" style={{ color: MANGO }}>
            {fmt((selectedSize?.price ?? 0) + selectedAddons.reduce((s, a) => s + a.price, 0))}
          </span>
        </div>
        <Btn variant="mango" fullWidth
          onClick={() => onAdd(item, selectedSize?.name, selectedSize?.price, selectedAddons)}>
          <Plus size={16} /> Add to Order
        </Btn>
      </div>
    </Modal>
  );
}

// ─── Checkout Modal ──────────────────────────────────────────

function CheckoutModal({ shift, onClose, onSuccess }: {
  shift: Shift | null | undefined; onClose: () => void; onSuccess: () => void;
}) {
  const { user } = useAuthStore();
  const cart = useCartStore();
  const checkout = useCheckout();
  const { data: settings } = useSettings();

  const total = cart.total();
  const [payments, setPayments] = useState<PaymentLine[]>([{ method: 'cash', amount: total }]);
  // FIX: start empty, user must enter tendered amount
  const [tendered, setTendered] = useState('');
  const [step, setStep] = useState<'payment' | 'success'>('payment');
  const [result, setResult] = useState<{ receipt_number: string; change: number } | null>(null);
  const [receiptData, setReceiptData] = useState<SaleDetail | null>(null);

  const paymentTotal = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const hasCash = payments.some(p => p.method === 'cash');
  const cashPaymentTotal = payments.filter(p => p.method === 'cash').reduce((s, p) => s + p.amount, 0);
  const tenderedNum = parseFloat(tendered) || 0;
  const change = hasCash && tenderedNum > 0 ? Math.max(0, tenderedNum - total) : 0;
  const balanced = Math.abs(paymentTotal - total) < 0.01;
  const tenderedOk = !hasCash || (!!tendered && tenderedNum >= cashPaymentTotal);

  const addPaymentLine = () => {
    const used: PaymentMethod[] = payments.map(p => p.method);
    const next = (['cash', 'gcash', 'maya'] as PaymentMethod[]).find(m => !used.includes(m));
    if (!next) return;
    setPayments(prev => [...prev, { method: next, amount: 0 }]);
  };

  const updatePayment = (idx: number, field: 'method' | 'amount', val: string) => {
    setPayments(prev => prev.map((p, i) => i === idx ? {
      ...p,
      [field]: field === 'amount' ? parseFloat(val) || 0 : val,
    } : p));
  };

  const handleCheckout = async () => {
    if (!user) return;
    try {
      const res = await checkout.mutateAsync({
        idempotency_key: cart.cart.idempotency_key,
        shift_id: shift?.id,
        order_type: 'dine_in',
        note: cart.cart.note || undefined,
        tendered_amount: hasCash && tendered ? tenderedNum : undefined,
        items: cart.cart.items.map((i: CartItem) => ({
          item_id: i.item_id,
          item_name: i.item_name,
          size_name: i.size_name,
          base_price: i.base_price,
          qty: i.qty,
          discount_type: i.discount_type ?? undefined,
          discount_pct: i.discount_pct,
          addons: i.addons,
        })),
        payments,
      });
      setResult({ receipt_number: res.receipt_number, change: res.change });
      setReceiptData({
        id: '', receipt_number: res.receipt_number,
        cashier_id: user.id, cashier_name: user.name,
        order_type: 'dine_in', status: 'completed', sale_type: 'normal',
        total: res.total, discount_total: cart.discountTotal(), subtotal: cart.subtotal(),
        created_at: new Date().toISOString(), is_reprinted: false,
        shift_id: shift?.id ?? null, note: cart.cart.note || null,
        tendered_amount: hasCash && tendered ? tenderedNum : null,
        change_amount: res.change,
        items: cart.cart.items.map((i: CartItem) => ({
          id: '', item_name: i.item_name, size_name: i.size_name ?? null,
          base_price: i.base_price, qty: i.qty,
          discount_type: i.discount_type, discount_pct: i.discount_pct,
          discount_amount: i.discount_amount, addons_total: i.addons_total,
          final_price: i.line_total,
          addons: i.addons.map((a: CartAddon) => ({ addon_name: a.addon_name, addon_price: a.addon_price, qty: a.qty })),
        })),
        payments,
      });
      setStep('success');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Checkout failed', 'error');
    }
  };

  return (
    <Modal open onClose={step === 'success' ? undefined : onClose}
      title={step === 'success' ? '✅ Sale Complete' : '💳 Payment'}
      maxWidth="max-w-lg">
      {step === 'success' && result ? (
        <div className="flex flex-col gap-4">
          <div className="text-center py-2">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <span className="text-3xl">✓</span>
            </div>
            <div className="text-gray-900 font-black text-xl">{result.receipt_number}</div>
            {hasCash && result.change > 0 && (
              <div className="mt-3 p-4 bg-green-50 border border-green-200 rounded-xl">
                <div className="text-green-600 text-sm font-semibold">Change</div>
                <div className="text-green-700 font-black text-3xl">{fmt(result.change)}</div>
              </div>
            )}
          </div>
          {receiptData && settings && (
            <div className="border border-gray-200 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
              <SaleReceipt sale={receiptData} settings={settings} />
            </div>
          )}
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={() => window.print()} className="flex-1">
              <Printer size={14} /> Print
            </Btn>
            <Btn variant="mango" onClick={onSuccess} className="flex-1">New Order</Btn>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Order summary */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <div className="flex justify-between font-bold text-gray-900 text-xl">
              <span>Total</span>
              <span style={{ color: MANGO }}>{fmt(total)}</span>
            </div>
            {cart.discountTotal() > 0 && (
              <div className="flex justify-between text-sm text-green-600 mt-1">
                <span>Discount applied</span><span>-{fmt(cart.discountTotal())}</span>
              </div>
            )}
            <div className="text-xs text-gray-400 mt-1">
              {cart.cart.items.reduce((s, i) => s + i.qty, 0)} item(s)
            </div>
          </div>

          {/* Payment method */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Payment</p>
              {payments.length < 3 && (
                <Btn size="sm" variant="ghost" onClick={addPaymentLine}>
                  <Plus size={12} /> Split
                </Btn>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {payments.map((p, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Select
                    value={p.method}
                    onChange={v => updatePayment(i, 'method', v)}
                    options={[
                      { value: 'cash', label: '💵 Cash' },
                      { value: 'gcash', label: '📱 GCash' },
                      { value: 'maya', label: '💳 Maya' },
                    ]}
                    className="w-32"
                  />
                  <Input
                    type="number" value={p.amount} min={0} step={0.01}
                    onChange={v => updatePayment(i, 'amount', v)}
                    className="flex-1"
                  />
                  {payments.length > 1 && (
                    <button onClick={() => setPayments(prev => prev.filter((_, j) => j !== i))}
                      className="text-gray-300 hover:text-red-500 p-1 transition-colors">
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Cash tendered — user must input */}
          {hasCash && (
            <div>
              <Input
                label="Cash Tendered"
                type="number"
                value={tendered}
                min={0}
                step={0.01}
                placeholder="Enter amount received"
                onChange={setTendered}
              />
              {tendered && tenderedNum >= cashPaymentTotal && (
                <div className="flex justify-between text-sm mt-2 px-1">
                  <span className="text-gray-500">Change</span>
                  <span className="text-green-600 font-bold">{fmt(change)}</span>
                </div>
              )}
              {tendered && tenderedNum < cashPaymentTotal && (
                <div className="text-xs text-red-500 mt-1 px-1">
                  Amount is less than cash total ({fmt(cashPaymentTotal)})
                </div>
              )}
              {/* Quick fill buttons */}
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {[total, Math.ceil(total / 50) * 50, Math.ceil(total / 100) * 100, Math.ceil(total / 500) * 500]
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .map(v => (
                    <button key={v} onClick={() => setTendered(v.toString())}
                      className="px-3 py-1.5 bg-gray-100 hover:bg-amber-50 hover:border-amber-200 border border-gray-200 rounded-lg text-xs text-gray-600 hover:text-amber-800 font-semibold transition-all">
                      {fmt(v)}
                    </button>
                  ))}
              </div>
            </div>
          )}

          {/* Balance warning */}
          {!balanced && (
            <div className="flex items-center justify-between text-sm p-3 bg-red-50 border border-red-200 rounded-xl">
              <span className="text-red-600 font-semibold">Remaining</span>
              <span className="text-red-600 font-bold">{fmt(total - paymentTotal)}</span>
            </div>
          )}

          <div className="flex gap-2">
            <Btn variant="secondary" onClick={onClose} className="flex-1">Cancel</Btn>
            <Btn variant="mango" onClick={handleCheckout}
              disabled={!balanced || !tenderedOk}
              loading={checkout.isPending}
              className="flex-1">
              Confirm Sale
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── Held Orders Modal ───────────────────────────────────────

function HeldOrdersModal({ onClose, onRestore }: { onClose: () => void; onRestore: () => void }) {
  const { data: heldOrders, isLoading } = useHeldOrders();
  const createHeld = useCreateHeldOrder();
  const deleteHeld = useDeleteHeldOrder();
  const cart = useCartStore();
  const [label, setLabel] = useState('');

  const handleHold = async () => {
    if (cart.cart.items.length === 0) return;
    await createHeld.mutateAsync({ data: cart.cart, label: label || undefined });
    cart.clearCart();
    toast('Order held');
    onClose();
  };

  const handleRestore = (order: HeldOrder) => {
    cart.loadFromHeld(order.data);
    deleteHeld.mutate(order.id);
    onRestore();
  };

  return (
    <Modal open onClose={onClose} title="📋 Held Orders" maxWidth="max-w-md">
      <div className="flex flex-col gap-4">
        {cart.cart.items.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-sm text-amber-900 mb-2 font-semibold">
              Hold Current Order ({cart.cart.items.length} items)
            </p>
            <div className="flex gap-2">
              <Input value={label} onChange={setLabel} placeholder="Label (optional)" className="flex-1" />
              <Btn variant="mango" onClick={handleHold} loading={createHeld.isPending}>Hold</Btn>
            </div>
          </div>
        )}
        <div>
          <p className="text-xs text-gray-400 mb-3 font-medium">Held orders expire in 1 hour</p>
          {isLoading ? (
            <div className="flex justify-center py-4"><RefreshCw className="animate-spin text-gray-400" /></div>
          ) : !heldOrders?.length ? (
            <div className="text-center text-gray-400 py-8 text-sm">No held orders</div>
          ) : (
            <div className="flex flex-col gap-2">
              {heldOrders.map((order: HeldOrder) => (
                <div key={order.id} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                  <div>
                    <div className="text-gray-900 text-sm font-semibold">{order.label ?? 'Unnamed Order'}</div>
                    <div className="text-gray-500 text-xs">
                      {order.data.items.length} items · {fmt(order.data.items.reduce((s, i) => s + i.line_total, 0))}
                    </div>
                    <div className="text-gray-400 text-xs">Expires {fmtDate(order.expires_at)}</div>
                  </div>
                  <div className="flex gap-2">
                    <Btn size="sm" variant="mango" onClick={() => handleRestore(order)}>Restore</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => deleteHeld.mutate(order.id)}>
                      <Trash2 size={13} />
                    </Btn>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ─── Shift Modal ─────────────────────────────────────────────

function ShiftModal({ shift, onClose }: { shift: Shift | null; onClose: () => void }) {
  const openPinModal = useUIStore(s => s.openPinModal);
  const openShift = useOpenShift();
  const closeShift = useCloseShift();
  const cashDrop = useCashDrop();

  const [startFloat, setStartFloat] = useState('0');
  const [closingCash, setClosingCash] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [dropAmount, setDropAmount] = useState('');
  const [dropReason, setDropReason] = useState('');
  const [tab, setTab] = useState<'overview' | 'close' | 'drop'>('overview');

  const handleOpen = async () => {
    const ok = await openPinModal({ required_role: 'admin' });
    if (!ok) return;
    await openShift.mutateAsync({ starting_float: parseFloat(startFloat) || 0 });
    toast('Shift opened');
    onClose();
  };

  const handleClose = async () => {
    if (!shift) return;
    const ok = await openPinModal({ required_role: 'admin' });
    if (!ok) return;
    await closeShift.mutateAsync({ id: shift.id, closing_cash: parseFloat(closingCash) || 0, notes: closeNotes });
    toast('Shift closed');
    onClose();
  };

  const handleDrop = async () => {
    if (!shift || !dropReason) return;
    await cashDrop.mutateAsync({ shift_id: shift.id, amount: parseFloat(dropAmount) || 0, reason: dropReason });
    toast('Cash drop recorded');
    setDropAmount(''); setDropReason('');
    onClose();
  };

  if (!shift) {
    return (
      <Modal open onClose={onClose} title="🔓 Open Shift">
        <div className="flex flex-col gap-4">
          <p className="text-gray-500 text-sm">Enter the starting cash float for this shift.</p>
          <Input label="Starting Float (₱)" type="number" value={startFloat} min={0} step={0.01} onChange={setStartFloat} />
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={onClose} className="flex-1">Cancel</Btn>
            <Btn variant="mango" onClick={handleOpen} loading={openShift.isPending} className="flex-1">Open Shift</Btn>
          </div>
        </div>
      </Modal>
    );
  }

  const cashTotal = shift.payment_totals?.cash ?? 0;
  const expectedCash = (shift.starting_float ?? 0) + cashTotal
    - (shift.cash_drops ?? []).reduce((s, d: CashDrop) => s + d.amount, 0);
  const variance = parseFloat(closingCash || '0') - expectedCash;

  return (
    <Modal open onClose={onClose} title="📊 Shift Management" maxWidth="max-w-md">
      <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-xl">
        {(['overview', 'drop', 'close'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={clsx('flex-1 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all',
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
            {t === 'drop' ? 'Cash Drop' : t === 'close' ? 'Close Shift' : 'Overview'}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <StatCard label="Starting Float" value={fmt(shift.starting_float)} />
            <StatCard label="Cash Sales" value={fmt(cashTotal)} />
            {(Object.entries(shift.payment_totals ?? {}) as [string, number][])
              .filter(([k]) => k !== 'cash')
              .map(([k, v]) => <StatCard key={k} label={k.toUpperCase()} value={fmt(v)} />)}
            <StatCard label="Expected Cash" value={fmt(expectedCash)} />
          </div>
          {(shift.cash_drops ?? []).length > 0 && (
            <div>
              <p className="text-xs text-gray-500 font-semibold mb-1">Cash Drops</p>
              {shift.cash_drops.map((d: CashDrop) => (
                <div key={d.id} className="flex justify-between text-xs text-gray-600 py-1.5 border-b border-gray-100">
                  <span>{d.reason}</span>
                  <span className="text-red-500 font-semibold">-{fmt(d.amount)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-gray-400">Opened {fmtDate(shift.started_at)}</p>
        </div>
      )}

      {tab === 'drop' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-500">Record cash removed from the drawer.</p>
          <Input label="Amount (₱)" type="number" value={dropAmount} min={0} step={0.01} onChange={setDropAmount} />
          <Input label="Reason" value={dropReason} onChange={setDropReason} placeholder="e.g. Safe drop" />
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={onClose} className="flex-1">Cancel</Btn>
            <Btn variant="mango" onClick={handleDrop} loading={cashDrop.isPending}
              disabled={!dropReason || !dropAmount} className="flex-1">Record Drop</Btn>
          </div>
        </div>
      )}

      {tab === 'close' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-500">Count your cash drawer before closing.</p>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Expected Cash</span><span className="font-bold">{fmt(expectedCash)}</span>
            </div>
          </div>
          <Input label="Actual Closing Cash (₱)" type="number" value={closingCash} min={0} step={0.01}
            onChange={setClosingCash} autoFocus />
          {closingCash && (
            <div className={clsx('flex justify-between text-sm font-bold px-3 py-2.5 rounded-xl',
              Math.abs(variance) < 1 ? 'bg-green-50 text-green-700 border border-green-200' :
              variance > 0 ? 'bg-blue-50 text-blue-700 border border-blue-200' :
              'bg-red-50 text-red-700 border border-red-200')}>
              <span>Variance</span>
              <span>{variance > 0 ? '+' : ''}{fmt(variance)}</span>
            </div>
          )}
          <Input label="Notes (optional)" value={closeNotes} onChange={setCloseNotes} />
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={onClose} className="flex-1">Cancel</Btn>
            <Btn variant="danger" onClick={handleClose} loading={closeShift.isPending}
              disabled={!closingCash} className="flex-1">Close Shift</Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
      <div className="text-xs text-gray-500 font-medium mb-1">{label}</div>
      <div className="text-gray-900 font-bold text-lg">{value}</div>
    </div>
  );
}

// ─── Sales Page ──────────────────────────────────────────────

function SalesPage() {
  const { user } = useAuthStore();
  const openPinModal = useUIStore(s => s.openPinModal);
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));
  const [statusFilter, setStatusFilter] = useState('');
  const [receiptQ, setReceiptQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reasonModal, setReasonModal] = useState<{ action: 'void' | 'refund' | 'delete'; saleId: string } | null>(null);
  const [reason, setReason] = useState('');

  const { data: sales, isLoading, refetch } = useSales({
    date_from: dateFrom, date_to: dateTo,
    status: statusFilter || undefined,
    receipt: receiptQ || undefined,
  });
  const { data: saleDetail } = useSaleDetail(selectedId);
  const { data: settings } = useSettings();
  const voidSale = useVoidSale();
  const refundSale = useRefundSale();
  const softDelete = useSoftDeleteSale();
  const reprint = useReprintSale();

  const handleAction = async () => {
    if (!reasonModal || !reason) return;
    const { action, saleId } = reasonModal;
    const ok = await openPinModal({ required_role: 'admin' });
    if (!ok) return;
    try {
      if (action === 'void') await voidSale.mutateAsync({ id: saleId, reason });
      if (action === 'refund') await refundSale.mutateAsync({ id: saleId, reason });
      if (action === 'delete') await softDelete.mutateAsync({ id: saleId, reason });
      toast(`Sale ${action}ed`);
      setReasonModal(null); setReason(''); setSelectedId(null); refetch();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Action failed', 'error');
    }
  };

  const handleReprint = async (id: string) => {
    const ok = await openPinModal();
    if (!ok) return;
    await reprint.mutateAsync(id);
    toast('Reprint recorded');
    window.print();
  };

  const statusColor = (s: string) =>
    s === 'completed' ? 'green' : s === 'voided' ? 'red' : s === 'refunded' ? 'yellow' : 'gray';

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden">
      {/* Filters */}
      <div className="px-4 py-3 bg-white border-b border-gray-200 shadow-sm shrink-0">
        <div className="flex flex-wrap gap-2 items-end">
          <Input label="From" type="date" value={dateFrom} onChange={setDateFrom} className="w-36" />
          <Input label="To" type="date" value={dateTo} onChange={setDateTo} className="w-36" />
          <Select label="Status" value={statusFilter} onChange={setStatusFilter}
            options={[
              { value: '', label: 'All Status' },
              { value: 'completed', label: 'Completed' },
              { value: 'voided', label: 'Voided' },
              { value: 'refunded', label: 'Refunded' },
            ]} className="w-36" />
          <Input label="Receipt #" value={receiptQ} onChange={setReceiptQ} placeholder="MW-..." className="w-40" />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sales list */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {sales && (
            <div className="px-4 py-2 bg-white border-b border-gray-100 flex gap-4 text-xs text-gray-500 font-medium shrink-0">
              <span>{sales.length} transactions</span>
              <span className="text-green-600 font-semibold">
                {fmt(sales.filter(s => s.status === 'completed').reduce((a, s) => a + s.total, 0))} revenue
              </span>
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex justify-center py-16">
                <RefreshCw className="animate-spin text-gray-400" />
              </div>
            ) : !sales?.length ? (
              <div className="text-center text-gray-400 py-16">
                <Receipt size={40} className="mx-auto mb-3 opacity-30" />
                <p>No sales found</p>
              </div>
            ) : (
              sales.map((sale: SaleListItem) => (
                <button key={sale.id}
                  onClick={() => setSelectedId(s => s === sale.id ? null : sale.id)}
                  className={clsx(
                    'w-full flex items-center gap-3 px-4 py-3.5 border-b border-gray-100 text-left transition-all hover:bg-gray-50',
                    selectedId === sale.id && 'bg-amber-50 border-l-2 border-l-amber-400'
                  )}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-gray-900 font-mono font-semibold text-sm">{sale.receipt_number}</span>
                      <Badge color={statusColor(sale.status)}>{sale.status}</Badge>
                      {sale.sale_type === 'missed' && <Badge color="yellow">missed</Badge>}
                    </div>
                    <div className="text-gray-400 text-xs mt-0.5">{fmtDate(sale.created_at)}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-bold text-gray-900" style={{ color: MANGO }}>{fmt(sale.total)}</div>
                    {sale.discount_total > 0 && (
                      <div className="text-xs text-green-600">-{fmt(sale.discount_total)}</div>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Sale detail panel */}
        {saleDetail && (
          <div className="w-80 xl:w-96 shrink-0 flex flex-col overflow-hidden bg-white border-l border-gray-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
              <div>
                <div className="text-gray-900 font-mono font-bold">{saleDetail.receipt_number}</div>
                <div className="text-xs text-gray-500">{saleDetail.cashier_name}</div>
              </div>
              <div className="flex gap-1">
                {saleDetail.status === 'completed' && !saleDetail.is_reprinted && (
                  <Btn size="sm" variant="secondary" onClick={() => handleReprint(saleDetail.id)}>
                    <Printer size={12} /> Reprint
                  </Btn>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-2 mb-4">
                {saleDetail.items.map((item: SaleItemDetail, i: number) => (
                  <div key={i} className="text-sm">
                    <div className="flex justify-between text-gray-900 font-medium">
                      <span>{item.qty}x {item.item_name}{item.size_name ? ` (${item.size_name})` : ''}</span>
                      <span>{fmt(item.final_price)}</span>
                    </div>
                    {item.addons.map((a, j) => (
                      <div key={j} className="flex justify-between text-xs text-gray-400 pl-3">
                        <span>+ {a.addon_name}</span><span>{fmt(a.addon_price)}</span>
                      </div>
                    ))}
                    {item.discount_amount > 0 && (
                      <div className="flex justify-between text-xs text-green-600 pl-3">
                        <span>{item.discount_type?.toUpperCase()} discount</span>
                        <span>-{fmt(item.discount_amount)}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-100 pt-3 space-y-1.5">
                <div className="flex justify-between text-sm text-gray-500">
                  <span>Subtotal</span><span>{fmt(saleDetail.subtotal)}</span>
                </div>
                {saleDetail.discount_total > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Discount</span><span>-{fmt(saleDetail.discount_total)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-gray-900 text-base">
                  <span>Total</span><span style={{ color: MANGO }}>{fmt(saleDetail.total)}</span>
                </div>
                {saleDetail.payments.map((p: PaymentLine, i) => (
                  <div key={i} className="flex justify-between text-sm text-gray-500">
                    <span>{p.method.toUpperCase()}</span><span>{fmt(p.amount)}</span>
                  </div>
                ))}
                {saleDetail.change_amount != null && saleDetail.change_amount > 0 && (
                  <div className="flex justify-between text-sm text-gray-500">
                    <span>Change</span><span>{fmt(saleDetail.change_amount)}</span>
                  </div>
                )}
              </div>
              {settings && (
                <div className="mt-4 border border-gray-200 rounded-xl overflow-hidden">
                  <SaleReceipt sale={saleDetail} settings={settings} />
                </div>
              )}
            </div>
            {user?.role === 'admin' && saleDetail.status === 'completed' && (
              <div className="border-t border-gray-100 p-3 flex gap-2 shrink-0">
                <Btn size="sm" variant="secondary" className="flex-1"
                  onClick={() => { setReasonModal({ action: 'void', saleId: saleDetail.id }); setReason(''); }}>
                  Void
                </Btn>
                <Btn size="sm" variant="secondary" className="flex-1"
                  onClick={() => { setReasonModal({ action: 'refund', saleId: saleDetail.id }); setReason(''); }}>
                  Refund
                </Btn>
                <Btn size="sm" variant="danger"
                  onClick={() => { setReasonModal({ action: 'delete', saleId: saleDetail.id }); setReason(''); }}>
                  <Trash2 size={13} />
                </Btn>
              </div>
            )}
          </div>
        )}
      </div>

      <Modal open={!!reasonModal} onClose={() => setReasonModal(null)}
        title={`${reasonModal?.action === 'void' ? 'Void' : reasonModal?.action === 'refund' ? 'Refund' : 'Delete'} Sale`}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-500">Admin PIN will be required. Please provide a reason.</p>
          <Input label="Reason" value={reason} onChange={setReason} autoFocus />
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={() => setReasonModal(null)} className="flex-1">Cancel</Btn>
            <Btn variant="danger" onClick={handleAction} disabled={!reason} className="flex-1">Confirm</Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Admin Dashboard ─────────────────────────────────────────

function AdminDashboardPage() {
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));
  const { data: report, isLoading } = useSalesReport({ date_from: dateFrom, date_to: dateTo });
  const { data: shift } = useCurrentShift();
  const { navigate } = useUIStore();

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden">
      <div className="px-4 py-3 bg-white border-b border-gray-200 shadow-sm shrink-0 flex gap-2 items-end flex-wrap">
        <Input label="From" type="date" value={dateFrom} onChange={setDateFrom} className="w-36" />
        <Input label="To" type="date" value={dateTo} onChange={setDateTo} className="w-36" />
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <RefreshCw className="animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="max-w-4xl mx-auto flex flex-col gap-6">
            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard icon={<DollarSign size={18} />} label="Revenue" value={fmt(report?.total_revenue ?? 0)} color="green" />
              <KpiCard icon={<Receipt size={18} />} label="Transactions" value={String(report?.transaction_count ?? 0)} color="blue" />
              <KpiCard icon={<TrendingUp size={18} />} label="Avg Sale"
                value={fmt(report?.transaction_count ? (report.total_revenue / report.transaction_count) : 0)} color="yellow" />
              <KpiCard icon={<Tag size={18} />} label="Discounts" value={fmt(report?.total_discount ?? 0)} color="red" />
            </div>

            {/* Payment breakdown */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <h3 className="text-sm font-bold text-gray-700 mb-4">Payment Methods</h3>
              <div className="flex flex-col gap-3">
                {(Object.entries(report?.payment_breakdown ?? {}) as [string, number][]).map(([method, amount]) => {
                  const pct = report?.total_revenue ? (amount / report.total_revenue) * 100 : 0;
                  return (
                    <div key={method}>
                      <div className="flex justify-between text-sm mb-1.5">
                        <span className="text-gray-600 font-semibold uppercase text-xs">{method}</span>
                        <span className="text-gray-900 font-bold">{fmt(amount)}</span>
                      </div>
                      <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: method === 'cash' ? '#22c55e' : method === 'gcash' ? MANGO : '#60a5fa'
                          }} />
                      </div>
                    </div>
                  );
                })}
                {!Object.keys(report?.payment_breakdown ?? {}).length && (
                  <p className="text-gray-400 text-sm">No payment data for this period</p>
                )}
              </div>
            </div>

            {/* Current shift */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <h3 className="text-sm font-bold text-gray-700 mb-4">Current Shift</h3>
              {shift ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <StatCard label="Float" value={fmt(shift.starting_float)} />
                  <StatCard label="Cash Sales" value={fmt(shift.payment_totals?.cash ?? 0)} />
                  <StatCard label="GCash / Maya"
                    value={fmt((shift.payment_totals?.gcash ?? 0) + (shift.payment_totals?.maya ?? 0))} />
                </div>
              ) : (
                <p className="text-gray-400 text-sm">No shift currently open.</p>
              )}
            </div>

            {/* Quick links */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {([
                { label: 'Manage Menu', page: 'admin_menu' as Page, icon: <Coffee size={16} /> },
                { label: 'Staff', page: 'admin_employees' as Page, icon: <Users size={16} /> },
                { label: 'Inventory', page: 'admin_inventory' as Page, icon: <Package size={16} /> },
                { label: 'Settings', page: 'admin_settings' as Page, icon: <Settings size={16} /> },
                { label: 'Audit Log', page: 'admin_audit' as Page, icon: <ShieldCheck size={16} /> },
              ]).map(l => (
                <button key={l.page} onClick={() => navigate(l.page)}
                  className="flex items-center gap-2.5 px-4 py-3.5 bg-white hover:bg-amber-50
                    border border-gray-200 hover:border-amber-300 rounded-xl text-gray-700 text-sm font-semibold
                    transition-all text-left shadow-sm">
                  <span style={{ color: MANGO }}>{l.icon}</span> {l.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: string; color: string;
}) {
  const colors: Record<string, string> = {
    green: 'text-green-600 bg-green-100',
    blue:  'text-blue-600 bg-blue-100',
    yellow:'text-amber-600 bg-amber-100',
    red:   'text-red-600 bg-red-100',
  };
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
      <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center mb-3', colors[color])}>
        {icon}
      </div>
      <div className="text-xs text-gray-500 font-semibold mb-1 uppercase tracking-wide">{label}</div>
      <div className="text-gray-900 font-black text-xl">{value}</div>
    </div>
  );
}

// ─── Admin Menu Page ─────────────────────────────────────────

function AdminMenuPage() {
  const { data: menuData, isLoading } = useMenu();
  const createCategory = useCreateCategory();
  const createItem = useCreateMenuItem();
  const updateItem = useUpdateMenuItem();
  const deleteItem = useDeleteMenuItem();
  const toggleAvailability = useToggleAvailability();
  const createAddon = useCreateAddon();
  const updateAddon = useUpdateAddon();

  const [tab, setTab] = useState<'items' | 'addons'>('items');
  const [newCatName, setNewCatName] = useState('');
  const [showAddItem, setShowAddItem] = useState(false);
  const [showAddAddon, setShowAddAddon] = useState(false);
  const [newItem, setNewItem] = useState({
    name: '', category_id: '',
    sizes: [{ name: 'Regular', price: '' }],
    addon_ids: [] as string[]
  });
  const [newAddon, setNewAddon] = useState({ name: '', price: '' });

  const categories = menuData?.categories ?? [];
  const allAddons = menuData?.addons ?? [];

  const handleAddCategory = async () => {
    if (!newCatName.trim()) return;
    await createCategory.mutateAsync({ name: newCatName, sort_order: categories.length });
    setNewCatName('');
    toast('Category added');
  };

  const handleAddItem = async () => {
    const sizes = newItem.sizes
      .filter(s => s.name && s.price)
      .map(s => ({ name: s.name, price: parseFloat(s.price) }));
    if (!newItem.name || !sizes.length) return;
    await createItem.mutateAsync({
      name: newItem.name,
      category_id: newItem.category_id || undefined,
      sizes,
      addon_ids: newItem.addon_ids,
    });
    setNewItem({ name: '', category_id: '', sizes: [{ name: 'Regular', price: '' }], addon_ids: [] });
    setShowAddItem(false);
    toast('Item added');
  };

  const handleAddAddon = async () => {
    if (!newAddon.name || !newAddon.price) return;
    await createAddon.mutateAsync({ name: newAddon.name, price: parseFloat(newAddon.price) });
    setNewAddon({ name: '', price: '' });
    setShowAddAddon(false);
    toast('Add-on added');
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden">
      <div className="px-4 py-3 bg-white border-b border-gray-200 shadow-sm shrink-0 flex items-center gap-3">
        <div className="flex bg-gray-100 p-1 rounded-xl gap-1">
          {(['items', 'addons'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={clsx('px-4 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all',
                tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
              {t === 'items' ? 'Menu Items' : 'Add-ons'}
            </button>
          ))}
        </div>
        <Btn size="sm" variant="mango"
          onClick={() => tab === 'items' ? setShowAddItem(true) : setShowAddAddon(true)}>
          <Plus size={14} /> Add {tab === 'items' ? 'Item' : 'Add-on'}
        </Btn>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex justify-center py-12"><RefreshCw className="animate-spin text-gray-400" /></div>
        ) : tab === 'items' ? (
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex gap-2">
              <Input value={newCatName} onChange={setNewCatName} placeholder="New category name…" className="flex-1" />
              <Btn variant="secondary" onClick={handleAddCategory}
                disabled={!newCatName.trim()} loading={createCategory.isPending}>
                <Plus size={14} /> Add Category
              </Btn>
            </div>
            {categories.map((cat: Category) => (
              <div key={cat.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                  <span className="font-bold text-gray-900">{cat.name}</span>
                  <Badge color="gray">{cat.items.length} items</Badge>
                </div>
                <div className="divide-y divide-gray-100">
                  {cat.items.map((item: MenuItem) => (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={clsx('text-sm font-semibold',
                            item.is_active ? 'text-gray-900' : 'text-gray-400 line-through')}>
                            {item.name}
                          </span>
                          {!item.is_available && <Badge color="red">86'd</Badge>}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {item.sizes.map(s => `${s.name}: ${fmt(s.price)}`).join(' · ')}
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          onClick={() => toggleAvailability.mutate({ id: item.id, is_available: !item.is_available })}
                          className={clsx('px-2.5 py-1 rounded-lg text-xs font-bold transition-all',
                            item.is_available
                              ? 'bg-green-100 text-green-700 hover:bg-green-200'
                              : 'bg-red-100 text-red-700 hover:bg-red-200')}>
                          {item.is_available ? '✓ Available' : '86\'d'}
                        </button>
                        <button onClick={() => updateItem.mutate({ id: item.id, is_active: !item.is_active })}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all"
                          title={item.is_active ? 'Deactivate' : 'Activate'}>
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={async () => { if (confirm(`Delete "${item.name}"?`)) await deleteItem.mutateAsync(item.id); }}
                          className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {cat.items.length === 0 && (
                    <div className="px-4 py-4 text-xs text-gray-400 text-center">No items in this category</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="max-w-2xl mx-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {allAddons.map((addon: Addon) => (
                <div key={addon.id}
                  className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
                  <div>
                    <div className="text-gray-900 font-semibold text-sm">{addon.name}</div>
                    <div className="text-xs font-bold mt-0.5" style={{ color: MANGO }}>+{fmt(addon.price)}</div>
                  </div>
                  <button
                    onClick={() => updateAddon.mutate({ id: addon.id, is_available: !addon.is_available })}
                    className={clsx('px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                      addon.is_available
                        ? 'bg-green-100 text-green-700 hover:bg-green-200'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}>
                    {addon.is_available ? 'Available' : 'Unavailable'}
                  </button>
                </div>
              ))}
              {!allAddons.length && (
                <div className="col-span-2 text-center text-gray-400 py-8">No add-ons yet</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add Item Modal */}
      <Modal open={showAddItem} onClose={() => setShowAddItem(false)} title="Add Menu Item" maxWidth="max-w-md">
        <div className="flex flex-col gap-3">
          <Input label="Item Name" value={newItem.name} onChange={v => setNewItem(p => ({ ...p, name: v }))} />
          <Select label="Category" value={newItem.category_id}
            onChange={v => setNewItem(p => ({ ...p, category_id: v }))}
            options={[
              { value: '', label: '— No category —' },
              ...categories.map((c: Category) => ({ value: c.id, label: c.name }))
            ]} />
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Sizes & Prices</div>
            {newItem.sizes.map((s, i) => (
              <div key={i} className="flex gap-2 mb-2 items-start">
                <Input value={s.name}
                  onChange={v => setNewItem(p => ({ ...p, sizes: p.sizes.map((sz, j) => j === i ? { ...sz, name: v } : sz) }))}
                  placeholder="Size name" className="flex-1" />
                <Input type="number" value={s.price}
                  onChange={v => setNewItem(p => ({ ...p, sizes: p.sizes.map((sz, j) => j === i ? { ...sz, price: v } : sz) }))}
                  placeholder="Price" className="w-24" />
                {newItem.sizes.length > 1 && (
                  <button onClick={() => setNewItem(p => ({ ...p, sizes: p.sizes.filter((_, j) => j !== i) }))}
                    className="text-gray-400 hover:text-red-500 mt-2.5 p-1"><X size={14} /></button>
                )}
              </div>
            ))}
            <Btn size="sm" variant="ghost"
              onClick={() => setNewItem(p => ({ ...p, sizes: [...p.sizes, { name: '', price: '' }] }))}>
              <Plus size={12} /> Add Size
            </Btn>
          </div>
          {allAddons.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Add-ons</div>
              <div className="flex flex-wrap gap-1.5">
                {allAddons.map((a: Addon) => {
                  const sel = newItem.addon_ids.includes(a.id);
                  return (
                    <button key={a.id}
                      onClick={() => setNewItem(p => ({
                        ...p,
                        addon_ids: sel ? p.addon_ids.filter(id => id !== a.id) : [...p.addon_ids, a.id],
                      }))}
                      className={clsx('px-3 py-1 rounded-full text-xs font-semibold transition-all border',
                        sel
                          ? 'text-amber-900 border-amber-300'
                          : 'bg-gray-100 text-gray-600 border-gray-200 hover:border-gray-300'
                      )}
                      style={sel ? { backgroundColor: MANGO_LIGHT, borderColor: MANGO } : {}}>
                      {a.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <Divider />
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={() => setShowAddItem(false)} className="flex-1">Cancel</Btn>
            <Btn variant="mango" onClick={handleAddItem} loading={createItem.isPending}
              disabled={!newItem.name || newItem.sizes.every(s => !s.price)} className="flex-1">
              Add Item
            </Btn>
          </div>
        </div>
      </Modal>

      {/* Add Addon Modal */}
      <Modal open={showAddAddon} onClose={() => setShowAddAddon(false)} title="Add Add-on">
        <div className="flex flex-col gap-3">
          <Input label="Add-on Name" value={newAddon.name} onChange={v => setNewAddon(p => ({ ...p, name: v }))} />
          <Input label="Price (₱)" type="number" value={newAddon.price}
            onChange={v => setNewAddon(p => ({ ...p, price: v }))} min={0} step={0.01} />
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={() => setShowAddAddon(false)} className="flex-1">Cancel</Btn>
            <Btn variant="mango" onClick={handleAddAddon} loading={createAddon.isPending}
              disabled={!newAddon.name || !newAddon.price} className="flex-1">Add</Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Admin Staff Page (no time logs) ────────────────────────

function AdminEmployeesPage() {
  const { data: users, isLoading } = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const resetPin = useResetPin();
  const openPinModal = useUIStore(s => s.openPinModal);
  const { user: me } = useAuthStore();

  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', role: 'crew' as 'crew' | 'admin', pin: '' });
  const [pinReset, setPinReset] = useState<{ userId: string; newPin: string } | null>(null);

  const handleAddUser = async () => {
    // Validate form first, then ask for PIN
    if (!newUser.name || newUser.pin.length !== 6) return;
    const ok = await openPinModal({ required_role: 'admin' });
    if (!ok) return;
    try {
      await createUser.mutateAsync(newUser);
      setNewUser({ name: '', role: 'crew', pin: '' });
      setShowAddUser(false);
      toast('User created');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Error creating user', 'error');
    }
  };

  const handleResetPin = async () => {
    if (!pinReset || pinReset.newPin.length !== 6) return;
    const ok = await openPinModal({ required_role: 'admin' });
    if (!ok) return;
    try {
      await resetPin.mutateAsync({ id: pinReset.userId, new_pin: pinReset.newPin });
      setPinReset(null);
      toast('PIN reset successfully');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Error resetting PIN', 'error');
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden">
      <div className="px-4 py-3 bg-white border-b border-gray-200 shadow-sm shrink-0 flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-900">Staff Management</h2>
        <Btn size="sm" variant="mango" onClick={() => setShowAddUser(true)}>
          <Plus size={14} /> Add Staff
        </Btn>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-2xl mx-auto">
          {isLoading ? (
            <div className="flex justify-center py-12"><RefreshCw className="animate-spin text-gray-400" /></div>
          ) : (
            <div className="flex flex-col gap-2">
              {users?.map((u: User) => (
                <div key={u.id}
                  className={clsx(
                    'bg-white border rounded-2xl px-4 py-4 flex items-center gap-3 shadow-sm transition-all',
                    u.is_active ? 'border-gray-200' : 'border-gray-100 opacity-60'
                  )}>
                  <div className="w-12 h-12 rounded-full flex items-center justify-center font-black text-amber-900 text-lg shrink-0"
                    style={{ backgroundColor: MANGO }}>
                    {u.name[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-gray-900 font-semibold">{u.name}</span>
                      <Badge color={u.role === 'admin' ? 'yellow' : 'gray'}>{u.role}</Badge>
                      {!u.is_active && <Badge color="red">inactive</Badge>}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {u.id === me?.id ? 'You' : u.role === 'admin' ? 'Administrator' : 'Staff Member'}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Btn size="sm" variant="ghost"
                      onClick={() => setPinReset({ userId: u.id, newPin: '' })}
                      title="Reset PIN">
                      <ShieldCheck size={14} />
                    </Btn>
                    <Btn size="sm" variant="secondary"
                      onClick={() => updateUser.mutate({ id: u.id, is_active: !u.is_active })}
                      disabled={u.id === me?.id}>
                      {u.is_active ? 'Deactivate' : 'Activate'}
                    </Btn>
                  </div>
                </div>
              ))}
              {!users?.length && (
                <div className="text-center text-gray-400 py-12">No staff members found</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add User Modal */}
      <Modal open={showAddUser} onClose={() => setShowAddUser(false)} title="Add Staff Member">
        <div className="flex flex-col gap-4">
          <Input label="Full Name" value={newUser.name}
            onChange={v => setNewUser(p => ({ ...p, name: v }))} autoFocus />
          <Select label="Role" value={newUser.role}
            onChange={v => setNewUser(p => ({ ...p, role: v as 'crew' | 'admin' }))}
            options={[{ value: 'crew', label: 'Staff / Crew' }, { value: 'admin', label: 'Admin' }]} />
          <Input label="6-Digit PIN" type="password" value={newUser.pin} maxLength={6}
            placeholder="Enter 6 digits"
            onChange={v => setNewUser(p => ({ ...p, pin: v.replace(/\D/g, '').slice(0, 6) }))} />
          {newUser.pin.length > 0 && newUser.pin.length < 6 && (
            <p className="text-xs text-amber-600">{6 - newUser.pin.length} more digit(s) needed</p>
          )}
          <Divider />
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={() => setShowAddUser(false)} className="flex-1">Cancel</Btn>
            <Btn variant="mango" onClick={handleAddUser} loading={createUser.isPending}
              disabled={!newUser.name || newUser.pin.length !== 6} className="flex-1">
              Create & Save
            </Btn>
          </div>
        </div>
      </Modal>

      {/* Reset PIN Modal */}
      <Modal open={!!pinReset} onClose={() => setPinReset(null)} title="Reset Staff PIN">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-500">Enter a new 6-digit PIN. Admin PIN will be required to confirm.</p>
          <Input label="New 6-Digit PIN" type="password" value={pinReset?.newPin ?? ''} maxLength={6}
            placeholder="Enter 6 digits"
            onChange={v => setPinReset(p => p ? { ...p, newPin: v.replace(/\D/g, '').slice(0, 6) } : null)} />
          {pinReset?.newPin && pinReset.newPin.length < 6 && (
            <p className="text-xs text-amber-600">{6 - pinReset.newPin.length} more digit(s) needed</p>
          )}
          <Divider />
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={() => setPinReset(null)} className="flex-1">Cancel</Btn>
            <Btn variant="mango" onClick={handleResetPin} loading={resetPin.isPending}
              disabled={pinReset?.newPin.length !== 6} className="flex-1">Reset PIN</Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Admin Inventory Page ────────────────────────────────────

function AdminInventoryPage() {
  const { data, isLoading } = useInventory();
  const createItem = useCreateInventoryItem();
  const createTx = useCreateInventoryTransaction();

  const [showAddItem, setShowAddItem] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', unit: '' });
  const [txModal, setTxModal] = useState<{ item_id: string; name: string } | null>(null);
  const [tx, setTx] = useState({
    type: 'stock_in' as 'stock_in' | 'stock_out' | 'wastage',
    qty: '', cost: '', reason: ''
  });

  const handleAddItem = async () => {
    if (!newItem.name || !newItem.unit) return;
    await createItem.mutateAsync(newItem);
    setNewItem({ name: '', unit: '' });
    setShowAddItem(false);
    toast('Item added');
  };

  const handleTransaction = async () => {
    if (!txModal || !tx.qty) return;
    await createTx.mutateAsync({
      item_id: txModal.item_id, type: tx.type,
      qty: parseFloat(tx.qty),
      cost: tx.cost ? parseFloat(tx.cost) : undefined,
      reason: tx.reason || undefined,
    });
    setTxModal(null);
    setTx({ type: 'stock_in', qty: '', cost: '', reason: '' });
    toast('Transaction recorded');
  };

  const txColor = (type: string) =>
    type === 'stock_in' ? 'green' : type === 'wastage' ? 'yellow' : 'red';

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden">
      <div className="px-4 py-3 bg-white border-b border-gray-200 shadow-sm shrink-0 flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-900">Inventory</h2>
        <Btn size="sm" variant="mango" onClick={() => setShowAddItem(true)}>
          <Plus size={14} /> Add Item
        </Btn>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex justify-center py-12"><RefreshCw className="animate-spin text-gray-400" /></div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {data?.items.map((item: InventoryItem) => (
                <div key={item.id}
                  className="bg-white border border-gray-200 rounded-xl px-4 py-3.5 flex items-center justify-between shadow-sm">
                  <div>
                    <div className="text-gray-900 font-semibold text-sm">{item.name}</div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className={clsx('font-black text-base',
                        item.current_stock <= 0 ? 'text-red-500' :
                        item.current_stock < 5 ? 'text-amber-500' : 'text-green-600')}>
                        {item.current_stock}
                      </span>
                      <span className="text-xs text-gray-400">{item.unit}</span>
                      {item.current_stock <= 0 && <Badge color="red">Out</Badge>}
                      {item.current_stock > 0 && item.current_stock < 5 && <Badge color="yellow">Low</Badge>}
                    </div>
                  </div>
                  <Btn size="sm" variant="secondary"
                    onClick={() => { setTxModal({ item_id: item.id, name: item.name }); setTx({ type: 'stock_in', qty: '', cost: '', reason: '' }); }}>
                    Log
                  </Btn>
                </div>
              ))}
              {!data?.items.length && (
                <div className="col-span-3 text-center text-gray-400 py-10">No inventory items</div>
              )}
            </div>

            {data?.transactions.length ? (
              <div>
                <h3 className="text-xs text-gray-500 font-bold uppercase tracking-wide mb-2">Recent Transactions</h3>
                <div className="flex flex-col gap-1.5">
                  {data.transactions.slice(0, 20).map((t: InventoryTransaction) => (
                    <div key={t.id}
                      className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-3.5 py-3 shadow-sm">
                      <Badge color={txColor(t.type)}>{t.type.replace('_', ' ')}</Badge>
                      <div className="flex-1 min-w-0">
                        <span className="text-gray-900 text-sm font-semibold">
                          {data.items.find(i => i.id === t.item_id)?.name ?? t.item_id}
                        </span>
                        {t.reason && <span className="text-gray-400 text-xs ml-2">{t.reason}</span>}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold text-gray-900">{t.qty}</div>
                        {t.cost && <div className="text-xs text-gray-400">{fmt(t.cost)}</div>}
                      </div>
                      <div className="text-xs text-gray-400 hidden sm:block">{t.user_name}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <Modal open={showAddItem} onClose={() => setShowAddItem(false)} title="Add Inventory Item">
        <div className="flex flex-col gap-3">
          <Input label="Item Name" value={newItem.name} onChange={v => setNewItem(p => ({ ...p, name: v }))} />
          <Input label="Unit (e.g. kg, pcs, liters)" value={newItem.unit} onChange={v => setNewItem(p => ({ ...p, unit: v }))} />
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={() => setShowAddItem(false)} className="flex-1">Cancel</Btn>
            <Btn variant="mango" onClick={handleAddItem} loading={createItem.isPending}
              disabled={!newItem.name || !newItem.unit} className="flex-1">Add</Btn>
          </div>
        </div>
      </Modal>

      <Modal open={!!txModal} onClose={() => setTxModal(null)} title={`Log: ${txModal?.name}`}>
        <div className="flex flex-col gap-3">
          <Select label="Transaction Type" value={tx.type}
            onChange={v => setTx(p => ({ ...p, type: v as typeof tx.type }))}
            options={[
              { value: 'stock_in', label: '📦 Stock In' },
              { value: 'stock_out', label: '📤 Stock Out' },
              { value: 'wastage', label: '🗑 Wastage' },
            ]} />
          <Input label="Quantity" type="number" value={tx.qty} min={0} step={0.01}
            onChange={v => setTx(p => ({ ...p, qty: v }))} />
          {tx.type === 'stock_in' && (
            <Input label="Cost (optional)" type="number" value={tx.cost} min={0} step={0.01}
              onChange={v => setTx(p => ({ ...p, cost: v }))} />
          )}
          <Input label="Reason (optional)" value={tx.reason} onChange={v => setTx(p => ({ ...p, reason: v }))} />
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={() => setTxModal(null)} className="flex-1">Cancel</Btn>
            <Btn variant="mango" onClick={handleTransaction} loading={createTx.isPending}
              disabled={!tx.qty} className="flex-1">Save</Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Admin Settings Page ─────────────────────────────────────

function AdminSettingsPage() {
  const { data: settings, isLoading } = useSettings();
  const updateSettings = useUpdateSettings();
  const [form, setForm] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings) { setForm(settings); setDirty(false); }
  }, [settings]);

  const set = (key: string, val: string) => {
    setForm(p => ({ ...p, [key]: val }));
    setDirty(true);
  };

  const handleSave = async () => {
    await updateSettings.mutateAsync(form);
    setDirty(false);
    toast('Settings saved');
  };

  const fields: { key: string; label: string; type?: string; desc?: string }[] = [
    { key: 'store_name', label: 'Store Name' },
    { key: 'store_address', label: 'Store Address' },
    { key: 'store_contact', label: 'Contact Number' },
    { key: 'receipt_footer', label: 'Receipt Footer Message' },
    { key: 'sc_discount_pct', label: 'Senior Citizen Discount %', type: 'number', desc: 'Default: 20%' },
    { key: 'pwd_discount_pct', label: 'PWD Discount %', type: 'number', desc: 'Default: 20%' },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden">
      <div className="px-4 py-3 bg-white border-b border-gray-200 shadow-sm shrink-0 flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-900">System Settings</h2>
        {dirty && (
          <Btn variant="mango" size="sm" onClick={handleSave} loading={updateSettings.isPending}>
            <Save size={14} /> Save Changes
          </Btn>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex justify-center py-12"><RefreshCw className="animate-spin text-gray-400" /></div>
        ) : (
          <div className="max-w-md mx-auto">
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm divide-y divide-gray-100 overflow-hidden">
              {fields.map(f => (
                <div key={f.key} className="px-5 py-4">
                  <Input
                    label={f.label}
                    type={f.type ?? 'text'}
                    value={form[f.key] ?? ''}
                    onChange={v => set(f.key, v)}
                    placeholder={f.desc}
                  />
                </div>
              ))}
            </div>
            {dirty && (
              <Btn variant="mango" fullWidth onClick={handleSave}
                loading={updateSettings.isPending} className="mt-4">
                <Save size={16} /> Save All Changes
              </Btn>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Admin Audit Log Page ────────────────────────────────────

function AdminAuditPage() {
  const [entityType, setEntityType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const { data: logs, isLoading } = useAuditLogs({
    entity_type: entityType || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  });

  const actionColor = (action: string) => {
    if (action.includes('delete') || action.includes('void') || action.includes('remove')) return 'red';
    if (action.includes('create') || action.includes('open') || action.includes('clock_in')) return 'green';
    if (action.includes('update') || action.includes('edit') || action.includes('reset')) return 'yellow';
    return 'gray';
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden">
      <div className="px-4 py-3 bg-white border-b border-gray-200 shadow-sm shrink-0 flex flex-wrap gap-2 items-end">
        <Select label="Entity Type" value={entityType} onChange={setEntityType}
          options={[
            { value: '', label: 'All Types' },
            { value: 'sale', label: 'Sale' },
            { value: 'user', label: 'User' },
            { value: 'menu_item', label: 'Menu Item' },
            { value: 'shift', label: 'Shift' },
            { value: 'settings', label: 'Settings' },
          ]} className="w-36" />
        <Input label="From" type="date" value={dateFrom} onChange={setDateFrom} className="w-36" />
        <Input label="To" type="date" value={dateTo} onChange={setDateTo} className="w-36" />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex justify-center py-12"><RefreshCw className="animate-spin text-gray-400" /></div>
        ) : !logs?.length ? (
          <div className="text-center text-gray-400 py-16">
            <ShieldCheck size={40} className="mx-auto mb-3 opacity-30" />
            <p>No audit logs found</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto flex flex-col gap-2">
            {logs.map((log: AuditLog) => (
              <div key={log.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
                <div className="flex items-start gap-3">
                  <Badge color={actionColor(log.action)}>{log.action.replace(/_/g, ' ')}</Badge>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-gray-900 text-sm font-semibold">{log.user_name}</span>
                      <span className="text-gray-400 text-xs bg-gray-100 px-1.5 py-0.5 rounded">{log.entity_type}</span>
                      {log.entity_id && (
                        <span className="text-gray-300 text-xs font-mono">{log.entity_id.slice(0, 8)}…</span>
                      )}
                    </div>
                    {log.reason && (
                      <div className="text-amber-600 text-xs mt-0.5">Reason: {log.reason}</div>
                    )}
                    {log.new_value && (
                      <div className="text-gray-400 text-xs mt-0.5 truncate max-w-sm">
                        → {log.new_value.slice(0, 80)}{log.new_value.length > 80 ? '…' : ''}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 shrink-0 text-right">{fmtDate(log.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── App Shell & Router ──────────────────────────────────────

function AppShell() {
  const { page } = useUIStore();
  const { user } = useAuthStore();

  const pageMap: Partial<Record<Page, React.ReactNode>> = {
    pos:               <POSPage />,
    sales:             <SalesPage />,
    admin_dashboard:   <AdminDashboardPage />,
    admin_menu:        <AdminMenuPage />,
    admin_employees:   <AdminEmployeesPage />,
    admin_inventory:   <AdminInventoryPage />,
    admin_settings:    <AdminSettingsPage />,
    admin_audit:       <AdminAuditPage />,
  };

  const adminPages: Page[] = [
    'admin_dashboard', 'admin_menu', 'admin_employees',
    'admin_inventory', 'admin_settings', 'admin_audit'
  ];
  const currentPage: Page = adminPages.includes(page) && user?.role !== 'admin' ? 'pos' : page;

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden">
      <Header />
      <main className="flex-1 overflow-hidden">
        {pageMap[currentPage] ?? <POSPage />}
      </main>
      <PinModal />
    </div>
  );
}

export default function App() {
  const { user } = useAuthStore();
  if (!user) return <LoginPage />;
  return <AppShell />;
}