import React, { useState, useEffect, useCallback } from 'react';
import { format, parseISO } from 'date-fns';
import { clsx } from 'clsx';
import {
  ShoppingCart, Search, X, Plus, Minus, ChevronDown, ChevronUp,
  LogOut, Users, BarChart2, Settings, Package, Receipt,
  AlertTriangle, Printer, Trash2, Edit2, RefreshCw,
  DollarSign, TrendingUp, Menu as MenuIcon, ShieldCheck,
  ArrowLeft, Save, ChevronRight, Coffee, Tag,
} from 'lucide-react';
import { useAuthStore, useCartStore, useUIStore } from './store';
import type {
  User, Category, MenuItem, Addon, CartItem, SaleDetail,
  SaleListItem, Shift, PaymentLine, PaymentMethod, Page,
  HeldOrder, Settings as SettingsType,
  SaleItemDetail, ItemSize, CartAddon, CashDrop,
  AuditLog,
} from './types';
import {
  useUsersList, useLogin, useVerifyPin, useMenu, useCurrentShift,
  useOpenShift, useCloseShift, useCashDrop, useHeldOrders,
  useCreateHeldOrder, useDeleteHeldOrder, useCheckout, useSales,
  useSaleDetail, useVoidSale, useRefundSale, useSoftDeleteSale,
  useReprintSale, useSalesReport, useSettings, useUpdateSettings,
  useUsers, useCreateUser, useUpdateUser, useDeleteUser, useResetPin,
  useAuditLogs, useToggleAvailability, useCreateMenuItem,
  useUpdateMenuItem, useDeleteMenuItem, useCreateCategory,
  useUpdateAddon, useCreateAddon,
} from './api';

// ─── Category colour palette ───────────────────────────────────
// Each entry now carries a full-card background + border for the menu item widget
const CATEGORY_COLORS: {
  bg: string; text: string; border: string;
  pill: string; pillText: string; lightBg: string;
  cardBg: string; cardBorder: string; cardText: string; cardSubText: string;
}[] = [
  {
    bg: 'bg-amber-50',   text: 'text-amber-900',  border: 'border-amber-200',
    pill: '#F9D64C', pillText: '#78350f', lightBg: '#FFFBEB',
    cardBg: '#FFFBEB', cardBorder: '#FDE68A', cardText: '#78350f', cardSubText: '#92400e',
  },
  {
    bg: 'bg-emerald-50', text: 'text-emerald-900', border: 'border-emerald-200',
    pill: '#1C5E30', pillText: '#ffffff', lightBg: '#ECFDF5',
    cardBg: '#ECFDF5', cardBorder: '#6EE7B7', cardText: '#064e3b', cardSubText: '#065f46',
  },
  {
    bg: 'bg-rose-50',    text: 'text-rose-900',   border: 'border-rose-200',
    pill: '#E52636', pillText: '#ffffff', lightBg: '#FFF1F2',
    cardBg: '#FFF1F2', cardBorder: '#FECDD3', cardText: '#881337', cardSubText: '#9f1239',
  },
  {
    bg: 'bg-violet-50',  text: 'text-violet-900', border: 'border-violet-200',
    pill: '#7c3aed', pillText: '#ffffff', lightBg: '#F5F3FF',
    cardBg: '#F5F3FF', cardBorder: '#DDD6FE', cardText: '#4c1d95', cardSubText: '#5b21b6',
  },
  {
    bg: 'bg-sky-50',     text: 'text-sky-900',    border: 'border-sky-200',
    pill: '#0284c7', pillText: '#ffffff', lightBg: '#F0F9FF',
    cardBg: '#F0F9FF', cardBorder: '#BAE6FD', cardText: '#0c4a6e', cardSubText: '#075985',
  },
  {
    bg: 'bg-orange-50',  text: 'text-orange-900', border: 'border-orange-200',
    pill: '#ea580c', pillText: '#ffffff', lightBg: '#FFF7ED',
    cardBg: '#FFF7ED', cardBorder: '#FED7AA', cardText: '#7c2d12', cardSubText: '#9a3412',
  },
  {
    bg: 'bg-pink-50',    text: 'text-pink-900',   border: 'border-pink-200',
    pill: '#db2777', pillText: '#ffffff', lightBg: '#FDF2F8',
    cardBg: '#FDF2F8', cardBorder: '#FBCFE8', cardText: '#831843', cardSubText: '#9d174d',
  },
  {
    bg: 'bg-teal-50',    text: 'text-teal-900',   border: 'border-teal-200',
    pill: '#0f766e', pillText: '#ffffff', lightBg: '#F0FDFA',
    cardBg: '#F0FDFA', cardBorder: '#99F6E4', cardText: '#134e4a', cardSubText: '#115e59',
  },
];
function getCategoryColor(idx: number) {
  return CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
}

// ─── Helpers ────────────────────────────────────────────────
function fmt(amount: number) { return `₱${amount.toFixed(2)}`; }
function fmtDate(iso: string) {
  try { return format(parseISO(iso), 'MMM d, yyyy h:mm a'); } catch { return iso; }
}

// ─── Toast ──────────────────────────────────────────────────
function toast(msg: string, type: 'success' | 'error' = 'success') {
  const el = document.createElement('div');
  el.className = [
    'fixed top-5 right-5 z-[999] px-4 py-3 rounded-2xl text-sm font-semibold shadow-xl transition-all border backdrop-blur-sm toast-enter',
    type === 'success'
      ? 'bg-white/95 text-emerald-800 border-emerald-200'
      : 'bg-white/95 text-red-700 border-red-200',
  ].join(' ');
  const icon = type === 'success' ? '✓' : '✕';
  el.innerHTML = `<span class="mr-2 font-black">${icon}</span>${msg}`;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(-6px)'; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

function Divider() { return <div className="border-t border-gray-100 my-1" />; }

// ─── UI Primitives ────────────────────────────────────────────
function Btn({
  children, onClick, variant = 'primary', size = 'md',
  disabled, loading, className, type = 'button', fullWidth, title,
}: {
  children: React.ReactNode; onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'mango' | 'warrior' | 'leaf' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean; loading?: boolean;
  className?: string; type?: 'button' | 'submit'; fullWidth?: boolean; title?: string;
}) {
  const base = [
    'inline-flex items-center justify-center font-semibold rounded-xl transition-all duration-150',
    'active:scale-95 select-none whitespace-nowrap cursor-pointer',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
    'disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none',
  ].join(' ');

  const sizes = {
    sm: 'px-3.5 py-2 text-xs gap-1.5 h-8',
    md: 'px-4 py-2.5 text-sm gap-2 h-10',
    lg: 'px-6 py-3 text-base gap-2.5 h-12',
  };

  const styles: React.CSSProperties = {};
  let cls = '';

  switch (variant) {
    case 'mango':
      styles.backgroundColor = 'var(--mango-yellow)';
      styles.color = '#78350f';
      styles.boxShadow = '0 2px 8px rgba(249,214,76,0.4)';
      cls = 'hover:brightness-105 active:brightness-95 focus-visible:ring-yellow-400';
      break;
    case 'warrior':
      styles.backgroundColor = 'var(--warrior-red)';
      styles.color = '#fff';
      styles.boxShadow = '0 2px 8px rgba(229,38,54,0.3)';
      cls = 'hover:brightness-105 active:brightness-95 focus-visible:ring-red-400';
      break;
    case 'leaf':
      styles.backgroundColor = 'var(--leaf-green)';
      styles.color = '#fff';
      styles.boxShadow = '0 2px 8px rgba(28,94,48,0.25)';
      cls = 'hover:brightness-105 active:brightness-95 focus-visible:ring-green-400';
      break;
    case 'danger':
      cls = 'bg-red-500 text-white hover:bg-red-600 focus-visible:ring-red-400 shadow-sm';
      break;
    case 'secondary':
      cls = 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 hover:border-gray-300 focus-visible:ring-gray-300 shadow-sm';
      break;
    case 'outline':
      styles.borderColor = 'var(--mango-yellow)';
      styles.color = '#78350f';
      cls = 'bg-transparent border hover:bg-yellow-50 focus-visible:ring-yellow-400';
      break;
    case 'ghost':
      cls = 'text-gray-500 hover:text-gray-900 hover:bg-gray-100 focus-visible:ring-gray-300';
      break;
    default:
      cls = 'bg-gray-900 text-white hover:bg-gray-800 focus-visible:ring-gray-500 shadow-sm';
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      className={clsx(base, sizes[size], cls, fullWidth && 'w-full', className)}
      style={styles}
    >
      {loading
        ? <RefreshCw size={size === 'sm' ? 12 : 14} className="animate-spin" />
        : children}
    </button>
  );
}

function Input({
  label, value, onChange, type = 'text', placeholder,
  className, disabled, min, step, maxLength, autoFocus, hint,
}: {
  label?: string; value: string | number; onChange: (v: string) => void;
  type?: string; placeholder?: string; className?: string; disabled?: boolean;
  min?: number; step?: number; maxLength?: number; autoFocus?: boolean; hint?: string;
}) {
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      {label && (
        <label className="text-xs font-700 text-gray-500 uppercase tracking-widest" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '0.08em' }}>
          {label}
        </label>
      )}
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} disabled={disabled}
        min={min} step={step} maxLength={maxLength} autoFocus={autoFocus}
        className={clsx(
          'bg-white border border-gray-200 text-gray-900 rounded-xl px-3.5 py-2.5 text-sm w-full',
          'focus:outline-none focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/20',
          'placeholder-gray-350 disabled:opacity-50 disabled:bg-gray-50',
          'transition-colors duration-150',
          'font-medium'
        )}
        style={{ fontFamily: 'var(--font-body)' }}
      />
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
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
    <div className={clsx('flex flex-col gap-1.5', className)}>
      {label && (
        <label className="text-xs font-700 text-gray-500 uppercase tracking-widest" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '0.08em' }}>
          {label}
        </label>
      )}
      <select
        value={value} onChange={e => onChange(e.target.value)}
        className="bg-white border border-gray-200 text-gray-900 rounded-xl px-3.5 py-2.5 text-sm
          focus:outline-none focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/20
          transition-colors duration-150 font-medium cursor-pointer appearance-none"
        style={{ fontFamily: 'var(--font-body)', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2371717A' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
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
      <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" onClick={onClose} />
      <div className={clsx(
        'relative bg-white rounded-2xl shadow-2xl w-full max-h-[90vh] overflow-y-auto animate-bounce-in',
        'border border-gray-100',
        maxWidth
      )}>
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white/95 backdrop-blur-sm z-10 rounded-t-2xl">
            <h2 className="text-base font-800 text-gray-900" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>{title}</h2>
            {onClose && (
              <button onClick={onClose}
                className="text-gray-400 hover:text-gray-700 p-1.5 rounded-xl hover:bg-gray-100 transition-colors">
                <X size={16} />
              </button>
            )}
          </div>
        )}
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function Badge({ children, color = 'gray' }: { children: React.ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    gray:   'bg-gray-100 text-gray-600 border-gray-200',
    green:  'bg-emerald-50 text-emerald-700 border-emerald-200',
    red:    'bg-red-50 text-red-600 border-red-200',
    yellow: 'bg-amber-50 text-amber-700 border-amber-200',
    blue:   'bg-sky-50 text-sky-700 border-sky-200',
  };
  return (
    <span className={clsx('px-2 py-0.5 rounded-full text-xs font-700 border inline-flex items-center', colors[color] ?? colors.gray)}
      style={{ fontWeight: 700, letterSpacing: '0.01em' }}>
      {children}
    </span>
  );
}

// ─── Audit log formatter ─────────────────────────────────────
function formatAuditEntry(log: AuditLog): { title: string; detail: string | null } {
  const action = log.action.replace(/_/g, ' ');
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  let parsed: Record<string, unknown> | null = null;
  if (log.new_value) { try { parsed = JSON.parse(log.new_value); } catch { /* not json */ } }
  const label = capitalize(action);
  const details: string[] = [];
  if (log.reason) details.push(`Reason: ${log.reason}`);
  if (parsed) {
    const fieldMap: Record<string, string> = {
      closing_cash: 'Closing Cash', starting_float: 'Starting Float', variance: 'Variance',
      notes: 'Notes', name: 'Name', role: 'Role', amount: 'Amount', reason: 'Reason',
      store_name: 'Store Name', store_address: 'Address', receipt_footer: 'Receipt Footer',
      sc_discount_pct: 'SC Discount %', pwd_discount_pct: 'PWD Discount %', total: 'Total',
      status: 'Status', order_type: 'Order Type', qty: 'Qty', type: 'Type',
    };
    Object.entries(fieldMap).forEach(([key, readable]) => {
      if (parsed && key in parsed && parsed[key] !== undefined && parsed[key] !== null && parsed[key] !== '') {
        const val = parsed[key];
        if (['closing_cash', 'starting_float', 'variance', 'amount', 'total'].includes(key)) {
          details.push(`${readable}: ₱${Number(val).toFixed(2)}`);
        } else {
          details.push(`${readable}: ${val}`);
        }
      }
    });
  } else if (log.new_value && !parsed) {
    if (log.new_value.length < 120) details.push(log.new_value);
  }
  return { title: label, detail: details.length > 0 ? details.join(' · ') : null };
}

// ─── PIN Modal ────────────────────────────────────────────────
function PinModal() {
  const { pinModal, resolvePinModal } = useUIStore();
  const { user } = useAuthStore();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const verifyPin = useVerifyPin();

  useEffect(() => {
    if (pinModal.open) { setPin(''); setError(''); }
  }, [pinModal.open]);

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
    if (val === 'DEL') { setPin(p => p.slice(0, -1)); setError(''); return; }
    if (pin.length >= 6) return;
    const next = pin + val;
    setPin(next);
    setError('');
    if (next.length === 6) setTimeout(() => doSubmit(next), 50);
  };

  return (
    <Modal
      open={pinModal.open}
      onClose={() => resolvePinModal(false)}
      title={pinModal.required_role === 'admin' ? '🔒 Admin Verification' : '🔒 Enter PIN'}
    >
      <div className="flex flex-col items-center gap-6">
        <p className="text-sm text-gray-500 text-center leading-relaxed">
          {pinModal.required_role === 'admin'
            ? 'Admin PIN required to continue'
            : 'Enter your 6-digit PIN to continue'}
        </p>

        <div className="flex gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={clsx(
              'w-12 h-12 rounded-full border-2 flex items-center justify-center text-xl transition-all duration-150',
              i < pin.length
                ? 'border-yellow-400 shadow-[0_0_0_4px_rgba(249,214,76,0.15)]'
                : 'border-gray-200 bg-gray-50'
            )} style={i < pin.length ? { backgroundColor: 'var(--mango-yellow)' } : {}}>
              {i < pin.length && <span className="text-amber-900 font-black text-sm">●</span>}
            </div>
          ))}
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 px-4 py-2.5 rounded-xl border border-red-100 w-full justify-center font-medium">
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2.5 w-full max-w-[240px]">
          {['1','2','3','4','5','6','7','8','9','','0','DEL'].map((k, i) =>
            k === '' ? <div key={i} /> : (
              <button key={i} onClick={() => press(k)}
                className={clsx(
                  'h-14 rounded-xl font-bold text-lg transition-all duration-100 active:scale-95 border select-none',
                  k === 'DEL'
                    ? 'bg-gray-100 text-gray-500 text-sm border-gray-200 hover:bg-gray-200'
                    : 'bg-white text-gray-900 border-gray-200 hover:bg-yellow-50 hover:border-yellow-300 shadow-sm hover:shadow-md'
                )}
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {k}
              </button>
            )
          )}
        </div>
        <Btn onClick={() => resolvePinModal(false)} variant="ghost" size="sm">Cancel</Btn>
      </div>
    </Modal>
  );
}

// ─── Receipt ─────────────────────────────────────────────────
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

// ─── Login Page ───────────────────────────────────────────────
function LoginPage() {
  const { data: usersList, isLoading } = useUsersList();
  const login = useLogin();
  const { login: authLogin } = useAuthStore();
  const { navigate } = useUIStore();
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

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
    if (val === 'DEL') { setPin(p => p.slice(0, -1)); setError(''); return; }
    if (pin.length >= 6) return;
    const next = pin + val;
    setPin(next);
    setError('');
    if (next.length === 6 && selectedUser) setTimeout(() => doLogin(next, selectedUser), 50);
  };

  if (isLoading) return (
    <div className="h-full flex items-center justify-center" style={{ backgroundColor: 'var(--surface-page)' }}>
      <div className="flex flex-col items-center gap-3">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl"
          style={{ backgroundColor: 'var(--mango-yellow)' }}>🥭</div>
        <RefreshCw className="animate-spin text-gray-400" size={18} />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: 'linear-gradient(145deg, #FFFBEB 0%, #FEF3C0 40%, #FFF7ED 100%)' }}>
      <div className="absolute top-0 right-0 w-64 h-64 rounded-full opacity-20 blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, var(--mango-yellow) 0%, transparent 70%)', transform: 'translate(30%, -30%)' }} />
      <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full opacity-15 blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, var(--warrior-red) 0%, transparent 70%)', transform: 'translate(-30%, 30%)' }} />

      <div className="w-full max-w-sm relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl mb-4 shadow-lg"
            style={{ backgroundColor: 'var(--mango-yellow)', boxShadow: 'var(--shadow-mango)' }}>
            <span className="text-4xl" style={{ lineHeight: 1 }}>🥭</span>
          </div>
          <div className="text-4xl font-black mb-1" style={{ fontFamily: 'var(--font-display)' }}>
            <span style={{ color: '#E8A000' }}>Mango</span>
            <span style={{ color: 'var(--warrior-red)' }}>Warrior</span>
          </div>
          <div className="text-gray-500 text-sm font-medium tracking-wide">Point of Sale System</div>
        </div>

        <div className="bg-white/90 backdrop-blur-sm rounded-3xl shadow-2xl border border-white/60 p-6"
          style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.10), 0 2px 0 rgba(255,255,255,0.8) inset' }}>
          {!selectedUser ? (
            <div>
              <p className="text-gray-400 text-sm text-center mb-4 font-medium">Who's working today?</p>
              <div className="flex flex-col gap-2">
                {(usersList ?? []).map((u: User) => (
                  <button key={u.id}
                    onClick={() => { setSelectedUser(u); setPin(''); setError(''); }}
                    className="flex items-center gap-3.5 p-3.5 bg-gray-50 hover:bg-yellow-50 border border-gray-200
                      hover:border-yellow-300 rounded-2xl transition-all text-left group active:scale-98">
                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center font-black text-amber-900 text-base shrink-0 shadow-sm"
                      style={{ backgroundColor: 'var(--mango-yellow)', fontFamily: 'var(--font-display)' }}>
                      {u.name[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-gray-900 font-700 text-sm" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{u.name}</div>
                      <div className="text-gray-400 text-xs capitalize mt-0.5">{u.role}</div>
                    </div>
                    <ChevronRight size={15} className="text-gray-300 group-hover:text-yellow-500 transition-colors shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-5">
              <button onClick={() => { setSelectedUser(null); setPin(''); setError(''); }}
                className="flex items-center gap-1.5 text-gray-400 hover:text-gray-700 text-sm transition-colors self-start font-medium">
                <ArrowLeft size={14} /> Back
              </button>
              <div className="w-20 h-20 rounded-3xl flex items-center justify-center font-black text-3xl text-amber-900 shadow-md"
                style={{ backgroundColor: 'var(--mango-yellow)', fontFamily: 'var(--font-display)', boxShadow: 'var(--shadow-mango)' }}>
                {selectedUser.name[0].toUpperCase()}
              </div>
              <div className="text-center">
                <div className="text-gray-900 font-800 text-xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>{selectedUser.name}</div>
                <div className="text-gray-400 text-xs capitalize mt-0.5 tracking-wide">{selectedUser.role}</div>
              </div>
              <div className="flex gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className={clsx(
                    'w-12 h-12 rounded-full border-2 flex items-center justify-center transition-all duration-150',
                    i < pin.length
                      ? 'border-yellow-400 shadow-[0_0_0_4px_rgba(249,214,76,0.15)]'
                      : 'border-gray-200 bg-gray-50'
                  )} style={i < pin.length ? { backgroundColor: 'var(--mango-yellow)' } : {}}>
                    {i < pin.length && <span className="text-amber-900 font-black text-sm">●</span>}
                  </div>
                ))}
              </div>
              {error && (
                <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 px-4 py-2.5 rounded-xl border border-red-100 w-full justify-center font-medium">
                  <AlertTriangle size={14} /> {error}
                </div>
              )}
              <div className="grid grid-cols-3 gap-2.5 w-full max-w-[240px]">
                {['1','2','3','4','5','6','7','8','9','','0','DEL'].map((k, i) =>
                  k === '' ? <div key={i} /> : (
                    <button key={i} onClick={() => pressPin(k)}
                      className={clsx(
                        'h-14 rounded-xl font-bold text-lg transition-all duration-100 active:scale-95 border select-none',
                        k === 'DEL'
                          ? 'bg-gray-100 text-gray-500 text-sm border-gray-200 hover:bg-gray-200'
                          : 'bg-white text-gray-900 border-gray-200 hover:bg-yellow-50 hover:border-yellow-300 shadow-sm hover:shadow-md'
                      )}
                      style={{ fontFamily: 'var(--font-display)' }}>
                      {k}
                    </button>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Header ──────────────────────────────────────────────────
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
    { label: 'POS',       page: 'pos',              icon: <ShoppingCart size={14} /> },
    { label: 'Sales',     page: 'sales',            icon: <Receipt size={14} /> },
    { label: 'Dashboard', page: 'admin_dashboard',  icon: <BarChart2 size={14} />, adminOnly: true },
    { label: 'Menu',      page: 'admin_menu',       icon: <Coffee size={14} />,    adminOnly: true },
    { label: 'Staff',     page: 'admin_employees',  icon: <Users size={14} />,     adminOnly: true },
    { label: 'Settings',  page: 'admin_settings',   icon: <Settings size={14} />,  adminOnly: true },
    { label: 'Audit',     page: 'admin_audit',      icon: <ShieldCheck size={14} />, adminOnly: true },
  ];
  const visible = navItems.filter(n => !n.adminOnly || user?.role === 'admin');

  return (
    <header className="flex items-center h-14 px-4 bg-white border-b border-gray-150 shrink-0 z-30 relative"
      style={{ boxShadow: '0 1px 0 rgba(0,0,0,0.05), 0 2px 8px rgba(0,0,0,0.04)' }}>

      <div className="font-black text-base mr-5 flex items-center gap-2 shrink-0" style={{ fontFamily: 'var(--font-display)' }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0"
          style={{ backgroundColor: 'var(--mango-yellow)' }}>🥭</div>
        <span className="hidden sm:inline">
          <span style={{ color: '#D97706' }}>Mango</span><span style={{ color: 'var(--warrior-red)' }}>Warrior</span>
        </span>
      </div>

      <div className="mr-4 hidden sm:flex items-center gap-2 shrink-0">
        <div className={clsx(
          'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border',
          shift
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-gray-100 text-gray-500 border-gray-200'
        )}>
          <div className={clsx('w-1.5 h-1.5 rounded-full', shift ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400')} />
          {shift ? 'Shift Open' : 'No Shift'}
        </div>
      </div>

      <nav className="hidden md:flex items-center gap-1 flex-1">
        {visible.map((n) => {
          const isActive = page === n.page;
          return (
            <button key={n.page} onClick={() => navigate(n.page)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-150',
                isActive ? 'text-amber-900' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
              )}
              style={isActive ? { backgroundColor: 'var(--mango-yellow-lt)', color: '#78350f', fontWeight: 700 } : {}}>
              {n.icon} {n.label}
              {isActive && <div className="w-1 h-1 rounded-full bg-yellow-500 ml-0.5" />}
            </button>
          );
        })}
      </nav>

      <div className="md:hidden flex-1">
        <button onClick={() => setMenuOpen(v => !v)}
          className="text-gray-500 hover:text-gray-900 p-2 rounded-xl hover:bg-gray-100 transition-colors">
          <MenuIcon size={18} />
        </button>
        {menuOpen && (
          <div className="absolute top-14 left-0 right-0 bg-white border-b border-gray-200 shadow-xl z-50 p-3 flex flex-col gap-1 animate-fade-up">
            {visible.map((n) => {
              const isActive = page === n.page;
              return (
                <button key={n.page} onClick={() => { navigate(n.page); setMenuOpen(false); }}
                  className={clsx(
                    'flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all',
                    isActive ? 'text-amber-900' : 'text-gray-600 hover:bg-gray-50'
                  )}
                  style={isActive ? { backgroundColor: 'var(--mango-yellow-lt)', color: '#78350f' } : {}}>
                  {n.icon} {n.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 ml-auto">
        <div className="hidden sm:flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center font-black text-amber-900 text-sm"
            style={{ backgroundColor: 'var(--mango-yellow)', fontFamily: 'var(--font-display)' }}>
            {user?.name?.[0]?.toUpperCase()}
          </div>
          <div className="flex flex-col items-start">
            <span className="text-xs font-700 text-gray-800 leading-tight" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{user?.name}</span>
            <span className="text-xs text-gray-400 capitalize leading-tight">{user?.role}</span>
          </div>
        </div>
        <button onClick={handleLogout}
          className="text-gray-400 hover:text-red-500 transition-colors p-2 rounded-xl hover:bg-red-50 border border-transparent hover:border-red-100"
          title="Sign Out">
          <LogOut size={15} />
        </button>
      </div>
    </header>
  );
}

// ─── Cart Addon Picker Modal ───────────────────────────────────
function CartAddonPickerModal({
  cartKey, currentAddons, allAddons, onClose,
}: {
  cartKey: string; currentAddons: CartAddon[]; allAddons: Addon[]; onClose: () => void;
}) {
  const cart = useCartStore();
  const [selected, setSelected] = useState<CartAddon[]>(currentAddons.map(a => ({ ...a })));

  const toggleAddon = (addon: Addon) => {
    setSelected(prev => {
      const exists = prev.find(a => a.addon_id === addon.id);
      if (exists) return prev.filter(a => a.addon_id !== addon.id);
      return [...prev, { addon_id: addon.id, addon_name: addon.name, addon_price: addon.price, qty: 1 }];
    });
  };

  const changeQty = (addonId: string, delta: number) => {
    setSelected(prev => prev.map(a => a.addon_id === addonId ? { ...a, qty: Math.max(1, a.qty + delta) } : a));
  };

  const handleApply = () => { cart.setAddons(cartKey, selected); onClose(); };
  const availableAddons = allAddons.filter(a => a.is_available);
  const addonTotal = selected.reduce((s, a) => s + a.addon_price * a.qty, 0);

  return (
    <Modal open onClose={onClose} title="🧂 Add-ons" maxWidth="max-w-sm">
      <div className="flex flex-col gap-3">
        {availableAddons.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">No add-ons available</p>
        ) : (
          <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
            {availableAddons.map((addon) => {
              const sel = selected.find(a => a.addon_id === addon.id);
              return (
                <div key={addon.id}
                  className={clsx(
                    'flex items-center gap-3 px-4 py-3 rounded-2xl border-2 transition-all duration-150 cursor-pointer',
                    sel ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 bg-white hover:border-gray-300'
                  )}
                  onClick={() => toggleAddon(addon)}>
                  <div className={clsx(
                    'w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all',
                    sel ? 'border-yellow-500 bg-yellow-400' : 'border-gray-300'
                  )}>
                    {sel && <span className="text-amber-900 text-xs font-black" style={{ lineHeight: 1 }}>✓</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-600 text-gray-900" style={{ fontWeight: 600 }}>{addon.name}</div>
                    <div className="text-xs font-700 text-amber-700 mt-0.5">+{fmt(addon.price)} each</div>
                  </div>
                  {sel && (
                    <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                      <button onClick={() => changeQty(addon.id, -1)}
                        className="w-7 h-7 rounded-lg bg-white border border-gray-200 hover:bg-gray-100 flex items-center justify-center text-gray-600 shadow-sm transition-colors">
                        <Minus size={10} />
                      </button>
                      <span className="w-5 text-center text-sm font-800 text-gray-900" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>{sel.qty}</span>
                      <button onClick={() => changeQty(addon.id, 1)}
                        className="w-7 h-7 rounded-lg bg-white border border-yellow-200 hover:bg-yellow-50 flex items-center justify-center text-amber-700 shadow-sm transition-colors">
                        <Plus size={10} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {selected.length > 0 && (
          <div className="flex justify-between text-sm px-1 border-t border-gray-100 pt-3">
            <span className="text-gray-500 font-medium">{selected.length} add-on{selected.length > 1 ? 's' : ''} selected</span>
            <span className="font-800 text-amber-700" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>+{fmt(addonTotal)}</span>
          </div>
        )}
        <div className="flex gap-2">
          <Btn variant="secondary" onClick={onClose} className="flex-1">Cancel</Btn>
          <Btn variant="mango" onClick={handleApply} className="flex-1">Apply Add-ons</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ─── POS Page ──────────────────────────────────────────────────
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
  const allAddons = menuData?.addons ?? [];
  const allItems = categories.flatMap((c: Category) => c.items);

  const filteredItems = allItems.filter((item: MenuItem) => {
    if (!item.is_available) return false;
    const matchCat = activeCategory === 'all' || item.category_id === activeCategory;
    const matchSearch = item.name.toLowerCase().includes(searchQ.toLowerCase());
    return matchCat && matchSearch;
  });

  const groupedItems = categories
    .map((cat: Category, idx: number) => ({
      category: cat, colorIdx: idx,
      items: filteredItems.filter((item: MenuItem) => item.category_id === cat.id),
    }))
    .filter(g => g.items.length > 0);

  const uncategorizedItems = filteredItems.filter((item: MenuItem) => !item.category_id);

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
    if (item.sizes.length > 1) setSizeModal({ item });
    else addToCart(item, item.sizes[0]?.name, item.sizes[0]?.price);
  };

  const total = cart.total();
  const itemCount = cart.cart.items.reduce((s, i) => s + i.qty, 0);

  // ── CHANGED: full-card colored background per category ──
  const renderItemCard = (item: MenuItem, colorIdx: number) => {
    const color = getCategoryColor(colorIdx);
    const minPrice = Math.min(...item.sizes.map((s: ItemSize) => s.price));

    return (
      <button
        key={item.id}
        onClick={() => handleItemTap(item)}
        className="item-card group rounded-2xl p-3.5 text-left flex flex-col gap-1.5 relative overflow-hidden border-2"
        style={{
          backgroundColor: color.cardBg,
          borderColor: color.cardBorder,
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        {/* subtle inner glow strip at top */}
        <div className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl opacity-70"
          style={{ backgroundColor: color.pill }} />

        <div
          className="text-sm font-700 leading-snug line-clamp-2 flex-1 mt-0.5"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: color.cardText }}
        >
          {item.name}
        </div>

        <div className="flex items-end justify-between gap-1 mt-auto">
          <div>
            <div className="text-sm font-800" style={{ fontFamily: 'var(--font-display)', fontWeight: 800, color: color.cardSubText }}>
              {item.sizes.length > 1 ? `from ${fmt(minPrice)}` : fmt(minPrice)}
            </div>
            {item.sizes.length > 1 && (
              <div className="text-xs mt-0.5 font-medium" style={{ color: color.cardSubText, opacity: 0.7 }}>
                {item.sizes.length} sizes
              </div>
            )}
          </div>
          <div
            className="w-7 h-7 rounded-xl flex items-center justify-center transition-all group-hover:scale-110 shrink-0"
            style={{ backgroundColor: color.pill, color: color.pillText }}
          >
            <Plus size={13} />
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--surface-page)' }}>
      {!shift && (
        <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-amber-200"
          style={{ backgroundColor: 'var(--mango-yellow-lt)' }}>
          <span className="text-amber-800 text-xs flex items-center gap-1.5 font-semibold">
            <AlertTriangle size={13} /> No shift is currently open
          </span>
          <Btn size="sm" variant="mango" onClick={() => setShowShift(true)}>Open Shift</Btn>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* ── Menu panel ── */}
        <div className={clsx(
          'flex flex-col flex-1 min-w-0 overflow-hidden',
          mobileTab === 'cart' ? 'hidden md:flex' : 'flex'
        )} style={{ background: 'var(--surface-page)' }}>

          <div className="px-3 pt-3 pb-2 bg-white border-b border-gray-150 shrink-0"
            style={{ boxShadow: '0 1px 0 rgba(0,0,0,0.04)' }}>
            <div className="relative mb-3">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search menu items…"
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl pl-10 pr-10 py-2.5 text-sm
                  focus:outline-none focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/20
                  placeholder-gray-400 font-medium transition-colors"
              />
              {searchQ && (
                <button onClick={() => setSearchQ('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 transition-colors">
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="flex gap-2 overflow-x-auto pb-0.5 no-scrollbar">
              <button
                onClick={() => setActiveCategory('all')}
                className="shrink-0 px-4 py-1.5 rounded-full text-xs font-700 transition-all border"
                style={
                  activeCategory === 'all'
                    ? { backgroundColor: 'var(--mango-yellow)', color: '#78350f', borderColor: 'var(--mango-yellow)', fontWeight: 700, boxShadow: 'var(--shadow-mango)' }
                    : { backgroundColor: '#fff', color: '#71717A', borderColor: '#E4E4E7', fontWeight: 600 }
                }>
                All Items
              </button>
              {categories.map((c: Category, idx: number) => {
                const color = getCategoryColor(idx);
                const isActive = activeCategory === c.id;
                return (
                  <button key={c.id}
                    onClick={() => setActiveCategory(c.id)}
                    className="shrink-0 px-4 py-1.5 rounded-full text-xs font-700 transition-all border"
                    style={isActive
                      ? { backgroundColor: color.pill, color: color.pillText, borderColor: color.pill, fontWeight: 700, boxShadow: `0 2px 8px ${color.pill}40` }
                      : { backgroundColor: '#fff', color: color.pill, borderColor: color.pill + '50', fontWeight: 600 }
                    }>
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {menuLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="h-24 shimmer rounded-2xl" />
                ))}
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-center">
                <Coffee size={36} className="text-gray-200 mb-3" />
                <p className="text-gray-400 text-sm font-medium">No items found</p>
                {searchQ && <p className="text-gray-300 text-xs mt-1">Try a different search</p>}
              </div>
            ) : (
              <div className="space-y-5">
                {groupedItems.map(({ category, items, colorIdx }) => {
                  const color = getCategoryColor(colorIdx);
                  const showSection = activeCategory === 'all' || activeCategory === category.id;
                  if (!showSection) return null;
                  return (
                    <div key={category.id}>
                      <div className="flex items-center gap-2.5 mb-2.5">
                        <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                          style={{ backgroundColor: color.pill + '20' }}>
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color.pill }} />
                        </div>
                        <span className="text-xs font-800 uppercase tracking-widest text-gray-500"
                          style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>{category.name}</span>
                        <div className="flex-1 h-px bg-gray-150" />
                        <span className="text-xs text-gray-400 font-medium shrink-0">{items.length} items</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
                        {items.map(item => renderItemCard(item, colorIdx))}
                      </div>
                    </div>
                  );
                })}
                {uncategorizedItems.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2.5 mb-2.5">
                      <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 bg-gray-100">
                        <div className="w-2.5 h-2.5 rounded-full bg-gray-400" />
                      </div>
                      <span className="text-xs font-800 uppercase tracking-widest text-gray-400"
                        style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>Other</span>
                      <div className="flex-1 h-px bg-gray-150" />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
                      {uncategorizedItems.map(item => renderItemCard(item, categories.length))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Cart panel ── */}
        <div className={clsx(
          'flex flex-col bg-white border-l border-gray-150 shrink-0',
          'w-full md:w-72 lg:w-80 xl:w-88',
          mobileTab === 'menu' ? 'hidden md:flex' : 'flex'
        )}>
          <div className="px-4 py-3 border-b border-gray-100 shrink-0 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart size={15} className="text-gray-400" />
              <span className="text-sm font-700 text-gray-800" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                Order
              </span>
              {itemCount > 0 && (
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-800 text-amber-900"
                  style={{ backgroundColor: 'var(--mango-yellow)', fontFamily: 'var(--font-display)', fontWeight: 800 }}>
                  {itemCount}
                </div>
              )}
            </div>
            {cart.cart.items.length > 0 && (
              <button onClick={() => cart.clearCart()}
                className="text-xs text-gray-400 hover:text-red-500 font-medium transition-colors flex items-center gap-1">
                <Trash2 size={11} /> Clear
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3">
            {cart.cart.items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[120px] text-center py-8">
                <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center mb-3">
                  <ShoppingCart size={22} className="text-gray-300" />
                </div>
                <p className="text-sm font-semibold text-gray-400">Cart is empty</p>
                <p className="text-xs text-gray-300 mt-1">Tap any item to add it</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {cart.cart.items.map((item: CartItem) => (
                  <CartItemRow key={item.cart_key} item={item} allAddons={allAddons} />
                ))}
              </div>
            )}
          </div>

          <div className="px-3 pb-2 shrink-0">
            <textarea
              value={cart.cart.note}
              onChange={e => cart.setNote(e.target.value)}
              placeholder="Special instructions…"
              rows={2}
              className="w-full bg-gray-50 border border-gray-200 text-gray-700 rounded-xl px-3 py-2.5 text-xs
                focus:outline-none focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/20
                placeholder-gray-350 resize-none font-medium transition-colors"
            />
          </div>

          <div className="border-t border-gray-100 px-4 py-4 shrink-0"
            style={{ background: 'linear-gradient(180deg, #fff 0%, #FAFAF9 100%)' }}>
            <div className="space-y-1 mb-3">
              <div className="flex justify-between text-xs text-gray-500">
                <span className="font-medium">Subtotal</span>
                <span className="font-semibold text-gray-700">{fmt(cart.subtotal())}</span>
              </div>
              {cart.discountTotal() > 0 && (
                <div className="flex justify-between text-xs text-emerald-600">
                  <span className="font-medium">Discount</span>
                  <span className="font-semibold">−{fmt(cart.discountTotal())}</span>
                </div>
              )}
              <div className="flex justify-between items-baseline pt-1.5 border-t border-gray-100">
                <span className="text-sm font-700 text-gray-900" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>Total</span>
                <span className="text-2xl font-900 text-amber-900" style={{ fontFamily: 'var(--font-display)', fontWeight: 900 }}>
                  {fmt(total)}
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <Btn
                variant="secondary"
                size="sm"
                onClick={() => setShowHeld(true)}
                disabled={cart.cart.items.length === 0}
                className="flex-1"
              >
                Hold
              </Btn>
              <Btn
                variant="mango"
                size="md"
                className="flex-[2]"
                onClick={() => setShowCheckout(true)}
                disabled={cart.cart.items.length === 0}
              >
                <Receipt size={15} />
                Pay {itemCount > 0 && `· ${itemCount}`}
              </Btn>
            </div>

            {shift && (
              <button onClick={() => setShowShift(true)}
                className="w-full mt-2.5 text-xs text-gray-400 hover:text-gray-600 transition-colors font-medium text-center">
                Shift actions ›
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="md:hidden flex border-t border-gray-200 bg-white shrink-0 safe-area-inset-bottom">
        <button
          onClick={() => setMobileTab('menu')}
          className={clsx(
            'flex-1 flex flex-col items-center py-3 text-xs font-700 gap-1 transition-colors',
            mobileTab === 'menu' ? 'text-amber-700' : 'text-gray-400'
          )}
          style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
          <div className={clsx(
            'w-8 h-8 rounded-xl flex items-center justify-center transition-all',
            mobileTab === 'menu' ? 'text-amber-700' : 'text-gray-400'
          )} style={mobileTab === 'menu' ? { backgroundColor: 'var(--mango-yellow-lt)' } : {}}>
            <Coffee size={17} />
          </div>
          Menu
        </button>
        <button
          onClick={() => setMobileTab('cart')}
          className={clsx(
            'flex-1 flex flex-col items-center py-3 text-xs font-700 gap-1 transition-colors relative',
            mobileTab === 'cart' ? 'text-amber-700' : 'text-gray-400'
          )}
          style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
          <div className={clsx(
            'w-8 h-8 rounded-xl flex items-center justify-center transition-all relative',
            mobileTab === 'cart' ? 'text-amber-700' : 'text-gray-400'
          )} style={mobileTab === 'cart' ? { backgroundColor: 'var(--mango-yellow-lt)' } : {}}>
            <ShoppingCart size={17} />
            {itemCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-white flex items-center justify-center font-800"
                style={{ backgroundColor: 'var(--warrior-red)', fontSize: '9px', fontFamily: 'var(--font-display)', fontWeight: 800 }}>
                {itemCount > 9 ? '9+' : itemCount}
              </span>
            )}
          </div>
          Cart
        </button>
      </div>

      {sizeModal && (
        <SizePickerModal item={sizeModal.item} allAddons={allAddons} onClose={() => setSizeModal(null)} onAdd={addToCart} />
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

// ─── Cart Item Row ─────────────────────────────────────────────
// CHANGED: restructured into two clear rows:
//   Row 1 → item name | size | price (right-aligned)
//   Row 2 → qty stepper | Add-ons btn | SC | PWD | ✕
function CartItemRow({ item, allAddons }: { item: CartItem; allAddons: Addon[] }) {
  const cart = useCartStore();
  const [showAddonPicker, setShowAddonPicker] = useState(false);

  return (
    <div className="rounded-2xl border overflow-hidden transition-all"
      style={{ borderColor: '#E4E4E7', backgroundColor: '#FAFAF9', boxShadow: 'var(--shadow-xs)' }}>

      {/* ── Row 1: name + size + price ── */}
      <div className="flex items-start justify-between gap-2 px-3.5 pt-3 pb-1.5">
        <div className="flex-1 min-w-0">
          <span className="text-sm font-700 text-gray-900 leading-snug" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
            {item.item_name}
          </span>
          {item.size_name && (
            <span className="ml-2 text-xs text-gray-400 font-medium">{item.size_name}</span>
          )}
          {/* add-on tags */}
          {item.addons.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {item.addons.map((a, i) => (
                <span key={i} className="text-xs px-1.5 py-0.5 rounded-md font-medium"
                  style={{ backgroundColor: 'var(--leaf-green-lt)', color: 'var(--leaf-green)' }}>
                  +{a.addon_name}{a.qty > 1 ? ` ×${a.qty}` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <span className="text-base font-800 text-amber-900" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>
            {fmt(item.line_total)}
          </span>
          {item.discount_amount > 0 && (
            <div className="text-xs text-emerald-600 font-semibold">−{fmt(item.discount_amount)}</div>
          )}
        </div>
      </div>

      {/* ── Row 2: qty | add-ons | SC | PWD | remove ── */}
      <div className="flex items-center gap-1.5 px-3.5 pb-3 pt-1 flex-wrap">
        {/* qty stepper */}
        <div className="flex items-center gap-1 bg-white rounded-xl border border-gray-200 p-0.5 shadow-sm shrink-0">
          <button onClick={() => cart.updateQty(item.cart_key, -1)}
            className="w-6 h-6 rounded-lg hover:bg-red-50 hover:text-red-500 flex items-center justify-center text-gray-500 transition-colors">
            <Minus size={10} />
          </button>
          <span className="w-6 text-center text-sm font-800 text-gray-900" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>
            {item.qty}
          </span>
          <button onClick={() => cart.updateQty(item.cart_key, 1)}
            className="w-6 h-6 rounded-lg hover:bg-green-50 hover:text-green-600 flex items-center justify-center text-gray-500 transition-colors">
            <Plus size={10} />
          </button>
        </div>

        {/* add-ons button */}
        <button onClick={() => setShowAddonPicker(true)}
          className="flex items-center gap-1 text-xs font-600 transition-colors px-2 py-1 rounded-lg hover:bg-green-50 border border-transparent hover:border-green-200"
          style={{ color: 'var(--leaf-green)', fontWeight: 600 }}>
          <Plus size={10} />
          {item.addons.length > 0 ? `${item.addons.length} add-on${item.addons.length > 1 ? 's' : ''}` : 'Add-ons'}
        </button>

        {/* SC button */}
        <button
          onClick={() => cart.setDiscount(item.cart_key, item.discount_type === 'sc' ? null : 'sc')}
          className={clsx(
            'px-2 py-1 rounded-lg text-xs font-700 transition-all border',
            item.discount_type === 'sc'
              ? 'bg-sky-500 text-white border-sky-500 shadow-sm'
              : 'bg-white border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300'
          )}
          style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
          SC
        </button>

        {/* PWD button */}
        <button
          onClick={() => cart.setDiscount(item.cart_key, item.discount_type === 'pwd' ? null : 'pwd')}
          className={clsx(
            'px-2 py-1 rounded-lg text-xs font-700 transition-all border',
            item.discount_type === 'pwd'
              ? 'bg-violet-500 text-white border-violet-500 shadow-sm'
              : 'bg-white border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300'
          )}
          style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
          PWD
        </button>

        {/* remove */}
        <button onClick={() => cart.removeItem(item.cart_key)}
          className="w-7 h-7 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors ml-auto">
          <X size={13} />
        </button>
      </div>

      {showAddonPicker && (
        <CartAddonPickerModal
          cartKey={item.cart_key}
          currentAddons={item.addons}
          allAddons={allAddons}
          onClose={() => setShowAddonPicker(false)}
        />
      )}
    </div>
  );
}

// ─── Size + Addon Picker Modal ────────────────────────────────
function SizePickerModal({
  item, onClose, onAdd, allAddons,
}: {
  item: MenuItem; onClose: () => void;
  onAdd: (item: MenuItem, sizeName?: string, sizePrice?: number, addons?: Addon[]) => void;
  allAddons: Addon[];
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

  const displayAddons = allAddons.filter(a => a.is_available);
  const itemTotal = (selectedSize?.price ?? 0) + selectedAddons.reduce((s, a) => s + a.price, 0);

  return (
    <Modal open onClose={onClose} title={item.name} maxWidth="max-w-sm">
      <div className="flex flex-col gap-5">
        {item.sizes.length > 0 && (
          <div>
            <p className="text-xs font-800 text-gray-500 uppercase tracking-widest mb-3"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>Choose Size</p>
            <div className="flex flex-col gap-2">
              {item.sizes.map((s: ItemSize) => {
                const isActive = selectedSize?.id === s.id;
                return (
                  <button key={s.id} onClick={() => setSelectedSize(s)}
                    className="flex items-center justify-between px-4 py-3 rounded-2xl border-2 transition-all text-sm font-semibold"
                    style={isActive
                      ? { borderColor: 'var(--mango-yellow)', backgroundColor: 'var(--mango-yellow-xl)', color: '#78350f' }
                      : { borderColor: '#E4E4E7', backgroundColor: '#fff', color: '#3F3F46' }}>
                    <div className="flex items-center gap-3">
                      <div className={clsx('w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all')}
                        style={isActive
                          ? { borderColor: 'var(--mango-yellow)', backgroundColor: 'var(--mango-yellow)' }
                          : { borderColor: '#D1D1D6' }}>
                        {isActive && <div className="w-1.5 h-1.5 rounded-full bg-amber-800" />}
                      </div>
                      <span>{s.name}</span>
                    </div>
                    <span className="font-800" style={{ fontFamily: 'var(--font-display)', fontWeight: 800, color: isActive ? '#92400e' : '#71717A' }}>
                      {fmt(s.price)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {displayAddons.length > 0 && (
          <div>
            <p className="text-xs font-800 text-gray-500 uppercase tracking-widest mb-3"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>Add-ons <span className="normal-case font-medium text-gray-400">(optional)</span></p>
            <div className="flex flex-col gap-2">
              {displayAddons.map((a: Addon) => {
                const active = selectedAddons.some(s => s.id === a.id);
                return (
                  <button key={a.id} onClick={() => toggleAddon(a)}
                    className="flex items-center justify-between px-4 py-2.5 rounded-xl border-2 transition-all text-sm"
                    style={active
                      ? { borderColor: 'var(--leaf-green)', backgroundColor: 'var(--leaf-green-lt)' }
                      : { borderColor: '#E4E4E7', backgroundColor: '#fff' }}>
                    <span className="flex items-center gap-2.5">
                      <div className="w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all"
                        style={active
                          ? { borderColor: 'var(--leaf-green)', backgroundColor: 'var(--leaf-green)' }
                          : { borderColor: '#D1D1D6' }}>
                        {active && <span className="text-white text-xs font-black" style={{ lineHeight: 1 }}>✓</span>}
                      </div>
                      <span className={clsx('font-semibold', active ? 'text-emerald-900' : 'text-gray-700')}>{a.name}</span>
                    </span>
                    <span className="text-xs font-700" style={{ color: active ? 'var(--leaf-green)' : '#71717A', fontWeight: 700 }}>
                      +{fmt(a.price)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between py-3.5 px-4 rounded-2xl border"
          style={{ backgroundColor: 'var(--mango-yellow-xl)', borderColor: '#FDE68A' }}>
          <span className="text-sm font-600 text-amber-800">Item Total</span>
          <span className="font-900 text-2xl text-amber-900" style={{ fontFamily: 'var(--font-display)', fontWeight: 900 }}>
            {fmt(itemTotal)}
          </span>
        </div>

        <Btn variant="mango" fullWidth size="lg"
          onClick={() => onAdd(item, selectedSize?.name, selectedSize?.price, selectedAddons)}>
          <Plus size={16} /> Add to Order
        </Btn>
      </div>
    </Modal>
  );
}

// ─── Checkout Modal ───────────────────────────────────────────
function CheckoutModal({ shift, onClose, onSuccess }: {
  shift: Shift | null | undefined; onClose: () => void; onSuccess: () => void;
}) {
  const { user } = useAuthStore();
  const cart = useCartStore();
  const checkout = useCheckout();
  const { data: settings } = useSettings();
  const openPinModal = useUIStore(s => s.openPinModal);
  const total = cart.total();
  const [payments, setPayments] = useState<PaymentLine[]>([{ method: 'cash', amount: total }]);
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
      ...p, [field]: field === 'amount' ? parseFloat(val) || 0 : val,
    } : p));
  };

  const handleCheckout = async () => {
    if (!user) return;
    const ok = await openPinModal();
    if (!ok) return;
    try {
      const res = await checkout.mutateAsync({
        idempotency_key: cart.cart.idempotency_key,
        shift_id: shift?.id,
        order_type: 'dine_in',
        note: cart.cart.note || undefined,
        tendered_amount: hasCash && tendered ? tenderedNum : undefined,
        items: cart.cart.items.map((i: CartItem) => ({
          item_id: i.item_id, item_name: i.item_name, size_name: i.size_name,
          base_price: i.base_price, qty: i.qty,
          discount_type: i.discount_type ?? undefined,
          discount_pct: i.discount_pct, addons: i.addons,
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
    <Modal
      open
      onClose={step === 'success' ? undefined : onClose}
      title={step === 'success' ? '✅ Sale Complete' : '💳 Payment'}
      maxWidth="max-w-lg"
    >
      {step === 'success' && result ? (
        <div className="flex flex-col gap-5">
          <div className="text-center py-2">
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-lg"
              style={{ backgroundColor: '#D1FAE5', boxShadow: '0 4px 20px rgba(16,185,129,0.25)' }}>
              <span className="text-4xl">✓</span>
            </div>
            <p className="text-gray-500 text-sm font-medium mb-1">Receipt</p>
            <div className="text-gray-900 font-900 text-2xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 900 }}>
              {result.receipt_number}
            </div>
            {hasCash && result.change > 0 && (
              <div className="mt-4 p-4 rounded-2xl border"
                style={{ backgroundColor: 'var(--mango-yellow-xl)', borderColor: '#FDE68A' }}>
                <div className="text-amber-600 text-xs font-700 uppercase tracking-wide mb-1" style={{ fontWeight: 700 }}>Change Due</div>
                <div className="font-900 text-4xl text-amber-900" style={{ fontFamily: 'var(--font-display)', fontWeight: 900 }}>
                  {fmt(result.change)}
                </div>
              </div>
            )}
          </div>
          {receiptData && settings && (
            <div className="border border-gray-200 rounded-2xl overflow-hidden max-h-64 overflow-y-auto bg-gray-50">
              <SaleReceipt sale={receiptData} settings={settings} />
            </div>
          )}
          <div className="flex gap-3">
            <Btn variant="secondary" onClick={() => window.print()} className="flex-1">
              <Printer size={14} /> Print
            </Btn>
            <Btn variant="mango" onClick={onSuccess} className="flex-[2]" size="lg">
              New Order →
            </Btn>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="rounded-2xl p-4 border"
            style={{ background: 'linear-gradient(135deg, var(--mango-yellow-xl) 0%, #FEF3C0 100%)', borderColor: '#FDE68A' }}>
            <div className="flex justify-between items-baseline">
              <span className="text-sm font-700 text-amber-800" style={{ fontWeight: 700 }}>Order Total</span>
              <span className="font-900 text-3xl text-amber-900" style={{ fontFamily: 'var(--font-display)', fontWeight: 900 }}>
                {fmt(total)}
              </span>
            </div>
            {cart.discountTotal() > 0 && (
              <div className="flex justify-between text-xs text-emerald-700 mt-1 font-semibold">
                <span>Discount applied</span><span>−{fmt(cart.discountTotal())}</span>
              </div>
            )}
            <div className="text-xs text-amber-700 mt-1 opacity-70">
              {cart.cart.items.reduce((s, i) => s + i.qty, 0)} item(s)
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-xs font-800 text-gray-500 uppercase tracking-widest"
                style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>Payment Method</p>
              {payments.length < 3 && (
                <Btn size="sm" variant="ghost" onClick={addPaymentLine}>
                  <Plus size={12} /> Split Payment
                </Btn>
              )}
            </div>
            <div className="flex flex-col gap-2.5">
              {payments.map((p, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <Select value={p.method} onChange={v => updatePayment(i, 'method', v)}
                    options={[
                      { value: 'cash', label: '💵 Cash' },
                      { value: 'gcash', label: '📱 GCash' },
                      { value: 'maya', label: '💳 Maya' },
                    ]} className="w-36" />
                  <Input type="number" value={p.amount} min={0} step={0.01}
                    onChange={v => updatePayment(i, 'amount', v)} className="flex-1" />
                  {payments.length > 1 && (
                    <button onClick={() => setPayments(prev => prev.filter((_, j) => j !== i))}
                      className="text-gray-300 hover:text-red-500 p-2 transition-colors mt-0.5">
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {hasCash && (
            <div>
              <Input label="Cash Tendered" type="number" value={tendered} min={0} step={0.01}
                placeholder="Enter cash amount received" onChange={setTendered} />
              {tendered && tenderedNum >= cashPaymentTotal && (
                <div className="flex justify-between text-sm mt-2.5 px-4 py-2.5 rounded-xl border"
                  style={{ backgroundColor: 'var(--leaf-green-lt)', borderColor: '#A7F3D0' }}>
                  <span className="text-emerald-700 font-semibold">Change</span>
                  <span className="text-emerald-800 font-800" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>
                    {fmt(change)}
                  </span>
                </div>
              )}
              {tendered && tenderedNum < cashPaymentTotal && (
                <div className="flex items-center gap-2 text-red-600 text-xs mt-2 px-3 py-2 rounded-xl bg-red-50 border border-red-100 font-medium">
                  <AlertTriangle size={12} /> Amount is less than cash total ({fmt(cashPaymentTotal)})
                </div>
              )}
              <div className="flex gap-1.5 mt-2.5 flex-wrap">
                {[total, Math.ceil(total / 50) * 50, Math.ceil(total / 100) * 100, Math.ceil(total / 500) * 500]
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .map(v => (
                    <button key={v} onClick={() => setTendered(v.toString())}
                      className="px-3 py-1.5 rounded-xl text-xs font-700 transition-all border hover:shadow-sm"
                      style={{
                        fontFamily: 'var(--font-display)', fontWeight: 700,
                        backgroundColor: tendered === v.toString() ? 'var(--mango-yellow)' : '#fff',
                        color: tendered === v.toString() ? '#78350f' : '#52525B',
                        borderColor: tendered === v.toString() ? 'var(--mango-yellow)' : '#E4E4E7',
                      }}>
                      {fmt(v)}
                    </button>
                  ))}
              </div>
            </div>
          )}

          {!balanced && (
            <div className="flex items-center justify-between text-sm p-3.5 rounded-2xl border border-red-100 bg-red-50">
              <span className="text-red-600 font-semibold flex items-center gap-1.5">
                <AlertTriangle size={14} /> Remaining
              </span>
              <span className="text-red-700 font-800" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>
                {fmt(total - paymentTotal)}
              </span>
            </div>
          )}

          <div className="flex gap-2.5">
            <Btn variant="secondary" onClick={onClose} className="flex-1">Cancel</Btn>
            <Btn variant="mango" size="lg" onClick={handleCheckout}
              disabled={!balanced || !tenderedOk}
              loading={checkout.isPending} className="flex-[2]">
              Confirm Sale
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── Held Orders Modal ────────────────────────────────────────
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
          <div className="rounded-2xl p-4 border" style={{ backgroundColor: 'var(--mango-yellow-xl)', borderColor: '#FDE68A' }}>
            <p className="text-sm text-amber-900 mb-3 font-700" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
              Hold Current Order ({cart.cart.items.length} items · {fmt(cart.total())})
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
            <div className="flex justify-center py-6"><RefreshCw className="animate-spin text-gray-300" /></div>
          ) : !heldOrders?.length ? (
            <div className="text-center text-gray-400 py-10 text-sm">
              <Receipt size={32} className="mx-auto mb-3 opacity-30" />
              No held orders
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {heldOrders.map((order: HeldOrder) => (
                <div key={order.id}
                  className="flex items-center justify-between bg-white border border-gray-200 rounded-2xl px-4 py-3.5 shadow-sm">
                  <div>
                    <div className="text-gray-900 text-sm font-700" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                      {order.label ?? 'Unnamed Order'}
                    </div>
                    <div className="text-gray-500 text-xs mt-0.5">
                      {order.data.items.length} items · {fmt(order.data.items.reduce((s, i) => s + i.line_total, 0))}
                    </div>
                    <div className="text-gray-400 text-xs mt-0.5">Expires {fmtDate(order.expires_at)}</div>
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

// ─── Shift Modal ──────────────────────────────────────────────
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
    const ok = await openPinModal();
    if (!ok) return;
    await openShift.mutateAsync({ starting_float: parseFloat(startFloat) || 0 });
    toast('Shift opened');
    onClose();
  };

  const handleClose = async () => {
    if (!shift) return;
    const ok = await openPinModal();
    if (!ok) return;
    await closeShift.mutateAsync({ id: shift.id, closing_cash: parseFloat(closingCash) || 0, notes: closeNotes });
    toast('Shift closed');
    onClose();
  };

  const handleDrop = async () => {
    if (!shift || !dropReason) return;
    const ok = await openPinModal();
    if (!ok) return;
    await cashDrop.mutateAsync({ shift_id: shift.id, amount: parseFloat(dropAmount) || 0, reason: dropReason });
    toast('Cash drop recorded');
    setDropAmount(''); setDropReason('');
    onClose();
  };

  if (!shift) {
    return (
      <Modal open onClose={onClose} title="🔓 Open Shift">
        <div className="flex flex-col gap-5">
          <p className="text-gray-500 text-sm">Enter the starting cash float for this shift.</p>
          <Input label="Starting Float (₱)" type="number" value={startFloat} min={0} step={0.01} onChange={setStartFloat} />
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={onClose} className="flex-1">Cancel</Btn>
            <Btn variant="mango" size="lg" onClick={handleOpen} loading={openShift.isPending} className="flex-1">Open Shift</Btn>
          </div>
        </div>
      </Modal>
    );
  }

  const cashTotal = shift.payment_totals?.cash ?? 0;
  const expectedCash = (shift.starting_float ?? 0) + cashTotal - (shift.cash_drops ?? []).reduce((s, d: CashDrop) => s + d.amount, 0);
  const variance = parseFloat(closingCash || '0') - expectedCash;

  return (
    <Modal open onClose={onClose} title="📊 Shift Management" maxWidth="max-w-md">
      <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-xl">
        {(['overview', 'drop', 'close'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={clsx('flex-1 py-2 rounded-xl text-xs font-700 capitalize transition-all',
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            )}
            style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
            {t === 'drop' ? 'Cash Drop' : t === 'close' ? 'Close Shift' : 'Overview'}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2.5">
            <StatCard label="Starting Float" value={fmt(shift.starting_float)} />
            <StatCard label="Cash Sales" value={fmt(cashTotal)} />
            {(Object.entries(shift.payment_totals ?? {}) as [string, number][])
              .filter(([k]) => k !== 'cash')
              .map(([k, v]) => <StatCard key={k} label={k.toUpperCase()} value={fmt(v)} />)}
            <StatCard label="Expected Cash" value={fmt(expectedCash)} accent />
          </div>
          {(shift.cash_drops ?? []).length > 0 && (
            <div>
              <p className="text-xs font-700 text-gray-500 mb-2 uppercase tracking-wider" style={{ fontWeight: 700 }}>Cash Drops</p>
              {shift.cash_drops.map((d: CashDrop) => (
                <div key={d.id} className="flex justify-between text-xs text-gray-600 py-2 border-b border-gray-100">
                  <span className="font-medium">{d.reason}</span>
                  <span className="text-red-500 font-700" style={{ fontWeight: 700 }}>−{fmt(d.amount)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-gray-400 font-medium">Opened {fmtDate(shift.started_at)}</p>
        </div>
      )}

      {tab === 'drop' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-500">Record cash removed from the drawer.</p>
          <Input label="Amount (₱)" type="number" value={dropAmount} min={0} step={0.01} onChange={setDropAmount} />
          <Input label="Reason" value={dropReason} onChange={setDropReason} placeholder="e.g. Safe drop, Manager pull" />
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={onClose} className="flex-1">Cancel</Btn>
            <Btn variant="warrior" onClick={handleDrop} loading={cashDrop.isPending}
              disabled={!dropReason || !dropAmount} className="flex-1">Record Drop</Btn>
          </div>
        </div>
      )}

      {tab === 'close' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-500">Count your cash drawer before closing the shift.</p>
          <div className="rounded-xl p-3.5 border" style={{ backgroundColor: 'var(--mango-yellow-xl)', borderColor: '#FDE68A' }}>
            <div className="flex justify-between text-sm text-amber-800 font-semibold">
              <span>Expected Cash</span>
              <span className="font-800" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>{fmt(expectedCash)}</span>
            </div>
          </div>
          <Input label="Actual Closing Cash (₱)" type="number" value={closingCash} min={0} step={0.01} onChange={setClosingCash} autoFocus />
          {closingCash && (
            <div className={clsx('flex justify-between text-sm font-700 px-4 py-3 rounded-xl border')}
              style={{
                fontFamily: 'var(--font-display)', fontWeight: 700,
                ...(Math.abs(variance) < 1
                  ? { backgroundColor: 'var(--leaf-green-lt)', color: 'var(--leaf-green)', borderColor: '#A7F3D0' }
                  : variance > 0
                    ? { backgroundColor: '#EFF6FF', color: '#1D4ED8', borderColor: '#BFDBFE' }
                    : { backgroundColor: '#FFF1F2', color: 'var(--warrior-red)', borderColor: '#FECDD3' })
              }}>
              <span>Variance</span>
              <span>{variance > 0 ? '+' : ''}{fmt(variance)}</span>
            </div>
          )}
          <Input label="Notes (optional)" value={closeNotes} onChange={setCloseNotes} />
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={onClose} className="flex-1">Cancel</Btn>
            <Btn variant="danger" size="lg" onClick={handleClose} loading={closeShift.isPending}
              disabled={!closingCash} className="flex-1">Close Shift</Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl p-3.5 border"
      style={accent
        ? { backgroundColor: 'var(--mango-yellow-xl)', borderColor: '#FDE68A' }
        : { backgroundColor: '#FAFAF9', borderColor: '#E4E4E7' }}>
      <div className="text-xs text-gray-500 font-600 mb-1.5" style={{ fontWeight: 600 }}>{label}</div>
      <div className="font-900 text-xl text-gray-900" style={{ fontFamily: 'var(--font-display)', fontWeight: 900 }}>{value}</div>
    </div>
  );
}

// ─── Partial Void / Refund Modal ──────────────────────────────
function PartialActionModal({
  sale, action, onClose, onDone,
}: {
  sale: SaleDetail; action: 'void' | 'refund'; onClose: () => void; onDone: () => void;
}) {
  const openPinModal = useUIStore(s => s.openPinModal);
  const voidSale = useVoidSale();
  const refundSale = useRefundSale();
  const [mode, setMode] = useState<'entire' | 'items'>('entire');
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const toggleItem = (idx: number) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const selectedTotal = mode === 'entire'
    ? sale.total
    : Array.from(selectedItems).reduce((s, i) => s + (sale.items[i]?.final_price ?? 0), 0);

  const canConfirm = reason.trim() && (mode === 'entire' || selectedItems.size > 0);

  const handleConfirm = async () => {
    if (!canConfirm) return;
    const ok = await openPinModal();
    if (!ok) return;
    setLoading(true);
    try {
      const payload = {
        id: sale.id, reason,
        ...(mode === 'items' ? { item_indices: Array.from(selectedItems) } : {}),
      };
      if (action === 'void') await voidSale.mutateAsync(payload);
      else await refundSale.mutateAsync(payload);
      toast(`Sale ${action}ed successfully`);
      onDone();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Action failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const actionLabel = action === 'void' ? 'Void' : 'Refund';

  return (
    <Modal open onClose={onClose} title={`${actionLabel} Sale — ${sale.receipt_number}`} maxWidth="max-w-lg">
      <div className="flex flex-col gap-5">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          <button onClick={() => setMode('entire')}
            className={clsx('flex-1 py-2 rounded-xl text-sm font-700 transition-all',
              mode === 'entire' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            )}
            style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
            {actionLabel} Entire Sale
          </button>
          <button onClick={() => setMode('items')}
            className={clsx('flex-1 py-2 rounded-xl text-sm font-700 transition-all',
              mode === 'items' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            )}
            style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
            {actionLabel} Selected Items
          </button>
        </div>

        {mode === 'items' && (
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-800 text-gray-500 uppercase tracking-widest"
                style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>Select Items</span>
              <div className="flex gap-2">
                <button onClick={() => setSelectedItems(new Set(sale.items.map((_, i) => i)))}
                  className="text-xs text-sky-500 hover:text-sky-700 font-700" style={{ fontWeight: 700 }}>All</button>
                <button onClick={() => setSelectedItems(new Set())}
                  className="text-xs text-gray-400 hover:text-gray-600 font-700" style={{ fontWeight: 700 }}>None</button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto border border-gray-200 rounded-2xl p-2">
              {sale.items.map((item, idx) => {
                const isSelected = selectedItems.has(idx);
                return (
                  <button key={idx} onClick={() => toggleItem(idx)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 transition-all text-left"
                    style={isSelected
                      ? { borderColor: '#FCA5A5', backgroundColor: '#FFF1F2' }
                      : { borderColor: '#E4E4E7', backgroundColor: '#fff' }}>
                    <div className="w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all"
                      style={isSelected ? { borderColor: '#EF4444', backgroundColor: '#EF4444' } : { borderColor: '#D1D1D6' }}>
                      {isSelected && <span className="text-white text-xs leading-none font-black">✓</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-600 text-gray-900" style={{ fontWeight: 600 }}>
                        {item.qty}x {item.item_name}{item.size_name ? ` (${item.size_name})` : ''}
                      </div>
                    </div>
                    <span className="text-sm font-700 text-gray-700" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                      {fmt(item.final_price)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex justify-between items-center px-4 py-3 rounded-2xl border"
          style={{
            backgroundColor: action === 'void' ? '#FFF1F2' : '#F5F3FF',
            borderColor: action === 'void' ? '#FECDD3' : '#DDD6FE',
          }}>
          <span className="text-sm font-700" style={{ color: action === 'void' ? 'var(--warrior-red)' : '#7C3AED', fontWeight: 700 }}>
            Amount to {actionLabel}
          </span>
          <span className="font-900 text-xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 900, color: action === 'void' ? 'var(--warrior-red)' : '#7C3AED' }}>
            {fmt(selectedTotal)}
          </span>
        </div>

        <Input label="Reason *" value={reason} onChange={setReason} placeholder={`Reason for ${action}…`} autoFocus />
        <div className="flex gap-2">
          <Btn variant="secondary" onClick={onClose} className="flex-1">Cancel</Btn>
          <Btn variant="danger" size="lg" onClick={handleConfirm} loading={loading} disabled={!canConfirm} className="flex-1">
            Confirm {actionLabel}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

// ─── Sales Page ───────────────────────────────────────────────
function SalesPage() {
  const { user } = useAuthStore();
  const openPinModal = useUIStore(s => s.openPinModal);
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));
  const [statusFilter, setStatusFilter] = useState('');
  const [receiptQ, setReceiptQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionModal, setActionModal] = useState<{ type: 'void' | 'refund' } | null>(null);
  const [deleteModal, setDeleteModal] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');

  const { data: sales, isLoading, refetch } = useSales({
    date_from: dateFrom, date_to: dateTo,
    status: statusFilter || undefined, receipt: receiptQ || undefined,
  });
  const { data: saleDetail } = useSaleDetail(selectedId);
  const { data: settings } = useSettings();
  const softDelete = useSoftDeleteSale();
  const reprint = useReprintSale();

  const handleReprint = async (id: string) => {
    const ok = await openPinModal();
    if (!ok) return;
    await reprint.mutateAsync(id);
    toast('Reprint recorded');
    window.print();
  };

  const handleDelete = async () => {
    if (!saleDetail || !deleteReason) return;
    const ok = await openPinModal();
    if (!ok) return;
    try {
      await softDelete.mutateAsync({ id: saleDetail.id, reason: deleteReason });
      toast('Sale deleted');
      setDeleteModal(false); setDeleteReason(''); setSelectedId(null); refetch();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Delete failed', 'error');
    }
  };

  const statusColor = (s: string) =>
    s === 'completed' ? 'green' : s === 'voided' ? 'red' : s === 'refunded' ? 'yellow' : 'gray';

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--surface-page)' }}>
      <div className="px-4 py-3 bg-white border-b border-gray-150 shrink-0"
        style={{ boxShadow: '0 1px 0 rgba(0,0,0,0.04)' }}>
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
        <div className="flex flex-col flex-1 overflow-hidden">
          {sales && (
            <div className="px-4 py-2 bg-white border-b border-gray-100 flex gap-4 text-xs font-semibold shrink-0">
              <span className="text-gray-400">{sales.length} transactions</span>
              <span className="text-emerald-600">
                {fmt(sales.filter(s => s.status === 'completed').reduce((a, s) => a + s.total, 0))} revenue
              </span>
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-16 shimmer rounded-2xl" />)}
              </div>
            ) : !sales?.length ? (
              <div className="flex flex-col items-center justify-center h-48 text-center">
                <Receipt size={36} className="text-gray-200 mb-3" />
                <p className="text-gray-400 text-sm font-medium">No sales found</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {sales.map((sale: SaleListItem) => (
                  <button key={sale.id}
                    onClick={() => setSelectedId(s => s === sale.id ? null : sale.id)}
                    className={clsx(
                      'w-full flex items-center gap-3 px-4 py-3.5 text-left transition-all hover:bg-gray-50',
                      selectedId === sale.id && 'border-l-[3px]'
                    )}
                    style={selectedId === sale.id ? { borderLeftColor: 'var(--mango-yellow)', backgroundColor: 'var(--mango-yellow-xl)' } : {}}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-gray-900 font-mono font-700 text-sm" style={{ fontWeight: 700 }}>{sale.receipt_number}</span>
                        <Badge color={statusColor(sale.status)}>{sale.status}</Badge>
                        {sale.sale_type === 'missed' && <Badge color="yellow">missed</Badge>}
                      </div>
                      <div className="text-gray-400 text-xs mt-0.5 font-medium">{fmtDate(sale.created_at)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-800 text-amber-900 text-base" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>
                        {fmt(sale.total)}
                      </div>
                      {sale.discount_total > 0 && (
                        <div className="text-xs text-emerald-600 font-semibold">−{fmt(sale.discount_total)}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {saleDetail && (
          <div className="w-80 xl:w-96 shrink-0 flex flex-col overflow-hidden bg-white border-l border-gray-150">
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-100 shrink-0">
              <div>
                <div className="text-gray-900 font-mono font-700 text-base" style={{ fontWeight: 700 }}>{saleDetail.receipt_number}</div>
                <div className="text-xs text-gray-400 font-medium mt-0.5">{saleDetail.cashier_name}</div>
              </div>
              {saleDetail.status === 'completed' && (
                <Btn size="sm" variant="secondary" onClick={() => handleReprint(saleDetail.id)}>
                  <Printer size={12} /> Reprint
                </Btn>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-2 mb-4">
                {saleDetail.items.map((item: SaleItemDetail, i: number) => (
                  <div key={i} className="text-sm">
                    <div className="flex justify-between text-gray-900 font-600" style={{ fontWeight: 600 }}>
                      <span>{item.qty}x {item.item_name}{item.size_name ? ` (${item.size_name})` : ''}</span>
                      <span className="font-700" style={{ fontWeight: 700 }}>{fmt(item.final_price)}</span>
                    </div>
                    {item.addons.map((a, j) => (
                      <div key={j} className="flex justify-between text-xs text-gray-400 pl-3">
                        <span>+ {a.addon_name}</span><span>{fmt(a.addon_price)}</span>
                      </div>
                    ))}
                    {item.discount_amount > 0 && (
                      <div className="flex justify-between text-xs text-emerald-600 pl-3 font-semibold">
                        <span>{item.discount_type?.toUpperCase()} discount</span>
                        <span>−{fmt(item.discount_amount)}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-100 pt-3 space-y-2">
                <div className="flex justify-between text-sm text-gray-500">
                  <span>Subtotal</span><span className="font-semibold">{fmt(saleDetail.subtotal)}</span>
                </div>
                {saleDetail.discount_total > 0 && (
                  <div className="flex justify-between text-sm text-emerald-600 font-semibold">
                    <span>Discount</span><span>−{fmt(saleDetail.discount_total)}</span>
                  </div>
                )}
                <div className="flex justify-between font-800 text-gray-900 text-lg border-t border-gray-100 pt-2"
                  style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>
                  <span>Total</span><span className="text-amber-900">{fmt(saleDetail.total)}</span>
                </div>
                {saleDetail.payments.map((p: PaymentLine, i) => (
                  <div key={i} className="flex justify-between text-sm text-gray-500">
                    <span className="font-medium">{p.method.toUpperCase()}</span><span>{fmt(p.amount)}</span>
                  </div>
                ))}
                {saleDetail.change_amount != null && saleDetail.change_amount > 0 && (
                  <div className="flex justify-between text-sm text-gray-500">
                    <span className="font-medium">Change</span><span>{fmt(saleDetail.change_amount)}</span>
                  </div>
                )}
              </div>
              {settings && (
                <div className="mt-4 border border-gray-200 rounded-2xl overflow-hidden">
                  <SaleReceipt sale={saleDetail} settings={settings} />
                </div>
              )}
            </div>
            {saleDetail.status === 'completed' && (
              <div className="border-t border-gray-100 p-3 flex gap-2 shrink-0">
                <Btn size="sm" variant="secondary" className="flex-1" onClick={() => setActionModal({ type: 'void' })}>Void</Btn>
                <Btn size="sm" variant="secondary" className="flex-1" onClick={() => setActionModal({ type: 'refund' })}>Refund</Btn>
                <Btn size="sm" variant="danger" onClick={() => { setDeleteModal(true); setDeleteReason(''); }}>
                  <Trash2 size={13} />
                </Btn>
              </div>
            )}
          </div>
        )}
      </div>

      {actionModal && saleDetail && (
        <PartialActionModal sale={saleDetail} action={actionModal.type}
          onClose={() => setActionModal(null)}
          onDone={() => { setActionModal(null); setSelectedId(null); refetch(); }} />
      )}
      <Modal open={deleteModal} onClose={() => setDeleteModal(false)} title="Delete Sale">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-500">PIN required. Please provide a reason for deletion.</p>
          <Input label="Reason" value={deleteReason} onChange={setDeleteReason} autoFocus />
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={() => setDeleteModal(false)} className="flex-1">Cancel</Btn>
            <Btn variant="danger" onClick={handleDelete} disabled={!deleteReason}
              loading={softDelete.isPending} className="flex-1">Confirm Delete</Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Admin Dashboard ──────────────────────────────────────────
function AdminDashboardPage() {
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));
  const { data: report, isLoading } = useSalesReport({ date_from: dateFrom, date_to: dateTo });
  const { data: shift } = useCurrentShift();
  const { navigate } = useUIStore();

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--surface-page)' }}>
      <div className="px-4 py-3 bg-white border-b border-gray-150 shrink-0 flex gap-3 items-end flex-wrap"
        style={{ boxShadow: '0 1px 0 rgba(0,0,0,0.04)' }}>
        <Input label="From" type="date" value={dateFrom} onChange={setDateFrom} className="w-36" />
        <Input label="To" type="date" value={dateTo} onChange={setDateTo} className="w-36" />
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-4xl mx-auto">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-28 shimmer rounded-2xl" />)}
          </div>
        ) : (
          <div className="max-w-4xl mx-auto flex flex-col gap-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard icon={<DollarSign size={18} />} label="Revenue" value={fmt(report?.total_revenue ?? 0)} color="green" />
              <KpiCard icon={<Receipt size={18} />} label="Transactions" value={String(report?.transaction_count ?? 0)} color="blue" />
              <KpiCard icon={<TrendingUp size={18} />} label="Avg Sale"
                value={fmt(report?.transaction_count ? (report.total_revenue / report.transaction_count) : 0)} color="yellow" />
              <KpiCard icon={<Tag size={18} />} label="Discounts" value={fmt(report?.total_discount ?? 0)} color="red" />
            </div>

            <div className="bg-white border border-gray-150 rounded-2xl p-5 shadow-sm">
              <h3 className="text-sm font-800 text-gray-800 mb-4" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>
                Payment Breakdown
              </h3>
              <div className="flex flex-col gap-4">
                {(Object.entries(report?.payment_breakdown ?? {}) as [string, number][]).map(([method, amount]) => {
                  const pct = report?.total_revenue ? (amount / report.total_revenue) * 100 : 0;
                  const barColor = method === 'cash' ? 'var(--leaf-green)' : method === 'gcash' ? '#E8A000' : 'var(--warrior-red)';
                  return (
                    <div key={method}>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="text-gray-600 font-700 uppercase text-xs tracking-wider"
                          style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{method}</span>
                        <span className="text-gray-900 font-800 text-sm" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>
                          {fmt(amount)}
                          <span className="text-gray-400 font-medium text-xs ml-2">({pct.toFixed(0)}%)</span>
                        </span>
                      </div>
                      <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, backgroundColor: barColor }} />
                      </div>
                    </div>
                  );
                })}
                {!Object.keys(report?.payment_breakdown ?? {}).length && (
                  <p className="text-gray-400 text-sm text-center py-4">No payment data for this period</p>
                )}
              </div>
            </div>

            <div className="bg-white border border-gray-150 rounded-2xl p-5 shadow-sm">
              <h3 className="text-sm font-800 text-gray-800 mb-4" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>Current Shift</h3>
              {shift ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <StatCard label="Starting Float" value={fmt(shift.starting_float)} />
                  <StatCard label="Cash Sales" value={fmt(shift.payment_totals?.cash ?? 0)} />
                  <StatCard label="GCash / Maya" value={fmt((shift.payment_totals?.gcash ?? 0) + (shift.payment_totals?.maya ?? 0))} accent />
                </div>
              ) : (
                <div className="text-center text-gray-400 py-6 text-sm">No shift currently open</div>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              {([
                { label: 'Manage Menu',  page: 'admin_menu' as Page,      icon: <Coffee size={18} />,      color: '#E8A000' },
                { label: 'Staff',        page: 'admin_employees' as Page,  icon: <Users size={18} />,       color: 'var(--leaf-green)' },
                { label: 'Settings',     page: 'admin_settings' as Page,   icon: <Settings size={18} />,    color: 'var(--warrior-red)' },
                { label: 'Audit Log',    page: 'admin_audit' as Page,      icon: <ShieldCheck size={18} />, color: '#7C3AED' },
              ]).map(l => (
                <button key={l.page} onClick={() => navigate(l.page)}
                  className="flex flex-col items-start gap-3 px-4 py-4 bg-white border border-gray-150 rounded-2xl
                    hover:shadow-md transition-all text-left group active:scale-98"
                  style={{ boxShadow: 'var(--shadow-sm)' }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center transition-all"
                    style={{ backgroundColor: l.color + '18', color: l.color }}>
                    {l.icon}
                  </div>
                  <span className="text-sm font-700 text-gray-800" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                    {l.label}
                  </span>
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
  const colorMap: Record<string, { bg: string; icon: string; border: string }> = {
    green:  { bg: '#F0FDF4', icon: '#16A34A', border: '#BBF7D0' },
    blue:   { bg: '#EFF6FF', icon: '#2563EB', border: '#BFDBFE' },
    yellow: { bg: 'var(--mango-yellow-xl)', icon: '#D97706', border: '#FDE68A' },
    red:    { bg: '#FFF1F2', icon: 'var(--warrior-red)', border: '#FECDD3' },
  };
  const c = colorMap[color];
  return (
    <div className="bg-white border rounded-2xl p-4 shadow-sm" style={{ borderColor: c.border }}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
        style={{ backgroundColor: c.bg, color: c.icon }}>
        {icon}
      </div>
      <div className="text-xs font-700 text-gray-400 mb-1.5 uppercase tracking-widest"
        style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{label}</div>
      <div className="font-900 text-xl text-gray-900" style={{ fontFamily: 'var(--font-display)', fontWeight: 900 }}>{value}</div>
    </div>
  );
}

// ─── Admin Menu Page ──────────────────────────────────────────
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
  const [editItem, setEditItem] = useState<MenuItem | null>(null);
  const [newItem, setNewItem] = useState({ name: '', category_id: '', sizes: [{ name: 'Regular', price: '' }] });
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
    const sizes = newItem.sizes.filter(s => s.name && s.price).map(s => ({ name: s.name, price: parseFloat(s.price) }));
    if (!newItem.name || !sizes.length) return;
    await createItem.mutateAsync({ name: newItem.name, category_id: newItem.category_id || undefined, sizes });
    setNewItem({ name: '', category_id: '', sizes: [{ name: 'Regular', price: '' }] });
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

  const [editForm, setEditForm] = useState<{
    name: string; category_id: string;
    sizes: { id?: string; name: string; price: string }[];
  } | null>(null);

  const openEditItem = (item: MenuItem) => {
    setEditItem(item);
    setEditForm({ name: item.name, category_id: item.category_id ?? '', sizes: item.sizes.map(s => ({ id: s.id, name: s.name, price: String(s.price) })) });
  };

  const handleEditItem = async () => {
    if (!editItem || !editForm) return;
    const sizes = editForm.sizes.filter(s => s.name && s.price).map(s => ({ ...(s.id ? { id: s.id } : {}), name: s.name, price: parseFloat(s.price) }));
    if (!editForm.name || !sizes.length) return;
    await updateItem.mutateAsync({ id: editItem.id, name: editForm.name, category_id: editForm.category_id || undefined, sizes });
    setEditItem(null); setEditForm(null);
    toast('Item updated');
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--surface-page)' }}>
      <div className="px-4 py-3 bg-white border-b border-gray-150 shrink-0 flex items-center gap-3"
        style={{ boxShadow: '0 1px 0 rgba(0,0,0,0.04)' }}>
        <div className="flex bg-gray-100 p-1 rounded-xl gap-1">
          {(['items', 'addons'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={clsx('px-4 py-1.5 rounded-xl text-xs font-700 capitalize transition-all',
                tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              )}
              style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
              {t === 'items' ? 'Menu Items' : 'Add-ons'}
            </button>
          ))}
        </div>
        <Btn size="sm" variant="mango" onClick={() => tab === 'items' ? setShowAddItem(true) : setShowAddAddon(true)}>
          <Plus size={14} /> Add {tab === 'items' ? 'Item' : 'Add-on'}
        </Btn>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex justify-center py-12"><RefreshCw className="animate-spin text-gray-300" /></div>
        ) : tab === 'items' ? (
          <div className="max-w-3xl mx-auto space-y-5">
            <div className="flex gap-2">
              <Input value={newCatName} onChange={setNewCatName} placeholder="New category name…" className="flex-1" />
              <Btn variant="leaf" onClick={handleAddCategory} disabled={!newCatName.trim()} loading={createCategory.isPending}>
                <Plus size={14} /> Add Category
              </Btn>
            </div>
            {categories.map((cat: Category, catIdx: number) => {
              const color = getCategoryColor(catIdx);
              return (
                <div key={cat.id} className="bg-white border border-gray-150 rounded-2xl overflow-hidden shadow-sm">
                  <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between"
                    style={{ backgroundColor: color.lightBg }}>
                    <div className="flex items-center gap-2.5">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color.pill }} />
                      <span className="font-700 text-gray-800 text-sm" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                        {cat.name}
                      </span>
                    </div>
                    <Badge color="gray">{cat.items.length} items</Badge>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {cat.items.map((item: MenuItem) => (
                      <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={clsx('text-sm font-600', item.is_active ? 'text-gray-900' : 'text-gray-400 line-through')}
                              style={{ fontWeight: 600 }}>
                              {item.name}
                            </span>
                            {!item.is_available && <Badge color="red">86'd</Badge>}
                            {!item.is_active && <Badge color="gray">inactive</Badge>}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5 font-medium">
                            {item.sizes.map(s => `${s.name}: ${fmt(s.price)}`).join(' · ')}
                          </div>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <button
                            onClick={() => toggleAvailability.mutate({ id: item.id, is_available: !item.is_available })}
                            className={clsx('px-2.5 py-1 rounded-xl text-xs font-700 transition-all border',
                              item.is_available
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                : 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                            )}
                            style={{ fontWeight: 700 }}>
                            {item.is_available ? '✓ Available' : "86'd"}
                          </button>
                          <button onClick={() => openEditItem(item)}
                            className="p-2 rounded-xl text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all">
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={async () => { if (confirm(`Delete "${item.name}"?`)) await deleteItem.mutateAsync(item.id); }}
                            className="p-2 rounded-xl text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {cat.items.length === 0 && (
                      <div className="px-4 py-4 text-xs text-gray-400 text-center">No items yet</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="max-w-2xl mx-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {allAddons.map((addon: Addon) => (
                <div key={addon.id}
                  className="flex items-center justify-between bg-white border border-gray-150 rounded-2xl px-4 py-3.5 shadow-sm">
                  <div>
                    <div className="text-gray-900 font-700 text-sm" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{addon.name}</div>
                    <div className="text-xs font-800 mt-0.5 text-amber-700" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>
                      +{fmt(addon.price)}
                    </div>
                  </div>
                  <button
                    onClick={() => updateAddon.mutate({ id: addon.id, is_available: !addon.is_available })}
                    className={clsx('px-3 py-1.5 rounded-xl text-xs font-700 transition-all border',
                      addon.is_available
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                        : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'
                    )}
                    style={{ fontWeight: 700 }}>
                    {addon.is_available ? 'Available' : 'Unavailable'}
                  </button>
                </div>
              ))}
              {!allAddons.length && <div className="col-span-2 text-center text-gray-400 py-10">No add-ons yet</div>}
            </div>
          </div>
        )}
      </div>

      <Modal open={showAddItem} onClose={() => setShowAddItem(false)} title="Add Menu Item" maxWidth="max-w-md">
        <div className="flex flex-col gap-4">
          <Input label="Item Name" value={newItem.name} onChange={v => setNewItem(p => ({ ...p, name: v }))} />
          <Select label="Category" value={newItem.category_id}
            onChange={v => setNewItem(p => ({ ...p, category_id: v }))}
            options={[{ value: '', label: '— No category —' }, ...categories.map((c: Category) => ({ value: c.id, label: c.name }))]} />
          <div>
            <div className="text-xs font-800 text-gray-500 uppercase tracking-widest mb-2.5"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>Sizes & Prices</div>
            {newItem.sizes.map((s, i) => (
              <div key={i} className="flex gap-2 mb-2 items-start">
                <Input value={s.name} onChange={v => setNewItem(p => ({ ...p, sizes: p.sizes.map((sz, j) => j === i ? { ...sz, name: v } : sz) }))}
                  placeholder="Size name" className="flex-1" />
                <Input type="number" value={s.price}
                  onChange={v => setNewItem(p => ({ ...p, sizes: p.sizes.map((sz, j) => j === i ? { ...sz, price: v } : sz) }))}
                  placeholder="Price" className="w-24" />
                {newItem.sizes.length > 1 && (
                  <button onClick={() => setNewItem(p => ({ ...p, sizes: p.sizes.filter((_, j) => j !== i) }))}
                    className="text-gray-400 hover:text-red-500 mt-2.5 p-1.5 rounded-lg hover:bg-red-50 transition-colors">
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
            <Btn size="sm" variant="ghost" onClick={() => setNewItem(p => ({ ...p, sizes: [...p.sizes, { name: '', price: '' }] }))}>
              <Plus size={12} /> Add Size
            </Btn>
          </div>
          <Divider />
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={() => setShowAddItem(false)} className="flex-1">Cancel</Btn>
            <Btn variant="mango" onClick={handleAddItem} loading={createItem.isPending}
              disabled={!newItem.name || newItem.sizes.every(s => !s.price)} className="flex-1">Add Item</Btn>
          </div>
        </div>
      </Modal>

      <Modal open={!!editItem} onClose={() => { setEditItem(null); setEditForm(null); }} title={`Edit: ${editItem?.name}`} maxWidth="max-w-md">
        {editForm && (
          <div className="flex flex-col gap-4">
            <Input label="Item Name" value={editForm.name} onChange={v => setEditForm(p => p ? { ...p, name: v } : null)} />
            <Select label="Category" value={editForm.category_id}
              onChange={v => setEditForm(p => p ? { ...p, category_id: v } : null)}
              options={[{ value: '', label: '— No category —' }, ...categories.map((c: Category) => ({ value: c.id, label: c.name }))]} />
            <div>
              <div className="text-xs font-800 text-gray-500 uppercase tracking-widest mb-2.5"
                style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>Sizes & Prices</div>
              {editForm.sizes.map((s, i) => (
                <div key={i} className="flex gap-2 mb-2 items-start">
                  <Input value={s.name}
                    onChange={v => setEditForm(p => p ? { ...p, sizes: p.sizes.map((sz, j) => j === i ? { ...sz, name: v } : sz) } : null)}
                    placeholder="Size name" className="flex-1" />
                  <Input type="number" value={s.price}
                    onChange={v => setEditForm(p => p ? { ...p, sizes: p.sizes.map((sz, j) => j === i ? { ...sz, price: v } : sz) } : null)}
                    placeholder="Price" className="w-24" />
                  {editForm.sizes.length > 1 && (
                    <button onClick={() => setEditForm(p => p ? { ...p, sizes: p.sizes.filter((_, j) => j !== i) } : null)}
                      className="text-gray-400 hover:text-red-500 mt-2.5 p-1.5 rounded-lg hover:bg-red-50 transition-colors">
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
              <Btn size="sm" variant="ghost" onClick={() => setEditForm(p => p ? { ...p, sizes: [...p.sizes, { name: '', price: '' }] } : null)}>
                <Plus size={12} /> Add Size
              </Btn>
            </div>
            <Divider />
            <div className="flex gap-2">
              <Btn variant="secondary" onClick={() => { setEditItem(null); setEditForm(null); }} className="flex-1">Cancel</Btn>
              <Btn variant="mango" onClick={handleEditItem} loading={updateItem.isPending}
                disabled={!editForm.name || editForm.sizes.every(s => !s.price)} className="flex-1">
                <Save size={14} /> Save Changes
              </Btn>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={showAddAddon} onClose={() => setShowAddAddon(false)} title="Add Add-on">
        <div className="flex flex-col gap-4">
          <Input label="Add-on Name" value={newAddon.name} onChange={v => setNewAddon(p => ({ ...p, name: v }))} />
          <Input label="Price (₱)" type="number" value={newAddon.price} onChange={v => setNewAddon(p => ({ ...p, price: v }))} min={0} step={0.01} />
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

// ─── Admin Staff Page ─────────────────────────────────────────
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
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--surface-page)' }}>
      <div className="px-4 py-3 bg-white border-b border-gray-150 shrink-0 flex items-center justify-between"
        style={{ boxShadow: '0 1px 0 rgba(0,0,0,0.04)' }}>
        <h2 className="text-sm font-800 text-gray-900" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>Staff Management</h2>
        <Btn size="sm" variant="mango" onClick={() => setShowAddUser(true)}><Plus size={14} /> Add Staff</Btn>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-2xl mx-auto">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 shimmer rounded-2xl" />)}
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {users?.map((u: User) => (
                <div key={u.id}
                  className={clsx('bg-white border rounded-2xl px-4 py-4 flex items-center gap-3.5 shadow-sm transition-all',
                    u.is_active ? 'border-gray-150' : 'border-gray-100 opacity-60')}>
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center font-black text-amber-900 text-lg shrink-0"
                    style={{ backgroundColor: 'var(--mango-yellow)', fontFamily: 'var(--font-display)', fontWeight: 900 }}>
                    {u.name[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-gray-900 font-700 text-sm" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{u.name}</span>
                      <Badge color={u.role === 'admin' ? 'yellow' : 'gray'}>{u.role}</Badge>
                      {!u.is_active && <Badge color="red">inactive</Badge>}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 font-medium">
                      {u.id === me?.id ? 'You · logged in' : u.role === 'admin' ? 'Administrator' : 'Staff Member'}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Btn size="sm" variant="ghost" onClick={() => setPinReset({ userId: u.id, newPin: '' })} title="Reset PIN">
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
                <div className="text-center text-gray-400 py-16">
                  <Users size={36} className="mx-auto mb-3 opacity-30" />
                  No staff members found
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Modal open={showAddUser} onClose={() => setShowAddUser(false)} title="Add Staff Member">
        <div className="flex flex-col gap-4">
          <Input label="Full Name" value={newUser.name} onChange={v => setNewUser(p => ({ ...p, name: v }))} autoFocus />
          <Select label="Role" value={newUser.role} onChange={v => setNewUser(p => ({ ...p, role: v as 'crew' | 'admin' }))}
            options={[{ value: 'crew', label: 'Staff / Crew' }, { value: 'admin', label: 'Admin' }]} />
          <Input label="6-Digit PIN" type="password" value={newUser.pin} maxLength={6} placeholder="Enter 6 digits"
            onChange={v => setNewUser(p => ({ ...p, pin: v.replace(/\D/g, '').slice(0, 6) }))} />
          {newUser.pin.length > 0 && newUser.pin.length < 6 && (
            <p className="text-xs text-amber-600 font-medium">{6 - newUser.pin.length} more digit(s) needed</p>
          )}
          <Divider />
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={() => setShowAddUser(false)} className="flex-1">Cancel</Btn>
            <Btn variant="mango" onClick={handleAddUser} loading={createUser.isPending}
              disabled={!newUser.name || newUser.pin.length !== 6} className="flex-1">Create Staff</Btn>
          </div>
        </div>
      </Modal>

      <Modal open={!!pinReset} onClose={() => setPinReset(null)} title="Reset Staff PIN">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-500">Enter a new 6-digit PIN. Admin PIN will be required to confirm.</p>
          <Input label="New 6-Digit PIN" type="password" value={pinReset?.newPin ?? ''} maxLength={6} placeholder="Enter 6 digits"
            onChange={v => setPinReset(p => p ? { ...p, newPin: v.replace(/\D/g, '').slice(0, 6) } : null)} />
          {pinReset?.newPin && pinReset.newPin.length < 6 && (
            <p className="text-xs text-amber-600 font-medium">{6 - pinReset.newPin.length} more digit(s) needed</p>
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

// ─── Admin Settings Page ──────────────────────────────────────
function AdminSettingsPage() {
  const { data: settings, isLoading } = useSettings();
  const updateSettings = useUpdateSettings();
  const [form, setForm] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => { if (settings) { setForm(settings); setDirty(false); } }, [settings]);

  const set = (key: string, val: string) => { setForm(p => ({ ...p, [key]: val })); setDirty(true); };

  const handleSave = async () => {
    await updateSettings.mutateAsync(form);
    setDirty(false);
    toast('Settings saved');
  };

  const fields: { key: string; label: string; type?: string; hint?: string }[] = [
    { key: 'store_name',       label: 'Store Name' },
    { key: 'store_address',    label: 'Store Address' },
    { key: 'store_contact',    label: 'Contact Number' },
    { key: 'receipt_footer',   label: 'Receipt Footer Message' },
    { key: 'sc_discount_pct',  label: 'Senior Citizen Discount %', type: 'number', hint: 'Default: 20%' },
    { key: 'pwd_discount_pct', label: 'PWD Discount %',            type: 'number', hint: 'Default: 20%' },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--surface-page)' }}>
      <div className="px-4 py-3 bg-white border-b border-gray-150 shrink-0 flex items-center justify-between"
        style={{ boxShadow: '0 1px 0 rgba(0,0,0,0.04)' }}>
        <h2 className="text-sm font-800 text-gray-900" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>System Settings</h2>
        {dirty && (
          <Btn variant="mango" size="sm" onClick={handleSave} loading={updateSettings.isPending}>
            <Save size={14} /> Save Changes
          </Btn>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="max-w-md mx-auto space-y-3">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 shimmer rounded-2xl" />)}
          </div>
        ) : (
          <div className="max-w-md mx-auto">
            <div className="bg-white border border-gray-150 rounded-2xl shadow-sm overflow-hidden">
              {fields.map((f, idx) => (
                <div key={f.key} className={clsx('px-5 py-4', idx > 0 && 'border-t border-gray-100')}>
                  <Input label={f.label} type={f.type ?? 'text'} value={form[f.key] ?? ''} onChange={v => set(f.key, v)}
                    placeholder={f.hint} hint={f.hint && form[f.key] ? undefined : f.hint} />
                </div>
              ))}
            </div>
            {dirty && (
              <Btn variant="mango" fullWidth size="lg" onClick={handleSave} loading={updateSettings.isPending} className="mt-4">
                <Save size={16} /> Save All Changes
              </Btn>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Admin Audit Log Page ─────────────────────────────────────
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
    if (action.includes('update') || action.includes('edit') || action.includes('reset') || action.includes('close')) return 'yellow';
    return 'gray';
  };

  const entityIcon = (type: string) => {
    switch (type) {
      case 'sale': return '🧾';
      case 'user': return '👤';
      case 'menu_item': return '☕';
      case 'shift': return '🕐';
      case 'settings': return '⚙️';
      default: return '📋';
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--surface-page)' }}>
      <div className="px-4 py-3 bg-white border-b border-gray-150 shrink-0 flex flex-wrap gap-2 items-end"
        style={{ boxShadow: '0 1px 0 rgba(0,0,0,0.04)' }}>
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
          <div className="max-w-3xl mx-auto space-y-2">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-16 shimmer rounded-2xl" />)}
          </div>
        ) : !logs?.length ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <ShieldCheck size={36} className="text-gray-200 mb-3" />
            <p className="text-gray-400 text-sm font-medium">No audit logs found</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto flex flex-col gap-2">
            {logs.map((log: AuditLog) => {
              const { title, detail } = formatAuditEntry(log);
              return (
                <div key={log.id} className="bg-white border border-gray-150 rounded-2xl px-4 py-3.5 shadow-sm">
                  <div className="flex items-start gap-3">
                    <span className="text-xl shrink-0 mt-0.5">{entityIcon(log.entity_type)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge color={actionColor(log.action)}>{title}</Badge>
                        <span className="text-gray-800 text-sm font-700" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                          {log.user_name}
                        </span>
                        <span className="text-gray-400 text-xs bg-gray-100 px-2 py-0.5 rounded-full capitalize font-medium">
                          {log.entity_type.replace('_', ' ')}
                        </span>
                      </div>
                      {detail && <p className="text-gray-500 text-xs mt-1.5 leading-relaxed">{detail}</p>}
                      {log.entity_id && (
                        <span className="text-gray-300 text-xs font-mono mt-0.5 block">{log.entity_id.slice(0, 8)}…</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 shrink-0 text-right whitespace-nowrap font-medium">{fmtDate(log.created_at)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── App Shell ────────────────────────────────────────────────
function AppShell() {
  const { page } = useUIStore();
  const { user } = useAuthStore();

  const pageMap: Partial<Record<Page, React.ReactNode>> = {
    pos:               <POSPage />,
    sales:             <SalesPage />,
    admin_dashboard:   <AdminDashboardPage />,
    admin_menu:        <AdminMenuPage />,
    admin_employees:   <AdminEmployeesPage />,
    admin_settings:    <AdminSettingsPage />,
    admin_audit:       <AdminAuditPage />,
  };

  const adminPages: Page[] = ['admin_dashboard','admin_menu','admin_employees','admin_settings','admin_audit'];
  const currentPage: Page = adminPages.includes(page) && user?.role !== 'admin' ? 'pos' : page;

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--surface-page)' }}>
      <Header />
      <main className="flex-1 overflow-hidden">
        {pageMap[currentPage] ?? <POSPage />}
      </main>
      <PinModal />
    </div>
  );
}

export default function App() {
  const { user, token, logout } = useAuthStore();

  useEffect(() => {
    if (user && token) {
      // Validate token is still alive
      fetch(`${import.meta.env.VITE_API_URL ?? ''}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(res => { if (!res.ok) logout(); })
        .catch(() => logout());
    }
  }, []);

  if (!user || !token) return <LoginPage />;
  return <AppShell />;
}