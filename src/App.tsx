import React, {
  useState, useEffect, useCallback, useRef, useMemo, memo,
} from 'react';
import { format, parseISO, startOfWeek, endOfWeek } from 'date-fns';
import { clsx } from 'clsx';
import {
  ShoppingCart, Search, X, Plus, Minus, ChevronDown, ChevronUp,
  LogOut, Users, BarChart2, Settings, Package, Receipt,
  AlertTriangle, Printer, Trash2, Edit2, RefreshCw,
  DollarSign, TrendingUp, Menu as MenuIcon, ShieldCheck,
  ArrowLeft, Save, ChevronRight, Coffee, Tag, Maximize, Minimize,
  ArrowUp, ArrowDown, FileText,
} from 'lucide-react';
import { useAuthStore, useCartStore, useUIStore, useCartTotal, useCartItemCount, useCartSubtotal, useCartDiscountTotal, useCartIsEmpty} from './store';
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
  useUpdateAddon, useCreateAddon, useEditSale,
  useDeleteCategory, useReorderCategory, useDetailedSalesReport,
} from './api';
import {
  printReceipt,
  selectAndSavePrinter,
  autoReconnectPrinter,
  getSavedPrinter,
  forgetPrinter,
} from './thermalPrint';

// ─── Category colour palette ──────────────────────────────────
// FIX C: Module-level constant — was incorrectly defined inside CartItemRow's
// component body, causing a new 8-element array allocation on every render.
// Moved here alongside CARD_COLOR_CLASSES (same pattern).
// The useMemo in CartItemRow now has a stable dependency (no new array ref each render).
const CART_ACCENT_COLORS = [
  '#F59E0B','#059669','#E11D48','#7C3AED',
  '#0284C7','#EA580C','#DB2777','#0F766E',
] as const;

const CARD_COLOR_CLASSES = [
  'ic-amber', 'ic-emerald', 'ic-rose', 'ic-violet',
  'ic-sky', 'ic-orange', 'ic-pink', 'ic-teal',
] as const;
type CardColorClass = typeof CARD_COLOR_CLASSES[number];

const CATEGORY_COLORS: {
  pill: string; pillText: string; lightBg: string;
  cardClass: CardColorClass;
  accentBar: string;
}[] = [
  { pill: '#F59E0B', pillText: '#ffffff', lightBg: '#FFF8E1', cardClass: 'ic-amber',   accentBar: '#F59E0B' },
  { pill: '#059669', pillText: '#ffffff', lightBg: '#E8F5E9', cardClass: 'ic-emerald', accentBar: '#059669' },
  { pill: '#E11D48', pillText: '#ffffff', lightBg: '#FFF0F3', cardClass: 'ic-rose',    accentBar: '#E11D48' },
  { pill: '#7C3AED', pillText: '#ffffff', lightBg: '#F3E5F5', cardClass: 'ic-violet',  accentBar: '#7C3AED' },
  { pill: '#0284C7', pillText: '#ffffff', lightBg: '#E1F5FE', cardClass: 'ic-sky',     accentBar: '#0284C7' },
  { pill: '#EA580C', pillText: '#ffffff', lightBg: '#FFF3E0', cardClass: 'ic-orange',  accentBar: '#EA580C' },
  { pill: '#DB2777', pillText: '#ffffff', lightBg: '#FCE4EC', cardClass: 'ic-pink',    accentBar: '#DB2777' },
  { pill: '#0F766E', pillText: '#ffffff', lightBg: '#E0F2F1', cardClass: 'ic-teal',    accentBar: '#0F766E' },
];

function getCategoryColor(idx: number) {
  return CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
}

// ─── Helpers ──────────────────────────────────────────────────
function fmt(amount: number) { return `P${amount.toFixed(2)}`; }
function fmtDate(iso: string) {
  try { return format(parseISO(iso), 'MMM d, yyyy h:mm a'); } catch { return iso; }
}

// ─── Toast (stable across renders) ────────────────────────────
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
  const t1 = setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(-6px)'; }, 2600);
  const t2 = setTimeout(() => el.remove(), 3000);
  // No leak — el is removed from DOM; timers are fire-and-forget intentionally
}

function Divider() { return <div className="border-t border-gray-100 my-1" />; }

// ─── UI Primitives ─────────────────────────────────────────────
// memo: Btn is used ~100+ times; prevent re-render when parent state changes
const Btn = memo(function Btn({
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
    'inline-flex items-center justify-center font-semibold rounded-xl',
    // transition only GPU-composited properties — no box-shadow change
    'transition-transform duration-100 ease-out',
    'active:scale-95 select-none whitespace-nowrap cursor-pointer',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
    'disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none',
    // eliminate 300ms tap delay on Android
    'touch-action-manipulation',
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
      cls = 'hover:brightness-105 focus-visible:ring-yellow-400';
      break;
    case 'warrior':
      styles.backgroundColor = 'var(--warrior-red)';
      styles.color = '#fff';
      cls = 'hover:brightness-105 focus-visible:ring-red-400';
      break;
    case 'leaf':
      styles.backgroundColor = 'var(--leaf-green)';
      styles.color = '#fff';
      cls = 'hover:brightness-105 focus-visible:ring-green-400';
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
});

const Input = memo(function Input({
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
          'transition-colors duration-100',
          'font-medium'
        )}
        style={{ fontFamily: 'var(--font-body)' }}
      />
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  );
});

const Select = memo(function Select({
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
          transition-colors duration-100 font-medium cursor-pointer appearance-none"
        style={{ fontFamily: 'var(--font-body)', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2371717A' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
});

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4" role="dialog" aria-modal="true">
      {/* Lighter backdrop-filter for low-end GPU */}
      <div className="absolute inset-0 modal-backdrop" onClick={onClose} />
      <div className={clsx(
        'relative bg-white rounded-2xl shadow-2xl w-full overflow-y-auto animate-bounce-in scrollable pin-modal-inner',
        'border border-gray-100',
        maxWidth
      )} style={{ maxHeight: '92vh' }}>
        {title && (
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 sticky top-0 bg-white z-10 rounded-t-2xl">
            <h2 className="text-base font-800 text-gray-900" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>{title}</h2>
            {onClose && (
              <button onClick={onClose} aria-label="Close dialog"
                className="text-gray-400 hover:text-gray-700 p-1.5 rounded-xl hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400">
                <X size={16} />
              </button>
            )}
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Confirm Dialog ────────────────────────────────────────────
function ConfirmDialog({
  open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', variant = 'danger',
}: {
  open: boolean; onClose: () => void; onConfirm: () => void;
  title: string; message: string; confirmLabel?: string; variant?: 'danger' | 'mango';
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-sm">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-600">{message}</p>
        <div className="flex gap-2">
          <Btn variant="secondary" onClick={onClose} className="flex-1">Cancel</Btn>
          <Btn variant={variant} onClick={() => { onConfirm(); onClose(); }} className="flex-1">{confirmLabel}</Btn>
        </div>
      </div>
    </Modal>
  );
}

// memo: Badge is rendered in every sales list row and audit log row
const Badge = memo(function Badge({ children, color = 'gray' }: { children: React.ReactNode; color?: string }) {
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
});

// ─── Audit log formatter ──────────────────────────────────────
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
      actioned_by: 'Actioned By',
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

// ─── PIN lockout helpers ───────────────────────────────────────
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 60_000;

const pinLockoutState = {
  attempts: 0,
  lockedUntil: 0,
  increment() {
    this.attempts += 1;
    if (this.attempts >= PIN_MAX_ATTEMPTS) {
      this.lockedUntil = Date.now() + PIN_LOCKOUT_MS;
      this.attempts = 0;
    }
  },
  reset() { this.attempts = 0; this.lockedUntil = 0; },
  isLocked() { return Date.now() < this.lockedUntil; },
  secondsLeft() { return Math.ceil(Math.max(0, this.lockedUntil - Date.now()) / 1000); },
};

// ─── Any-User PIN Modal ────────────────────────────────────────
function AnyUserPinModal({
  open, onClose, onSuccess, title, description,
}: {
  open: boolean; onClose: () => void;
  onSuccess: (result: { user_id: string; user_name: string; role: string }) => void;
  title: string; description: string;
}) {
  const { data: usersList } = useUsersList();
  const login = useLogin();
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const [lockSecs, setLockSecs] = useState(0);

  useEffect(() => {
    if (!open) { setSelectedUser(null); setPin(''); setError(''); }
  }, [open]);

  useEffect(() => {
    if (!locked) return;
    const iv = setInterval(() => {
      const secs = pinLockoutState.secondsLeft();
      if (secs <= 0) { setLocked(false); setLockSecs(0); clearInterval(iv); }
      else setLockSecs(secs);
    }, 500);
    return () => clearInterval(iv);
  }, [locked]);

  const doSubmit = useCallback(async (pinValue: string, user: User) => {
    if (pinLockoutState.isLocked()) {
      setLocked(true); setLockSecs(pinLockoutState.secondsLeft()); setPin(''); return;
    }
    try {
      await login.mutateAsync({ user_id: user.id, pin: pinValue });
      pinLockoutState.reset();
      onSuccess({ user_id: user.id, user_name: user.name, role: user.role });
    } catch {
      pinLockoutState.increment();
      if (pinLockoutState.isLocked()) {
        setLocked(true); setLockSecs(pinLockoutState.secondsLeft());
        setError(`Too many attempts. Locked for ${pinLockoutState.secondsLeft()}s.`);
      } else {
        setError(`Invalid PIN. ${PIN_MAX_ATTEMPTS - pinLockoutState.attempts} attempt(s) left.`);
      }
      setPin('');
    }
  }, [login, onSuccess]);

  const press = useCallback((val: string) => {
    if (locked || !selectedUser) return;
    if (val === 'DEL') { setPin(p => p.slice(0, -1)); setError(''); return; }
    if (pin.length >= 6) return;
    const next = pin + val;
    setPin(next); setError('');
    if (next.length === 6 && selectedUser) setTimeout(() => doSubmit(next, selectedUser), 50);
  }, [locked, selectedUser, pin, doSubmit]);

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-xs">
      <div className="flex flex-col items-center gap-4">
        <p className="text-sm text-gray-500 text-center leading-relaxed">{description}</p>

        {!selectedUser ? (
          <div className="flex flex-col gap-2 w-full">
            <p className="text-xs text-gray-400 text-center font-medium">Select your account</p>
            {(usersList ?? []).map((u: User) => (
              <button key={u.id}
                onClick={() => { setSelectedUser(u); setPin(''); setError(''); }}
                className="flex items-center gap-3 p-3 bg-gray-50 hover:bg-yellow-50 border border-gray-200
                  hover:border-yellow-300 rounded-2xl transition-colors text-left group active:scale-98
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-amber-900 text-sm shrink-0"
                  style={{ backgroundColor: 'var(--mango-yellow)', fontFamily: 'var(--font-display)' }}>
                  {u.name[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-gray-900 font-700 text-sm" style={{ fontWeight: 700 }}>{u.name}</div>
                  <div className="text-gray-400 text-xs capitalize">{u.role}</div>
                </div>
                <ChevronRight size={14} className="text-gray-300 group-hover:text-yellow-500 shrink-0" />
              </button>
            ))}
          </div>
        ) : (
          <>
            <button onClick={() => { setSelectedUser(null); setPin(''); setError(''); }}
              className="flex items-center gap-1.5 text-gray-400 hover:text-gray-700 text-sm transition-colors self-start font-medium
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 rounded-lg px-1">
              <ArrowLeft size={14} /> {selectedUser.name}
            </button>

            {locked ? (
              <div className="flex flex-col items-center gap-2 py-4">
                <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center">
                  <AlertTriangle size={24} className="text-red-500" />
                </div>
                <p className="text-red-600 font-700 text-sm text-center" style={{ fontWeight: 700 }}>PIN entry locked</p>
                <p className="text-gray-500 text-xs text-center">Try again in <span className="font-bold text-red-600">{lockSecs}s</span></p>
              </div>
            ) : (
              <>
                <div className="flex gap-2" role="status" aria-live="polite">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="rounded-full border-2 flex items-center justify-center transition-all duration-150"
                      style={{
                        width: '36px', height: '36px',
                        borderColor: i < pin.length ? 'var(--mango-yellow)' : '#E4E4E7',
                        backgroundColor: i < pin.length ? 'var(--mango-yellow)' : '#F4F4F5',
                      }}>
                      {i < pin.length && <span className="text-amber-900 font-black" style={{ fontSize: '9px' }}>●</span>}
                    </div>
                  ))}
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 px-3 py-2 rounded-xl border border-red-100 w-full justify-center font-medium" role="alert">
                    <AlertTriangle size={12} /> {error}
                  </div>
                )}

                <div className="grid grid-cols-3 w-full gap-2" style={{ maxWidth: '210px' }} role="group" aria-label="PIN keypad">
                  {['1','2','3','4','5','6','7','8','9','','0','DEL'].map((k, i) =>
                    k === '' ? <div key={i} /> : (
                      <button key={i} onClick={() => press(k)}
                        aria-label={k === 'DEL' ? 'Delete last digit' : `Digit ${k}`}
                        className={clsx(
                          'rounded-xl font-bold transition-colors duration-75 active:scale-95 border select-none',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400',
                          k === 'DEL'
                            ? 'bg-gray-100 text-gray-500 text-xs border-gray-200 hover:bg-gray-200'
                            : 'bg-white text-gray-900 border-gray-200 hover:bg-yellow-50 hover:border-yellow-300 shadow-sm'
                        )}
                        style={{ height: '50px', fontSize: '18px', fontFamily: 'var(--font-display)' }}>
                        {k}
                      </button>
                    )
                  )}
                </div>
              </>
            )}
          </>
        )}

        <Btn onClick={onClose} variant="ghost" size="sm">Cancel</Btn>
      </div>
    </Modal>
  );
}

// ─── PIN Modal (self-verify, with lockout) ────────────────────
function PinModal() {
  const { pinModal, resolvePinModal } = useUIStore();
  const { user } = useAuthStore();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const [lockSecs, setLockSecs] = useState(0);
  const verifyPin = useVerifyPin();

  useEffect(() => {
    if (pinModal.open) { setPin(''); setError(''); }
  }, [pinModal.open]);

  useEffect(() => {
    if (!locked) return;
    const iv = setInterval(() => {
      const secs = pinLockoutState.secondsLeft();
      if (secs <= 0) { setLocked(false); setLockSecs(0); clearInterval(iv); }
      else setLockSecs(secs);
    }, 500);
    return () => clearInterval(iv);
  }, [locked]);

  useEffect(() => {
    if (!pinModal.open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') press(e.key);
      else if (e.key === 'Backspace') press('DEL');
      else if (e.key === 'Escape') resolvePinModal({ verified: false });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pinModal.open, pin]);

  const doSubmit = useCallback(async (pinValue: string) => {
    if (!user) return;
    if (pinLockoutState.isLocked()) {
      setLocked(true); setLockSecs(pinLockoutState.secondsLeft()); setPin(''); return;
    }
    try {
      await verifyPin.mutateAsync({ user_id: user.id, pin: pinValue, required_role: pinModal.required_role });
      pinLockoutState.reset();
      resolvePinModal({ verified: true, user_id: user.id, user_name: user.name, role: user.role });
    } catch {
      pinLockoutState.increment();
      if (pinLockoutState.isLocked()) {
        setLocked(true); setLockSecs(pinLockoutState.secondsLeft());
        setError(`Too many attempts. Locked for ${pinLockoutState.secondsLeft()}s.`);
      } else {
        setError(`Invalid PIN. ${PIN_MAX_ATTEMPTS - pinLockoutState.attempts} attempt(s) left.`);
      }
      setPin('');
    }
  }, [user, verifyPin, pinModal.required_role, resolvePinModal]);

  const press = useCallback((val: string) => {
    if (locked) return;
    if (val === 'DEL') { setPin(p => p.slice(0, -1)); setError(''); return; }
    if (pin.length >= 6) return;
    const next = pin + val;
    setPin(next); setError('');
    if (next.length === 6) setTimeout(() => doSubmit(next), 50);
  }, [locked, pin, doSubmit]);

  return (
    <Modal
      open={pinModal.open}
      onClose={() => resolvePinModal({ verified: false })}
      title={pinModal.required_role === 'admin' ? '🔒 Admin Verification' : '🔒 Enter PIN'}
      maxWidth="max-w-xs"
    >
      <div className="flex flex-col items-center pin-gap" style={{ gap: '16px' }}>
        <p className="text-sm text-gray-500 text-center leading-relaxed">
          {pinModal.required_role === 'admin'
            ? 'Admin PIN required to continue'
            : 'Enter your 6-digit PIN'}
        </p>
        <p className="text-xs text-gray-400 pin-hide-hint" style={{ marginTop: '-8px' }}>You can also type on your keyboard</p>

        {locked ? (
          <div className="flex flex-col items-center gap-2 py-4">
            <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center">
              <AlertTriangle size={24} className="text-red-500" />
            </div>
            <p className="text-red-600 font-700 text-sm text-center" style={{ fontWeight: 700 }}>PIN entry locked</p>
            <p className="text-gray-500 text-xs text-center">Too many failed attempts. Try again in <span className="font-bold text-red-600">{lockSecs}s</span></p>
          </div>
        ) : (
          <>
            <div className="flex pin-gap" style={{ gap: '8px' }} role="status" aria-live="polite" aria-label={`${pin.length} of 6 digits entered`}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i}
                  className="pin-dot rounded-full border-2 flex items-center justify-center transition-all duration-150"
                  style={{
                    width: '38px', height: '38px',
                    borderColor: i < pin.length ? 'var(--mango-yellow)' : '#E4E4E7',
                    backgroundColor: i < pin.length ? 'var(--mango-yellow)' : '#F4F4F5',
                    boxShadow: i < pin.length ? '0 0 0 3px rgba(249,214,76,0.2)' : 'none',
                  }}>
                  {i < pin.length && <span className="text-amber-900 font-black" style={{ fontSize: '10px', lineHeight: 1 }}>●</span>}
                </div>
              ))}
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 px-3 py-2 rounded-xl border border-red-100 w-full justify-center font-medium" role="alert">
                <AlertTriangle size={12} /> {error}
              </div>
            )}

            <div className="grid grid-cols-3 w-full pin-gap" style={{ gap: '8px', maxWidth: '220px' }} role="group" aria-label="PIN keypad">
              {['1','2','3','4','5','6','7','8','9','','0','DEL'].map((k, i) =>
                k === '' ? <div key={i} /> : (
                  <button key={i} onClick={() => press(k)}
                    aria-label={k === 'DEL' ? 'Delete last digit' : `Digit ${k}`}
                    className={clsx(
                      'pin-key rounded-xl font-bold transition-colors duration-75 active:scale-95 border select-none',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-1',
                      k === 'DEL'
                        ? 'bg-gray-100 text-gray-500 text-xs border-gray-200 hover:bg-gray-200'
                        : 'bg-white text-gray-900 border-gray-200 hover:bg-yellow-50 hover:border-yellow-300 shadow-sm'
                    )}
                    style={{ height: '52px', fontSize: '18px', fontFamily: 'var(--font-display)' }}>
                    {k}
                  </button>
                )
              )}
            </div>
          </>
        )}

        <Btn onClick={() => resolvePinModal({ verified: false })} variant="ghost" size="sm">Cancel</Btn>
      </div>
    </Modal>
  );
}

// ─── Receipt ──────────────────────────────────────────────────
const SaleReceipt = memo(function SaleReceipt({ sale, settings }: { sale: SaleDetail; settings: SettingsType }) {
  return (
    <div id="receipt-print" className="bg-white text-gray-900 p-4 text-xs font-mono max-w-[280px] mx-auto">
      <div className="text-center mb-3">
        <div className="text-lg font-bold">{settings.store_name ?? 'Mango Warrior'}</div>
        <div>{settings.store_address}</div>
      </div>
      <div className="border-t border-dashed border-gray-300 my-2" />
      <div className="flex justify-between"><span>Receipt:</span><span>{sale.receipt_number}</span></div>
      <div className="flex justify-between"><span>Cashier:</span><span>{sale.cashier_name}</span></div>
      <div className="flex justify-between"><span>Date:</span><span>{fmtDate(sale.created_at)}</span></div>
      <div className="flex justify-between"><span>Order:</span><span>{sale.order_type === 'take_out' ? 'Take Out' : 'Dine In'}</span></div>
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
});

// ─── Login Page ────────────────────────────────────────────────
function LoginPage() {
  const { data: usersList, isLoading } = useUsersList();
  const login = useLogin();
  const { login: authLogin } = useAuthStore();
  const { navigate } = useUIStore();
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const [lockSecs, setLockSecs] = useState(0);

  useEffect(() => {
    if (!locked) return;
    const iv = setInterval(() => {
      const secs = pinLockoutState.secondsLeft();
      if (secs <= 0) { setLocked(false); setLockSecs(0); clearInterval(iv); }
      else setLockSecs(secs);
    }, 500);
    return () => clearInterval(iv);
  }, [locked]);

  const doLogin = useCallback(async (pinValue: string, user: User) => {
    if (pinLockoutState.isLocked()) {
      setLocked(true); setLockSecs(pinLockoutState.secondsLeft()); setPin(''); return;
    }
    try {
      const res = await login.mutateAsync({ user_id: user.id, pin: pinValue });
      pinLockoutState.reset();
      authLogin(res.user, res.token);
      navigate(res.user.role === 'admin' ? 'admin_dashboard' : 'pos');
    } catch {
      pinLockoutState.increment();
      if (pinLockoutState.isLocked()) {
        setLocked(true); setLockSecs(pinLockoutState.secondsLeft());
        setError(`Too many attempts. Locked for ${pinLockoutState.secondsLeft()}s.`);
      } else {
        setError(`Invalid PIN. ${PIN_MAX_ATTEMPTS - pinLockoutState.attempts} attempt(s) left.`);
      }
      setPin('');
    }
  }, [login, authLogin, navigate]);

  const press = useCallback((val: string) => {
    if (locked || !selectedUser) return;
    if (val === 'DEL') { setPin(p => p.slice(0, -1)); setError(''); return; }
    if (pin.length >= 6) return;
    const next = pin + val;
    setPin(next); setError('');
    if (next.length === 6) setTimeout(() => doLogin(next, selectedUser), 50);
  }, [locked, selectedUser, pin, doLogin]);

  useEffect(() => {
    if (!selectedUser) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') press(e.key);
      else if (e.key === 'Backspace') press('DEL');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedUser, press]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--surface-page)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
<div className="w-20 h-20 flex items-center justify-center mx-auto mb-4">
  <img src="/MWIcon.png" alt="MW POS" className="w-full h-full object-contain" />
</div>
          <h1 className="text-2xl font-900 mb-1" style={{ fontFamily: 'var(--font-display)', fontWeight: 900 }}>
            <span style={{ color: '#D97706' }}>Mango </span><span style={{ color: 'var(--warrior-red)' }}>Warrior</span>
          </h1>
          <p className="text-gray-500 text-sm">Point of Sale System</p>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-lg border border-gray-150">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-16 shimmer rounded-2xl" />
              ))}
            </div>
          ) : !selectedUser ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-center text-gray-400 font-medium mb-1">Select your account to continue</p>
              {(usersList ?? []).map((u: User) => (
                <button key={u.id}
                  onClick={() => { setSelectedUser(u); setPin(''); setError(''); }}
                  className="flex items-center gap-3 p-3 bg-gray-50 hover:bg-yellow-50 border border-gray-200
                    hover:border-yellow-300 rounded-2xl transition-colors text-left group active:scale-98
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-amber-900 text-sm shrink-0"
                    style={{ backgroundColor: 'var(--mango-yellow)', fontFamily: 'var(--font-display)' }}>
                    {u.name[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-gray-900 font-700 text-sm" style={{ fontWeight: 700 }}>{u.name}</div>
                    <div className="text-gray-400 text-xs capitalize">{u.role}</div>
                  </div>
                  <ChevronRight size={15} className="text-gray-300 group-hover:text-yellow-500 shrink-0" />
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <button onClick={() => { setSelectedUser(null); setPin(''); setError(''); }}
                className="flex items-center gap-1.5 text-gray-400 hover:text-gray-700 text-sm transition-colors self-start font-medium
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 rounded-lg px-1">
                <ArrowLeft size={14} /> {selectedUser.name}
              </button>

              {locked ? (
                <div className="flex flex-col items-center gap-3 py-6">
                  <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center">
                    <AlertTriangle size={28} className="text-red-500" />
                  </div>
                  <p className="text-red-600 font-700 text-sm text-center" style={{ fontWeight: 700 }}>PIN entry locked</p>
                  <p className="text-gray-500 text-sm text-center">
                    Try again in <span className="font-bold text-red-600">{lockSecs}s</span>
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex gap-2" role="status" aria-live="polite">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="rounded-full border-2 transition-all duration-150"
                        style={{
                          width: '40px', height: '40px',
                          borderColor: i < pin.length ? 'var(--mango-yellow)' : '#E4E4E7',
                          backgroundColor: i < pin.length ? 'var(--mango-yellow)' : '#F4F4F5',
                        }}>
                        {i < pin.length && <div className="w-full h-full flex items-center justify-center">
                          <span className="text-amber-900 font-black" style={{ fontSize: '10px' }}>●</span>
                        </div>}
                      </div>
                    ))}
                  </div>

                  {error && (
                    <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 px-3 py-2 rounded-xl border border-red-100 w-full justify-center font-medium" role="alert">
                      <AlertTriangle size={12} /> {error}
                    </div>
                  )}

                  <div className="grid grid-cols-3 w-full gap-2" style={{ maxWidth: '240px' }}>
                    {['1','2','3','4','5','6','7','8','9','','0','DEL'].map((k, i) =>
                      k === '' ? <div key={i} /> : (
                        <button key={i} onClick={() => press(k)}
                          aria-label={k === 'DEL' ? 'Delete' : k}
                          className={clsx(
                            'rounded-2xl font-bold transition-colors duration-75 active:scale-95 border select-none',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400',
                            k === 'DEL'
                              ? 'bg-gray-100 text-gray-500 text-xs border-gray-200 hover:bg-gray-200'
                              : 'bg-white text-gray-900 border-gray-200 hover:bg-yellow-50 hover:border-yellow-300 shadow-sm'
                          )}
                          style={{ height: '56px', fontSize: '20px', fontFamily: 'var(--font-display)' }}>
                          {k}
                        </button>
                      )
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────
function Header() {
  const { page, navigate } = useUIStore();
  const { user, logout } = useAuthStore();
  const { data: shift } = useCurrentShift();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  }, []);

  const handleLogout = useCallback(() => {
    logout();
    setMenuOpen(false);
  }, [logout]);

  const navItems: { label: string; page: Page; icon: React.ReactNode; adminOnly?: boolean }[] = [
    { label: 'POS',       page: 'pos',              icon: <ShoppingCart size={14} /> },
    { label: 'Sales',     page: 'sales',            icon: <Receipt size={14} /> },
    { label: 'Dashboard', page: 'admin_dashboard',  icon: <BarChart2 size={14} />, adminOnly: true },
    { label: 'Menu',      page: 'admin_menu',       icon: <Coffee size={14} />,    adminOnly: true },
    { label: 'Staff',     page: 'admin_employees',  icon: <Users size={14} />,     adminOnly: true },
    { label: 'Settings',  page: 'admin_settings',   icon: <Settings size={14} />,  adminOnly: true },
    { label: 'Audit',     page: 'admin_audit',      icon: <ShieldCheck size={14} />, adminOnly: true },
  ];
  const visible = useMemo(
    () => navItems.filter(n => !n.adminOnly || user?.role === 'admin'),
    [user?.role]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const idx = parseInt(e.key) - 1;
      if (idx >= 0 && idx < visible.length) { navigate(visible[idx].page); e.preventDefault(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible, navigate]);

  return (
    <header className="flex items-center h-14 px-4 bg-white border-b border-gray-150 shrink-0 z-30 relative"
      style={{ boxShadow: '0 1px 0 rgba(0,0,0,0.05), 0 2px 8px rgba(0,0,0,0.04)' }}>

      <div className="font-black text-base mr-5 flex items-center gap-2 shrink-0" style={{ fontFamily: 'var(--font-display)' }}>
<div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
  <img src="/MWIcon.png" alt="MW POS" className="w-full h-full object-contain" />
</div>
        <span className="hidden sm:inline">
          <span style={{ color: '#D97706' }}>Mango </span><span style={{ color: 'var(--warrior-red)' }}>Warrior</span>
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

      <nav className="hidden md:flex items-center gap-1 flex-1" aria-label="Main navigation">
        {visible.map((n, idx) => {
          const isActive = page === n.page;
          return (
            <button key={n.page} onClick={() => navigate(n.page)}
              aria-current={isActive ? 'page' : undefined}
              title={`${n.label} (Alt+${idx + 1})`}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors duration-100',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400',
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
          aria-expanded={menuOpen}
          aria-label="Open navigation menu"
          className="text-gray-500 hover:text-gray-900 p-2 rounded-xl hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400">
          <MenuIcon size={18} />
        </button>
        {menuOpen && (
          <div className="absolute top-14 left-0 right-0 bg-white border-b border-gray-200 shadow-xl z-50 p-3 flex flex-col gap-1 animate-fade-up">
            {visible.map((n) => {
              const isActive = page === n.page;
              return (
                <button key={n.page} onClick={() => { navigate(n.page); setMenuOpen(false); }}
                  aria-current={isActive ? 'page' : undefined}
                  className={clsx(
                    'flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400',
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

      <div className="flex items-center gap-2 ml-auto">
        <button onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          className="text-gray-400 hover:text-gray-700 p-2 rounded-xl hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400">
          {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
        </button>

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
          className="text-gray-400 hover:text-red-500 transition-colors p-2 rounded-xl hover:bg-red-50 border border-transparent hover:border-red-100
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
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
  // FIX: Select only the setAddons action — it is a stable reference in Zustand
  // so this selector never causes a re-render. The full useCartStore() subscription
  // was causing this modal to re-render on every unrelated cart mutation (qty
  // changes, discount toggles) even while it was open.
  const setAddons = useCartStore(s => s.setAddons);
  const [selected, setSelected] = useState<CartAddon[]>(currentAddons.map(a => ({ ...a })));

  const toggleAddon = useCallback((addon: Addon) => {
    setSelected(prev => {
      const exists = prev.find(a => a.addon_id === addon.id);
      if (exists) return prev.filter(a => a.addon_id !== addon.id);
      return [...prev, { addon_id: addon.id, addon_name: addon.name, addon_price: addon.price, qty: 1 }];
    });
  }, []);

  const changeQty = useCallback((addonId: string, delta: number) => {
    setSelected(prev => prev.map(a => a.addon_id === addonId ? { ...a, qty: Math.max(1, a.qty + delta) } : a));
  }, []);

  const handleApply = useCallback(() => { setAddons(cartKey, selected); onClose(); }, [setAddons, cartKey, selected, onClose]);
  const availableAddons = useMemo(() => allAddons.filter(a => a.is_available), [allAddons]);
  const addonTotal = useMemo(() => selected.reduce((s, a) => s + a.addon_price * a.qty, 0), [selected]);

  return (
    <Modal open onClose={onClose} title="🧂 Add-ons" maxWidth="max-w-sm">
      <div className="flex flex-col gap-3">
        {availableAddons.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">No add-ons available</p>
        ) : (
          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto scrollable">
            {availableAddons.map((addon) => {
              const sel = selected.find(a => a.addon_id === addon.id);
              return (
                <div key={addon.id}
                  className={clsx(
                    'flex items-center gap-3 px-4 py-3 rounded-2xl border-2 transition-colors duration-100 cursor-pointer',
                    sel ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 bg-white hover:border-gray-300'
                  )}
                  onClick={() => toggleAddon(addon)}
                  role="checkbox" aria-checked={!!sel} tabIndex={0}
                  onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleAddon(addon); } }}>
                  <div className={clsx('w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors', sel ? 'border-yellow-500 bg-yellow-400' : 'border-gray-300')}>
                    {sel && <span className="text-amber-900 text-xs font-black" style={{ lineHeight: 1 }}>✓</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-600 text-gray-900" style={{ fontWeight: 600 }}>{addon.name}</div>
                    <div className="text-xs font-700 text-amber-700 mt-0.5">+{fmt(addon.price)} each</div>
                  </div>
                  {sel && (
                    <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                      <button onClick={() => changeQty(addon.id, -1)} aria-label="Decrease quantity"
                        className="w-7 h-7 rounded-lg bg-white border border-gray-200 hover:bg-gray-100 flex items-center justify-center text-gray-600 shadow-sm transition-colors">
                        <Minus size={10} />
                      </button>
                      <span className="w-5 text-center text-sm font-800 text-gray-900" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>{sel.qty}</span>
                      <button onClick={() => changeQty(addon.id, 1)} aria-label="Increase quantity"
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

// ─── Item Card — memoized to prevent re-render on cart changes ─
const ItemCard = memo(function ItemCard({
  item, colorIdx, onTap,
}: {
  item: MenuItem; colorIdx: number; onTap: (item: MenuItem) => void;
}) {
  const color = getCategoryColor(colorIdx);
  const handleClick = useCallback(() => onTap(item), [item, onTap]);
  return (
    <button
      onClick={handleClick}
      className={`item-card-solid group ${color.cardClass}`}
      aria-label={item.name}
      style={{ minHeight: '70px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        className="ic-text text-base font-700 leading-tight text-center px-2 line-clamp-2"
        style={{ fontFamily: 'var(--font-display)', fontWeight: 700, wordBreak: 'break-word' }}
      >
        {item.name}
      </div>
    </button>
  );
});

// ─── POS Page ─────────────────────────────────────────────────
function POSPage() {
  const cart = useCartStore();
  const { data: menuData, isLoading: menuLoading } = useMenu();
  const { data: settings } = useSettings();
  const { data: shift } = useCurrentShift();
  const { data: heldOrders } = useHeldOrders();

  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQ, setSearchQ] = useState('');
  const [showCheckout, setShowCheckout] = useState(false);
  const [showHeld, setShowHeld] = useState(false);
  const [showShift, setShowShift] = useState(false);
  const [sizeModal, setSizeModal] = useState<{ item: MenuItem } | null>(null);
  const [mobileTab, setMobileTab] = useState<'menu' | 'cart'>('menu');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [addonPickerFor, setAddonPickerFor] = useState<{
    cartKey: string;
    currentAddons: CartAddon[];
  } | null>(null);

  // FIX: Local note state + debounce to prevent full POSPage re-render on every keystroke.
  // cart.setNote() triggers a Zustand set() which re-renders POSPage (full store subscriber)
  // including the entire menu grid. With a local useState the textarea feels instant, and
  // the store only updates 300ms after the user stops typing.
  const [noteLocal, setNoteLocal] = useState(cart.cart.note);
  const noteDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleNoteChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setNoteLocal(val);
    if (noteDebounceRef.current) clearTimeout(noteDebounceRef.current);
    noteDebounceRef.current = setTimeout(() => cart.setNote(val), 300);
  }, [cart]);

  // FIX A: Keep noteLocal in sync when cart.cart.note changes externally.
  // This happens on two code paths:
  //   1. Successful checkout → onSuccess() calls cart.clearCart() which resets
  //      cart.cart.note to ''. Without this effect the textarea keeps showing
  //      the previous order's note on the very next transaction.
  //   2. Held-order restore → cart.loadFromHeld(order.data) replaces the entire
  //      cart state including the note. Without this effect the textarea shows
  //      the note from the *previous* session, not the restored one.
  // The debounce guard prevents a race where an in-flight timer would snap the
  // textarea back while the user is still typing.
  const cartNote = cart.cart.note;
  useEffect(() => {
    // Only sync if the debounce timer is NOT active (user is not mid-keystroke).
    if (!noteDebounceRef.current) {
      setNoteLocal(cartNote);
    }
  }, [cartNote]);
 
  const handleOpenAddonPicker = useCallback((cartKey: string, currentAddons: CartAddon[]) => {
    setAddonPickerFor({ cartKey, currentAddons });
  }, []);

  useEffect(() => {
    if (settings) {
      cart.setDiscountPcts(
        parseFloat(settings.sc_discount_pct ?? '20'),
        parseFloat(settings.pwd_discount_pct ?? '20')
      );
    }
  }, [settings]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.key === 'f') || (e.key === '/' && !['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName))) {
        e.preventDefault(); searchRef.current?.focus();
      }
      if (e.ctrlKey && e.key === 'Enter') {
        if (cart.cart.items.length > 0) setShowCheckout(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cart.cart.items.length]);

  const categories = useMemo(() => menuData?.categories ?? [], [menuData]);
  const allAddons = useMemo(() => menuData?.addons ?? [], [menuData]);
  const allItems = useMemo(() => categories.flatMap((c: Category) => c.items), [categories]);

  // useMemo: prevents re-filtering on every cart change (cart state is separate)
  const filteredItems = useMemo(() => allItems.filter((item: MenuItem) => {
    if (!item.is_available) return false;
    const matchCat = activeCategory === 'all' || item.category_id === activeCategory;
    const matchSearch = item.name.toLowerCase().includes(searchQ.toLowerCase());
    return matchCat && matchSearch;
  }), [allItems, activeCategory, searchQ]);

  const groupedItems = useMemo(() => categories
    .map((cat: Category, idx: number) => ({
      category: cat, colorIdx: idx,
      items: filteredItems.filter((item: MenuItem) => item.category_id === cat.id),
    }))
    .filter(g => g.items.length > 0), [categories, filteredItems]);

  const uncategorizedItems = useMemo(
    () => filteredItems.filter((item: MenuItem) => !item.category_id),
    [filteredItems]
  );

  const addToCart = useCallback((item: MenuItem, sizeName?: string, sizePrice?: number, addons: Addon[] = []) => {
    const price = sizePrice ?? item.sizes[0]?.price ?? 0;
    cart.addItem({
      item_id: item.id, item_name: item.name,
      size_name: sizeName, base_price: price,
      addons: addons.map((a: Addon) => ({ addon_id: a.id, addon_name: a.name, addon_price: a.price, qty: 1 })),
    });
    setSizeModal(null);
  }, [cart]);

  const handleItemTap = useCallback((item: MenuItem) => {
    if (item.sizes.length > 1) setSizeModal({ item });
    else addToCart(item, item.sizes[0]?.name, item.sizes[0]?.price);
  }, [addToCart]);

  // Fine-grained cart hooks — each subscribes to only one computed value.
  // useCartTotal() re-renders only when the cart total changes.
  // useCartItemCount() re-renders only when the total item count changes.
  // FIX B: Also subscribe to subtotal and discountTotal via their own hooks.
  // Previously cart.subtotal() / cart.discountTotal() were called inline in JSX
  // as methods on the full-store 'cart' reference — this is NOT a fine-grained
  // subscription; POSPage still re-rendered on every cart mutation.
  // useCartSubtotal() and useCartDiscountTotal() select the computed numbers
  // so React skips re-renders when those values haven't changed.
  const total         = useCartTotal();
  const subtotal      = useCartSubtotal();
  const discountTotal = useCartDiscountTotal();
  const itemCount     = useCartItemCount();
  const heldCount = heldOrders?.length ?? 0;

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

          {/* Search + category filter bar */}
          <div className="px-3 pt-3 pb-2.5 bg-white border-b border-gray-150 shrink-0"
            style={{ boxShadow: '0 1px 0 rgba(0,0,0,0.04)' }}>
            <div className="relative mb-2.5">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search menu… (/ or Ctrl+F)"
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                aria-label="Search menu items"
                className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl pl-10 pr-10 py-2.5 text-sm
                  focus:outline-none focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/20
                  placeholder-gray-400 font-medium transition-colors duration-100"
              />
              {searchQ && (
                <button onClick={() => setSearchQ('')} aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 transition-colors">
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Category pills */}
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar scrollable-x" role="tablist" aria-label="Filter by category">
              <button
                role="tab" aria-selected={activeCategory === 'all'}
                onClick={() => setActiveCategory('all')}
                className="shrink-0 px-3.5 py-1 rounded-full text-xs font-700 transition-colors duration-100 border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
                style={
                  activeCategory === 'all'
                    ? { backgroundColor: '#18181B', color: '#fff', borderColor: '#18181B', fontWeight: 700 }
                    : { backgroundColor: '#fff', color: '#71717A', borderColor: '#E4E4E7', fontWeight: 600 }
                }>
                All
              </button>
              {categories.map((c: Category, idx: number) => {
                const color = getCategoryColor(idx);
                const isActive = activeCategory === c.id;
                return (
                  <button key={c.id}
                    role="tab" aria-selected={isActive}
                    onClick={() => setActiveCategory(c.id)}
                    className="shrink-0 px-3.5 py-1 rounded-full text-xs font-700 transition-colors duration-100 border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
                    style={isActive
                      ? { backgroundColor: color.pill, color: '#fff', borderColor: color.pill, fontWeight: 700 }
                      : { backgroundColor: '#fff', color: color.pill, borderColor: color.pill + '55', fontWeight: 600 }
                    }>
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Items grid */}
          <div className="flex-1 overflow-y-auto p-3 scrollable">
            {menuLoading ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="shimmer rounded-2xl" style={{ aspectRatio: '1/1' }} />
                ))}
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-center">
                <Coffee size={36} className="text-gray-200 mb-3" />
                <p className="text-gray-400 text-sm font-medium">No items found</p>
                {searchQ && <p className="text-gray-300 text-xs mt-1">Try a different search</p>}
              </div>
            ) : (
              <div className="space-y-4">
                {groupedItems.map(({ category, items, colorIdx }) => {
                  const color = getCategoryColor(colorIdx);
                  const showSection = activeCategory === 'all' || activeCategory === category.id;
                  if (!showSection) return null;
                  return (
                    <div key={category.id}>
                      <div className="cat-divider">
                        <div className="cat-divider-dot" style={{ backgroundColor: color.pill }} />
                        <span className="cat-divider-label">{category.name}</span>
                        <div className="cat-divider-line" />
                        <span className="cat-divider-count">{items.length}</span>
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2" role="list" aria-label={`${category.name} items`}>
                        {items.map(item => (
                          <ItemCard key={item.id} item={item} colorIdx={colorIdx} onTap={handleItemTap} />
                        ))}
                      </div>
                    </div>
                  );
                })}
                {uncategorizedItems.length > 0 && (
                  <div>
                    <div className="cat-divider">
                      <div className="cat-divider-dot" style={{ backgroundColor: '#A1A1AA' }} />
                      <span className="cat-divider-label">Other</span>
                      <div className="cat-divider-line" />
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                      {uncategorizedItems.map(item => (
                        <ItemCard key={item.id} item={item} colorIdx={categories.length} onTap={handleItemTap} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Cart panel ── */}
        <div className={clsx(
          'flex flex-col bg-white border-l border-gray-150 shrink-0 cart-panel-tablet',
          'w-full md:w-72 lg:w-80 xl:w-88',
          mobileTab === 'menu' ? 'hidden md:flex' : 'flex'
        )}>
          {/* Cart header */}
          <div className="px-4 py-3 border-b border-gray-100 shrink-0 flex items-center justify-between"
            style={{ background: 'linear-gradient(90deg, #FFFBEB 0%, #fff 60%)' }}>
            <div className="flex items-center gap-2">
              <ShoppingCart size={15} className="text-amber-600" />
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
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowHeld(true)}
                title="Parked orders"
                className="relative p-2 rounded-xl text-gray-500 hover:text-amber-700 hover:bg-yellow-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
              >
                <Receipt size={15} />
                {heldCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center font-800 text-white"
                    style={{ backgroundColor: 'var(--warrior-red)', fontSize: '9px', fontFamily: 'var(--font-display)', fontWeight: 800 }}>
                    {heldCount}
                  </span>
                )}
              </button>
              {cart.cart.items.length > 0 && (
                <button
                  onClick={() => setShowClearConfirm(true)}
                  aria-label="Clear cart"
                  className="text-xs text-gray-400 hover:text-red-500 font-medium transition-colors flex items-center gap-1 rounded-lg px-1.5 py-1 hover:bg-red-50">
                  <Trash2 size={11} /> Clear
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 scrollable">
            {cart.cart.items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[120px] text-center py-8">
                <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center mb-3">
                  <ShoppingCart size={22} className="text-gray-300" />
                </div>
                <p className="text-sm font-semibold text-gray-400">Cart is empty</p>
                <p className="text-xs text-gray-300 mt-1">Tap any item to add it</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {cart.cart.items.map((item: CartItem) => (
                   <CartItemRow
    key={item.cart_key}
    item={item}
    allAddons={allAddons}
    onOpenAddonPicker={handleOpenAddonPicker}
  />
                ))}
              </div>
            )}
          </div>

          <div className="px-3 pb-2 shrink-0">
            <textarea
              value={noteLocal}
              onChange={handleNoteChange}
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
                {/* FIX B: use fine-grained hook variable — no full-store re-render */}
                <span className="font-semibold text-gray-700">{fmt(subtotal)}</span>
              </div>
              {discountTotal > 0 && (
                <div className="flex justify-between text-xs text-emerald-600">
                  <span className="font-medium">Discount</span>
                  <span className="font-semibold">−{fmt(discountTotal)}</span>
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
                variant="mango"
                size="md"
                fullWidth
                onClick={() => setShowCheckout(true)}
                disabled={cart.cart.items.length === 0}
                title="Proceed to payment (Ctrl+Enter)"
              >
                <Receipt size={15} />
                Pay {itemCount > 0 && `· ${itemCount}`}
              </Btn>
            </div>

            {shift && (
              <button onClick={() => setShowShift(true)}
                className="w-full mt-2 text-xs text-gray-400 hover:text-gray-600 transition-colors font-medium text-center
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 rounded-lg py-1">
                Shift actions ›
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Mobile bottom tab bar ── */}
      <div className="md:hidden flex border-t border-gray-200 bg-white shrink-0" role="tablist">
        <button
          role="tab" aria-selected={mobileTab === 'menu'}
          onClick={() => setMobileTab('menu')}
          className={clsx(
            'flex-1 flex flex-col items-center py-2.5 text-xs font-700 gap-1 transition-colors',
            mobileTab === 'menu' ? 'text-amber-700' : 'text-gray-400'
          )}
          style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
          <div className={clsx('w-8 h-8 rounded-xl flex items-center justify-center transition-colors', mobileTab === 'menu' ? 'text-amber-700' : 'text-gray-400')}
            style={mobileTab === 'menu' ? { backgroundColor: 'var(--mango-yellow-lt)' } : {}}>
            <Coffee size={17} />
          </div>
          Menu
        </button>
        <button
          role="tab" aria-selected={mobileTab === 'cart'}
          onClick={() => setMobileTab('cart')}
          className={clsx(
            'flex-1 flex flex-col items-center py-2.5 text-xs font-700 gap-1 transition-colors relative',
            mobileTab === 'cart' ? 'text-amber-700' : 'text-gray-400'
          )}
          style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
          <div className={clsx('w-8 h-8 rounded-xl flex items-center justify-center transition-colors relative', mobileTab === 'cart' ? 'text-amber-700' : 'text-gray-400')}
            style={mobileTab === 'cart' ? { backgroundColor: 'var(--mango-yellow-lt)' } : {}}>
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
        <button
          role="tab" aria-selected={false}
          onClick={() => setShowHeld(true)}
          className="flex-1 flex flex-col items-center py-2.5 text-xs font-700 gap-1 transition-colors relative text-gray-400"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
          <div className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors relative text-gray-400">
            <Receipt size={17} />
            {heldCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-white flex items-center justify-center font-800"
                style={{ backgroundColor: 'var(--warrior-red)', fontSize: '9px', fontFamily: 'var(--font-display)', fontWeight: 800 }}>
                {heldCount}
              </span>
            )}
          </div>
          Parked
        </button>
      </div>

      <ConfirmDialog
        open={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={() => cart.clearCart()}
        title="Clear Cart"
        message={`Remove all ${itemCount} item(s) from the cart?`}
        confirmLabel="Clear Cart"
        variant="danger"
      />

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
        {addonPickerFor && (
    <CartAddonPickerModal
      cartKey={addonPickerFor.cartKey}
      currentAddons={addonPickerFor.currentAddons}
      allAddons={allAddons}
      onClose={() => setAddonPickerFor(null)}
    />
  )}
    </div>
  );
}

// ─── Cart Item Row — memoized, isolated from menu re-renders ──
const CartItemRow = memo(function CartItemRow({
  item,
  allAddons,
  onOpenAddonPicker,
}: {
  item: CartItem;
  allAddons: Addon[];
  onOpenAddonPicker: (cartKey: string, currentAddons: CartAddon[]) => void;
}) {
  // FIX: Select only the three action functions from the cart store.
  // CartItemRow is memo'd and never reads cart STATE — it only calls actions.
  // Subscribing to the full store caused every CartItemRow to re-render on
  // every cart mutation (qty change, discount toggle, note edit) even when
  // the row's own item data hadn't changed.
  // Zustand action functions are stable references (created once), so this
  // selector never triggers a re-render on its own.
  const removeItem   = useCartStore(s => s.removeItem);
  const updateQty    = useCartStore(s => s.updateQty);
  const setDiscount  = useCartStore(s => s.setDiscount);

  // FIX C: accentColors moved to module-level CART_ACCENT_COLORS constant
  // (no longer allocated on every render). useMemo dependency is now stable.
  const accentColor = useMemo(() => {
    const idx = item.item_id.charCodeAt(0) % CART_ACCENT_COLORS.length;
    return CART_ACCENT_COLORS[idx] ?? '#F59E0B';
  }, [item.item_id]);

  const handleRemove    = useCallback(() => removeItem(item.cart_key), [removeItem, item.cart_key]);
  const handleQtyMinus  = useCallback(() => updateQty(item.cart_key, -1), [updateQty, item.cart_key]);
  const handleQtyPlus   = useCallback(() => updateQty(item.cart_key, 1),  [updateQty, item.cart_key]);
  const handleScToggle  = useCallback(() => setDiscount(item.cart_key, item.discount_type === 'sc'  ? null : 'sc'),  [setDiscount, item.cart_key, item.discount_type]);
  const handlePwdToggle = useCallback(() => setDiscount(item.cart_key, item.discount_type === 'pwd' ? null : 'pwd'), [setDiscount, item.cart_key, item.discount_type]);
  const handleAddonTap  = useCallback(() => onOpenAddonPicker(item.cart_key, item.addons), [onOpenAddonPicker, item.cart_key, item.addons]);
 
  return (
    <article className="cart-item-row rounded-2xl overflow-hidden border border-gray-200 bg-white shadow-sm" aria-label={`${item.item_name} in cart`}>
      <span className="block h-0.5 w-full" style={{ backgroundColor: accentColor }} />
 
      <div className="flex items-start justify-between gap-1.5 px-3 pt-2.5 pb-1">
        <span className="text-sm font-700 text-gray-900 leading-snug flex-1 min-w-0 truncate" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
          {item.item_name}
        </span>
        {item.size_name && (
          <span className="text-xs px-2 py-0.5 rounded-full font-600 border shrink-0"
            style={{ backgroundColor: '#F0F9FF', color: '#0277BD', borderColor: '#BAE6FD', fontWeight: 600 }}>
            {item.size_name}
          </span>
        )}
        <div className="text-right shrink-0">
          <span className="text-sm font-800 text-amber-900 block" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>
            {fmt(item.line_total)}
          </span>
          {item.discount_amount > 0 && (
            <div className="text-xs text-emerald-600 font-semibold">−{fmt(item.discount_amount)}</div>
          )}
        </div>
      </div>
 
      <div className="flex items-center gap-2 px-3 py-1.5">
        <div className="flex items-center gap-1 bg-gray-50 rounded-xl border border-gray-200 p-0.5">
          <button onClick={handleQtyMinus} aria-label={`Decrease quantity of ${item.item_name}`}
            className="w-7 h-7 rounded-lg hover:bg-red-50 hover:text-red-500 flex items-center justify-center text-gray-500 transition-colors">
            <Minus size={11} />
          </button>
          <span className="w-7 text-center text-sm font-800 text-gray-900" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}
            aria-live="polite">
            {item.qty}
          </span>
          <button onClick={handleQtyPlus} aria-label={`Increase quantity of ${item.item_name}`}
            className="w-7 h-7 rounded-lg hover:bg-green-50 hover:text-green-600 flex items-center justify-center text-gray-500 transition-colors">
            <Plus size={11} />
          </button>
        </div>
 
        <button
          onClick={handleAddonTap}
          className="flex-1 flex items-center gap-1.5 text-xs font-600 transition-colors px-2.5 py-1.5 rounded-xl
            hover:bg-emerald-50 border border-dashed border-gray-200 hover:border-emerald-300 min-w-0"
          style={{ color: item.addons.length > 0 ? 'var(--leaf-green)' : '#9CA3AF', fontWeight: 600 }}
          aria-label={`${item.addons.length > 0 ? 'Edit add-ons' : 'Add add-ons'} for ${item.item_name}`}>
          <Plus size={11} className="shrink-0" />
          {item.addons.length > 0
            ? <span className="truncate">{item.addons.map(a => a.addon_name).join(', ')}</span>
            : <span className="text-gray-400">Add-ons</span>
          }
          {item.addons.length > 0 && (
            <span className="ml-auto font-700 text-emerald-700 shrink-0 text-xs" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
              +{fmt(item.addons.reduce((s, a) => s + a.addon_price * a.qty, 0))}
            </span>
          )}
        </button>
 
        <button onClick={handleRemove} aria-label={`Remove ${item.item_name}`}
          className="w-7 h-7 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors shrink-0">
          <X size={13} />
        </button>
      </div>
 
      <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
        <span className="text-xs text-gray-400 font-medium">Discount:</span>
        <button
          onClick={handleScToggle}
          aria-pressed={item.discount_type === 'sc'}
          className={`discount-btn discount-btn-sc ${item.discount_type === 'sc' ? 'active' : ''}`}>
          SC
        </button>
        <button
          onClick={handlePwdToggle}
          aria-pressed={item.discount_type === 'pwd'}
          className={`discount-btn discount-btn-pwd ${item.discount_type === 'pwd' ? 'active' : ''}`}>
          PWD
        </button>
        {item.discount_type && (
          <span className="ml-auto text-xs font-semibold text-emerald-600">
            −{fmt(item.discount_amount)}
          </span>
        )}
      </div>
      {/* CartAddonPickerModal is NO LONGER rendered here — it's in POSPage */}
    </article>
  );
});

// ─── Size Picker Modal ────────────────────────────────────────
function SizePickerModal({
  item, onClose, onAdd,
}: {
  item: MenuItem; onClose: () => void;
  onAdd: (item: MenuItem, sizeName?: string, sizePrice?: number, addons?: Addon[]) => void;
}) {
  const [selectedSize, setSelectedSize] = useState(item.sizes[0]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const idx = item.sizes.findIndex(s => s.id === selectedSize?.id);
      if (e.key === 'ArrowDown' && idx < item.sizes.length - 1) setSelectedSize(item.sizes[idx + 1]);
      if (e.key === 'ArrowUp' && idx > 0) setSelectedSize(item.sizes[idx - 1]);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedSize, item.sizes]);

  return (
    <Modal open onClose={onClose} title={item.name} maxWidth="max-w-sm">
      <div className="flex flex-col gap-4">
        {item.sizes.length > 0 && (
          <div>
            <p className="text-xs font-800 text-gray-500 uppercase tracking-widest mb-3"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>
              Choose Size
            </p>
            <div className="flex flex-col gap-2" role="radiogroup">
              {item.sizes.map((s: ItemSize) => {
                const isActive = selectedSize?.id === s.id;
                return (
                  <button key={s.id} onClick={() => setSelectedSize(s)}
                    role="radio" aria-checked={isActive}
                    className="flex items-center justify-between px-4 py-3 rounded-2xl border-2 transition-colors duration-100 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
                    style={isActive
                      ? { borderColor: 'var(--mango-yellow)', backgroundColor: 'var(--mango-yellow-xl)', color: '#78350f' }
                      : { borderColor: '#E4E4E7', backgroundColor: '#fff', color: '#3F3F46' }}>
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors"
                        style={isActive ? { borderColor: 'var(--mango-yellow)', backgroundColor: 'var(--mango-yellow)' } : { borderColor: '#D1D1D6' }}>
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

        <div className="flex items-center justify-between py-3.5 px-4 rounded-2xl border"
          style={{ backgroundColor: 'var(--mango-yellow-xl)', borderColor: '#FDE68A' }}>
          <span className="text-sm font-600 text-amber-800">Item Total</span>
          <span className="font-900 text-2xl text-amber-900" style={{ fontFamily: 'var(--font-display)', fontWeight: 900 }}>
            {fmt(selectedSize?.price ?? 0)}
          </span>
        </div>

        <Btn variant="mango" fullWidth size="lg"
          onClick={() => onAdd(item, selectedSize?.name, selectedSize?.price, [])}>
          <Plus size={16} /> Add to Order
        </Btn>
      </div>
    </Modal>
  );
}

// ─── Checkout Modal ────────────────────────────────────────────
function CheckoutModal({ shift, onClose, onSuccess }: {
  shift: Shift | null | undefined; onClose: () => void; onSuccess: () => void;
}) {
  const { user } = useAuthStore();
  // FIX: Replace full useCartStore() with targeted selectors.
  // cart.total() called on the full store caused this modal to re-render on
  // every cart mutation. useCartTotal() subscribes only to the computed total
  // value and re-renders only when it actually changes.
  const cartItems        = useCartStore(s => s.cart.items);
  const cartNote         = useCartStore(s => s.cart.note);
  const cartIdempotency  = useCartStore(s => s.cart.idempotency_key);
  const discountTotal    = useCartDiscountTotal();
  const cartSubtotal     = useCartSubtotal();
  const cartClearCart    = useCartStore(s => s.clearCart);
  const checkout         = useCheckout();
  const { data: settings } = useSettings();
  const total            = useCartTotal();
  const [payments, setPayments] = useState<PaymentLine[]>([{ method: 'cash', amount: total }]);
  const [tendered, setTendered] = useState('');
  const [step, setStep] = useState<'payment' | 'success'>('payment');
  const [result, setResult] = useState<{ receipt_number: string; change: number } | null>(null);
  const [receiptData, setReceiptData] = useState<SaleDetail | null>(null);
  const [orderType, setOrderType] = useState<'dine_in' | 'take_out'>('dine_in');

  const paymentTotal = useMemo(() => payments.reduce((s, p) => s + (p.amount || 0), 0), [payments]);
  const hasCash = useMemo(() => payments.some(p => p.method === 'cash'), [payments]);
  const cashPaymentTotal = useMemo(() => payments.filter(p => p.method === 'cash').reduce((s, p) => s + p.amount, 0), [payments]);
  const tenderedNum = parseFloat(tendered) || 0;
  const change = hasCash && tenderedNum > 0 ? Math.max(0, tenderedNum - total) : 0;
  const balanced = Math.abs(paymentTotal - total) < 0.01;
  const tenderedOk = !hasCash || (!!tendered && tenderedNum >= cashPaymentTotal);

  const addPaymentLine = useCallback(() => {
    const used: PaymentMethod[] = payments.map(p => p.method);
    const next = (['cash', 'gcash', 'maya'] as PaymentMethod[]).find(m => !used.includes(m));
    if (!next) return;
    setPayments(prev => [...prev, { method: next, amount: 0 }]);
  }, [payments]);

  const updatePayment = useCallback((idx: number, field: 'method' | 'amount', val: string) => {
    setPayments(prev => prev.map((p, i) => i === idx ? {
      ...p, [field]: field === 'amount' ? parseFloat(val) || 0 : val,
    } : p));
  }, []);

  const doCheckout = useCallback(async () => {
    if (!user) return;
    try {
      const res = await checkout.mutateAsync({
        idempotency_key: cartIdempotency,
        shift_id: shift?.id,
        order_type: orderType,
        note: cartNote || undefined,
        tendered_amount: hasCash && tendered ? tenderedNum : undefined,
        actioned_by_user_id: user.id,
        actioned_by_name: user.name,
        items: cartItems.map((i: CartItem) => ({
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
        order_type: orderType,
        status: 'completed', sale_type: 'normal',
        total: res.total, discount_total: discountTotal, subtotal: cartSubtotal,
        created_at: new Date().toISOString(), is_reprinted: false,
        shift_id: shift?.id ?? null, note: cartNote || null,
        tendered_amount: hasCash && tendered ? tenderedNum : null,
        change_amount: res.change,
        items: cartItems.map((i: CartItem) => ({
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
  }, [user, cartItems, cartNote, cartIdempotency, discountTotal, cartSubtotal,
      checkout, shift, orderType, hasCash, tendered, tenderedNum, payments]);

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
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4"
              style={{ backgroundColor: '#D1FAE5' }}>
              <span className="text-4xl">✓</span>
            </div>
            <div>
              <p className="text-xs font-800 text-gray-500 uppercase tracking-widest mb-2.5"
                style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>Order Type</p>
              <div className="flex gap-2">
                {(['dine_in', 'take_out'] as const).map(type => (
                  <button key={type} type="button" onClick={() => setOrderType(type)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-700 border transition-colors"
                    style={{
                      fontWeight: 700,
                      backgroundColor: orderType === type ? 'var(--mango-yellow)' : '#fff',
                      color: orderType === type ? '#78350f' : '#52525B',
                      borderColor: orderType === type ? 'var(--mango-yellow)' : '#E4E4E7',
                    }}>
                    {type === 'dine_in' ? '🍽 Dine In' : '🥡 Take Out'}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-gray-500 text-sm font-medium mb-1">Receipt</p>
            <div className="text-gray-900 font-900 text-2xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 900 }}>
              {result.receipt_number}
            </div>
            {hasCash && result.change > 0 && (
              <div className="mt-4 p-4 rounded-2xl border"
                style={{ backgroundColor: 'var(--mango-yellow-xl)', borderColor: '#FDE68A' }}>
                <div className="text-amber-600 text-xs font-700 uppercase tracking-wide mb-1">Change Due</div>
                <div className="font-900 text-4xl text-amber-900" style={{ fontFamily: 'var(--font-display)', fontWeight: 900 }}>
                  {fmt(result.change)}
                </div>
              </div>
            )}
          </div>
          {receiptData && settings && (
            <div className="border border-gray-200 rounded-2xl overflow-hidden max-h-64 overflow-y-auto bg-gray-50 scrollable">
              <SaleReceipt sale={receiptData} settings={settings} />
            </div>
          )}
          <div className="flex gap-3">
            <Btn variant="secondary" onClick={() => receiptData && settings && printReceipt(receiptData, settings)} className="flex-1">
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
            {discountTotal > 0 && (
              <div className="flex justify-between text-xs text-emerald-700 mt-1 font-semibold">
                <span>Discount applied</span><span>−{fmt(discountTotal)}</span>
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-800 text-gray-500 uppercase tracking-widest mb-2.5"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>Order Type</p>
            <div className="flex gap-2 mb-4">
              {(['dine_in', 'take_out'] as const).map(type => (
                <button key={type} type="button" onClick={() => setOrderType(type)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-700 border transition-colors"
                  style={{
                    fontWeight: 700,
                    backgroundColor: orderType === type ? 'var(--mango-yellow)' : '#fff',
                    color: orderType === type ? '#78350f' : '#52525B',
                    borderColor: orderType === type ? 'var(--mango-yellow)' : '#E4E4E7',
                  }}>
                  {type === 'dine_in' ? '🍽 Dine In' : '🥡 Take Out'}
                </button>
              ))}
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
                      aria-label="Remove payment line"
                      className="text-gray-300 hover:text-red-500 p-2 transition-colors mt-0.5 rounded-lg hover:bg-red-50">
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
                <div className="flex items-center gap-2 text-red-600 text-xs mt-2 px-3 py-2 rounded-xl bg-red-50 border border-red-100 font-medium" role="alert">
                  <AlertTriangle size={12} /> Amount is less than cash total ({fmt(cashPaymentTotal)})
                </div>
              )}
              <div className="flex gap-1.5 mt-2.5 flex-wrap" role="group" aria-label="Quick tender amounts">
                {[total, Math.ceil(total / 50) * 50, Math.ceil(total / 100) * 100, Math.ceil(total / 500) * 500]
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .map(v => (
                    <button key={v} onClick={() => setTendered(v.toString())}
                      aria-pressed={tendered === v.toString()}
                      className="px-3 py-1.5 rounded-xl text-xs font-700 transition-colors duration-75 border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
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
            <div className="flex items-center justify-between text-sm p-3.5 rounded-2xl border border-red-100 bg-red-50" role="alert">
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
            <Btn variant="mango" size="lg" onClick={doCheckout}
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

// ─── Held Orders Modal ─────────────────────────────────────────
function HeldOrdersModal({ onClose, onRestore }: { onClose: () => void; onRestore: () => void }) {
  const { data: heldOrders, isLoading } = useHeldOrders();
  const createHeld = useCreateHeldOrder();
  const deleteHeld = useDeleteHeldOrder();
  // FIX: Replace full useCartStore() with fine-grained selectors.
  // The full subscription caused this modal to re-render on every cart mutation
  // (qty change, discount toggle) even though it only needs:
  //   - isEmpty: to show/hide the "Park current order" button
  //   - itemCount + total: for the display label
  //   - clearCart + loadFromHeld: action calls (stable references)
  //   - cart state snapshot: only at the moment the user taps "Park"
  const cartIsEmpty    = useCartIsEmpty();
  const cartItemCount  = useCartItemCount();
  const cartTotal      = useCartTotal();
  const clearCart      = useCartStore(s => s.clearCart);
  const loadFromHeld   = useCartStore(s => s.loadFromHeld);
  const getCartState   = () => useCartStore.getState().cart; // snapshot at park-time, not reactive
  const [label, setLabel] = useState('');
  const [showHoldForm, setShowHoldForm] = useState(false);

  const handleHold = async () => {
    if (cartIsEmpty) return;
    const cartSnapshot = useCartStore.getState().cart;
    await createHeld.mutateAsync({ data: cartSnapshot, label: label || undefined });
    clearCart();
    toast('Order parked');
    onClose();
  };

  const handleRestore = useCallback((order: HeldOrder) => {
    loadFromHeld(order.data);
    deleteHeld.mutate(order.id);
    onRestore();
    toast('Order restored');
  }, [loadFromHeld, deleteHeld, onRestore]);

  return (
    <Modal open onClose={onClose} title="📋 Parked Orders" maxWidth="max-w-md">
      <div className="flex flex-col gap-4">
        {!cartIsEmpty && (
          <div>
            {!showHoldForm ? (
              <button
                onClick={() => setShowHoldForm(true)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-2xl border-2 border-dashed border-amber-300 hover:bg-yellow-50 transition-colors text-left"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--mango-yellow)' }}>
                    <Plus size={15} className="text-amber-900" />
                  </div>
                  <div>
                    <div className="text-sm font-700 text-gray-800" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                      Park current order
                    </div>
                    <div className="text-xs text-gray-400">{cartItemCount} items · {fmt(cartTotal)}</div>
                  </div>
                </div>
                <ChevronRight size={15} className="text-gray-400" />
              </button>
            ) : (
              <div className="rounded-2xl p-4 border border-amber-200" style={{ backgroundColor: 'var(--mango-yellow-xl)' }}>
                <p className="text-sm text-amber-900 mb-3 font-700" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                  Parking {cartItemCount} items · {fmt(cartTotal)}
                </p>
                <div className="flex gap-2">
                  <Input value={label} onChange={setLabel} placeholder="Label (optional)" className="flex-1" />
                  <Btn variant="mango" onClick={handleHold} loading={createHeld.isPending}>Park</Btn>
                  <Btn variant="ghost" onClick={() => setShowHoldForm(false)}>
                    <X size={14} />
                  </Btn>
                </div>
              </div>
            )}
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-700 text-gray-500 uppercase tracking-widest" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
              Parked orders
            </p>
            <p className="text-xs text-gray-400 font-medium">Expire in 1 hour</p>
          </div>
          {isLoading ? (
            <div className="flex justify-center py-6"><RefreshCw className="animate-spin text-gray-300" /></div>
          ) : !heldOrders?.length ? (
            <div className="text-center text-gray-400 py-10 text-sm">
              <Receipt size={32} className="mx-auto mb-3 opacity-30" />
              No parked orders
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {heldOrders.map((order: HeldOrder) => (
                <div key={order.id}
                  className="flex items-center justify-between bg-white border border-gray-200 rounded-2xl px-4 py-3.5 shadow-sm hover:border-yellow-300 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                      style={{ backgroundColor: 'var(--mango-yellow-lt)' }}>
                      <Receipt size={16} className="text-amber-700" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-gray-900 text-sm font-700 truncate" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                        {order.label ?? 'Unnamed Order'}
                      </div>
                      <div className="text-gray-500 text-xs mt-0.5">
                        {order.data.items.length} items · {fmt(order.data.items.reduce((s, i) => s + i.line_total, 0))}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0 ml-2">
                    <Btn size="sm" variant="mango" onClick={() => handleRestore(order)}>Restore</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => deleteHeld.mutate(order.id)} title="Delete">
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
  const openShift = useOpenShift();
  const closeShift = useCloseShift();
  const cashDrop = useCashDrop();

  const [startFloat, setStartFloat] = useState('0');
  const [closingCash, setClosingCash] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [dropAmount, setDropAmount] = useState('');
  const [dropReason, setDropReason] = useState('');
  const [tab, setTab] = useState<'overview' | 'close' | 'drop'>('overview');

  const [showAnyPin, setShowAnyPin] = useState(false);
  const [pendingAction, setPendingAction] = useState<'open' | 'close' | 'drop' | null>(null);

  const triggerAction = useCallback((action: 'open' | 'close' | 'drop') => {
    setPendingAction(action);
    setShowAnyPin(true);
  }, []);

  const executeAction = useCallback(async (actioner: { user_id: string; user_name: string; role: string }) => {
    setShowAnyPin(false);
    if (pendingAction === 'open') {
      await openShift.mutateAsync({ starting_float: parseFloat(startFloat) || 0 });
      toast('Shift opened');
      onClose();
    } else if (pendingAction === 'close' && shift) {
      await closeShift.mutateAsync({ id: shift.id, closing_cash: parseFloat(closingCash) || 0, notes: closeNotes });
      toast('Shift closed');
      onClose();
    } else if (pendingAction === 'drop' && shift && dropReason) {
      await cashDrop.mutateAsync({ shift_id: shift.id, amount: parseFloat(dropAmount) || 0, reason: dropReason });
      toast('Cash drop recorded');
      setDropAmount(''); setDropReason('');
      onClose();
    }
    setPendingAction(null);
  }, [pendingAction, openShift, closeShift, cashDrop, shift, startFloat, closingCash, closeNotes, dropAmount, dropReason, onClose]);

  if (!shift) {
    return (
      <>
        <Modal open onClose={onClose} title="🔓 Open Shift">
          <div className="flex flex-col gap-5">
            <p className="text-gray-500 text-sm">Enter the starting cash float for this shift.</p>
            <Input label="Starting Float (₱)" type="number" value={startFloat} min={0} step={0.01} onChange={setStartFloat} />
            <div className="flex gap-2">
              <Btn variant="secondary" onClick={onClose} className="flex-1">Cancel</Btn>
              <Btn variant="mango" size="lg" onClick={() => triggerAction('open')} loading={openShift.isPending} className="flex-1">Open Shift</Btn>
            </div>
          </div>
        </Modal>
        <AnyUserPinModal
          open={showAnyPin}
          onClose={() => { setShowAnyPin(false); setPendingAction(null); }}
          onSuccess={executeAction}
          title="🔒 Open Shift"
          description="Enter your PIN to open the shift."
        />
      </>
    );
  }

  const cashTotal = shift.payment_totals?.cash ?? 0;
  const expectedCash = (shift.starting_float ?? 0) + cashTotal - (shift.cash_drops ?? []).reduce((s, d: CashDrop) => s + d.amount, 0);
  const variance = parseFloat(closingCash || '0') - expectedCash;

  return (
    <>
      <Modal open onClose={onClose} title="📊 Shift Management" maxWidth="max-w-md">
        <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-xl" role="tablist">
          {(['overview', 'drop', 'close'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              role="tab" aria-selected={tab === t}
              className={clsx('flex-1 py-2 rounded-xl text-xs font-700 capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400',
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
              <Btn variant="warrior" onClick={() => triggerAction('drop')} loading={cashDrop.isPending}
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
              <Btn variant="danger" size="lg" onClick={() => triggerAction('close')} loading={closeShift.isPending}
                disabled={!closingCash} className="flex-1">Close Shift</Btn>
            </div>
          </div>
        )}
      </Modal>

      <AnyUserPinModal
        open={showAnyPin}
        onClose={() => { setShowAnyPin(false); setPendingAction(null); }}
        onSuccess={executeAction}
        title={pendingAction === 'close' ? '🔒 Close Shift' : pendingAction === 'drop' ? '🔒 Cash Drop' : '🔒 Shift Action'}
        description="Enter your PIN to authorize this action."
      />
    </>
  );
}

const StatCard = memo(function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl p-3.5 border"
      style={accent
        ? { backgroundColor: 'var(--mango-yellow-xl)', borderColor: '#FDE68A' }
        : { backgroundColor: '#FAFAF9', borderColor: '#E4E4E7' }}>
      <div className="text-xs text-gray-500 font-600 mb-1.5" style={{ fontWeight: 600 }}>{label}</div>
      <div className="font-900 text-xl text-gray-900" style={{ fontFamily: 'var(--font-display)', fontWeight: 900 }}>{value}</div>
    </div>
  );
});

// ─── Partial Void / Refund Modal ──────────────────────────────
function PartialActionModal({
  sale, action, onClose, onDone,
}: {
  sale: SaleDetail; action: 'void' | 'refund'; onClose: () => void; onDone: () => void;
}) {
  const voidSale = useVoidSale();
  const refundSale = useRefundSale();
  const [mode, setMode] = useState<'entire' | 'items'>('entire');
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAnyPin, setShowAnyPin] = useState(false);

  const toggleItem = useCallback((idx: number) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }, []);

  const selectedTotal = useMemo(() => mode === 'entire'
    ? sale.total
    : Array.from(selectedItems).reduce((s, i) => s + (sale.items[i]?.final_price ?? 0), 0),
  [mode, selectedItems, sale]);

  const canConfirm = reason.trim() && (mode === 'entire' || selectedItems.size > 0);

  const handleConfirm = useCallback(async (actioner: { user_id: string; user_name: string; role: string }) => {
    setShowAnyPin(false);
    setLoading(true);
    try {
      const payload = {
        id: sale.id, reason,
        actioned_by_user_id: actioner.user_id,
        actioned_by_name: actioner.user_name,
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
  }, [sale, reason, mode, selectedItems, action, voidSale, refundSale, onDone]);

  const actionLabel = action === 'void' ? 'Void' : 'Refund';

  return (
    <>
      <Modal open onClose={onClose} title={`${actionLabel} Sale — ${sale.receipt_number}`} maxWidth="max-w-lg">
        <div className="flex flex-col gap-5">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl" role="tablist">
            <button onClick={() => setMode('entire')}
              role="tab" aria-selected={mode === 'entire'}
              className={clsx('flex-1 py-2 rounded-xl text-sm font-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400',
                mode === 'entire' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              )}
              style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
              {actionLabel} Entire Sale
            </button>
            <button onClick={() => setMode('items')}
              role="tab" aria-selected={mode === 'items'}
              className={clsx('flex-1 py-2 rounded-xl text-sm font-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400',
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
                    className="text-xs text-sky-500 hover:text-sky-700 font-700 rounded px-1" style={{ fontWeight: 700 }}>All</button>
                  <button onClick={() => setSelectedItems(new Set())}
                    className="text-xs text-gray-400 hover:text-gray-600 font-700 rounded px-1" style={{ fontWeight: 700 }}>None</button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto scrollable border border-gray-200 rounded-2xl p-2">
                {sale.items.map((item, idx) => {
                  const isSelected = selectedItems.has(idx);
                  return (
                    <button key={idx} onClick={() => toggleItem(idx)}
                      aria-pressed={isSelected}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                      style={isSelected
                        ? { borderColor: '#FCA5A5', backgroundColor: '#FFF1F2' }
                        : { borderColor: '#E4E4E7', backgroundColor: '#fff' }}>
                      <div className="w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors"
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
            <Btn variant="danger" size="lg" onClick={() => setShowAnyPin(true)} loading={loading} disabled={!canConfirm} className="flex-1">
              Confirm {actionLabel}
            </Btn>
          </div>
        </div>
      </Modal>

      <AnyUserPinModal
        open={showAnyPin}
        onClose={() => setShowAnyPin(false)}
        onSuccess={handleConfirm}
        title={`🔒 Authorize ${actionLabel}`}
        description={`Enter your PIN to ${action} this sale. This will be logged with your name.`}
      />
    </>
  );
}

// ─── Edit Sale Modal ──────────────────────────────────────────
function EditSaleModal({ sale, onClose, onDone }: { sale: SaleDetail; onClose: () => void; onDone: () => void }) {
  const editSale = useEditSale();
  const [note, setNote] = useState(sale.note ?? '');
  const [payments, setPayments] = useState<PaymentLine[]>(sale.payments.map(p => ({ ...p })));
  const [tendered, setTendered] = useState(sale.tendered_amount != null ? String(sale.tendered_amount) : '');
  const [loading, setLoading] = useState(false);
  const [showAnyPin, setShowAnyPin] = useState(false);

  const paymentTotal = useMemo(() => payments.reduce((s, p) => s + (p.amount || 0), 0), [payments]);
  const balanced = Math.abs(paymentTotal - sale.total) < 0.01;
  const hasCash = useMemo(() => payments.some(p => p.method === 'cash'), [payments]);

  const updatePayment = useCallback((idx: number, field: 'method' | 'amount', val: string) => {
    setPayments(prev => prev.map((p, i) => i === idx ? { ...p, [field]: field === 'amount' ? parseFloat(val) || 0 : val } : p));
  }, []);

  const addPaymentLine = useCallback(() => {
    const used = payments.map(p => p.method);
    const next = (['cash', 'gcash', 'maya'] as PaymentMethod[]).find(m => !used.includes(m));
    if (!next) return;
    setPayments(prev => [...prev, { method: next, amount: 0 }]);
  }, [payments]);

  const handleSave = useCallback(async (actioner: { user_id: string; user_name: string; role: string }) => {
    setShowAnyPin(false);
    setLoading(true);
    try {
      await editSale.mutateAsync({
        id: sale.id,
        note: note || undefined,
        payments,
        tendered_amount: tendered ? parseFloat(tendered) : undefined,
      });
      toast('Sale updated');
      onDone();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Update failed', 'error');
    } finally {
      setLoading(false);
    }
  }, [editSale, sale.id, note, payments, tendered, onDone]);

  return (
    <>
      <Modal open onClose={onClose} title={`✏️ Edit Sale — ${sale.receipt_number}`} maxWidth="max-w-md">
        <div className="flex flex-col gap-5">
          <div className="rounded-2xl border border-gray-200 p-3.5 bg-gray-50">
            <p className="text-xs font-800 text-gray-500 uppercase tracking-widest mb-2.5"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>Items (read-only)</p>
            <div className="space-y-1.5">
              {sale.items.map((item, i) => (
                <div key={i} className="flex justify-between text-sm text-gray-700">
                  <span>{item.qty}x {item.item_name}{item.size_name ? ` (${item.size_name})` : ''}</span>
                  <span className="font-600" style={{ fontWeight: 600 }}>{fmt(item.final_price)}</span>
                </div>
              ))}
              <div className="flex justify-between font-800 text-amber-900 pt-2 border-t border-gray-200"
                style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>
                <span>Total</span><span>{fmt(sale.total)}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-700 text-gray-500 uppercase tracking-widest"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '0.08em' }}>
              Note
            </label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="Order note…"
              className="bg-white border border-gray-200 text-gray-900 rounded-xl px-3.5 py-2.5 text-sm w-full
                focus:outline-none focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/20
                resize-none font-medium transition-colors" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-xs font-800 text-gray-500 uppercase tracking-widest"
                style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>Payment Method</p>
              {payments.length < 3 && (
                <Btn size="sm" variant="ghost" onClick={addPaymentLine}>
                  <Plus size={12} /> Add
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
                      className="text-gray-300 hover:text-red-500 p-2 transition-colors mt-0.5 rounded-lg hover:bg-red-50">
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {!balanced && (
              <div className="flex items-center gap-2 text-red-600 text-xs mt-2 px-3 py-2 rounded-xl bg-red-50 border border-red-100 font-medium" role="alert">
                <AlertTriangle size={12} /> Payment total ({fmt(paymentTotal)}) doesn't match sale total ({fmt(sale.total)})
              </div>
            )}
          </div>

          {hasCash && (
            <Input label="Cash Tendered (₱)" type="number" value={tendered} min={0} step={0.01}
              onChange={setTendered} placeholder="Amount given by customer" />
          )}

          <div className="flex gap-2">
            <Btn variant="secondary" onClick={onClose} className="flex-1">Cancel</Btn>
            <Btn variant="mango" size="lg" onClick={() => setShowAnyPin(true)}
              disabled={!balanced} loading={loading} className="flex-[2]">
              <Save size={14} /> Save Changes
            </Btn>
          </div>
        </div>
      </Modal>

      <AnyUserPinModal
        open={showAnyPin}
        onClose={() => setShowAnyPin(false)}
        onSuccess={handleSave}
        title="🔒 Authorize Edit"
        description="Enter your PIN to save changes to this sale."
      />
    </>
  );
}

// ─── Sales Page ────────────────────────────────────────────────
function SalesPage() {
  const openPinModal = useUIStore(s => s.openPinModal);
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));
  const [statusFilter, setStatusFilter] = useState('');
  const [receiptQ, setReceiptQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionModal, setActionModal] = useState<{ type: 'void' | 'refund' } | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [showAnyPinForReprint, setShowAnyPinForReprint] = useState(false);
  const [showAnyPinForDelete, setShowAnyPinForDelete] = useState(false);

  const { data: sales, isLoading, refetch } = useSales({
    date_from: dateFrom, date_to: dateTo,
    status: statusFilter || undefined, receipt: receiptQ || undefined,
  });
  const { data: saleDetail } = useSaleDetail(selectedId);
  const { data: settings } = useSettings();
  const softDelete = useSoftDeleteSale();
  const reprint = useReprintSale();

  const handleReprint = useCallback(() => setShowAnyPinForReprint(true), []);

  const doReprint = useCallback(async (actioner: { user_id: string; user_name: string; role: string }) => {
    if (!saleDetail) return;
    setShowAnyPinForReprint(false);
    await reprint.mutateAsync({ id: saleDetail.id, actioned_by_user_id: actioner.user_id, actioned_by_name: actioner.user_name });
    toast('Reprint recorded');
    if (settings) {
      await printReceipt(saleDetail, settings);
    } else {
      toast('Printer settings not loaded yet — please try again in a moment.', 'error');
    }
  }, [saleDetail, reprint, settings]);

  const handleDeleteConfirm = useCallback(() => {
    if (!deleteReason) return;
    setDeleteModal(false);
    setShowAnyPinForDelete(true);
  }, [deleteReason]);

  const doDelete = useCallback(async (actioner: { user_id: string; user_name: string; role: string }) => {
    if (!saleDetail || !deleteReason) return;
    setShowAnyPinForDelete(false);
    try {
      await softDelete.mutateAsync({ id: saleDetail.id, reason: deleteReason });
      toast('Sale deleted');
      setDeleteReason(''); setSelectedId(null); refetch();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Delete failed', 'error');
    }
  }, [saleDetail, deleteReason, softDelete, refetch]);

  const statusColor = useCallback((s: string) =>
    // FIXED: explicit 'soft_deleted' mapping so the badge never renders the raw DB value
    s === 'completed' ? 'green' : s === 'voided' ? 'red' : s === 'refunded' ? 'yellow' : 'gray', []);

  const statusLabel = useCallback((s: string) =>
    s === 'completed' ? 'Completed' : s === 'voided' ? 'Voided' : s === 'refunded' ? 'Refunded' : s === 'soft_deleted' ? 'Deleted' : s, []);

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
          <div className="flex-1 overflow-y-auto scrollable">
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
                    aria-pressed={selectedId === sale.id}
                    className={clsx(
                      // cv-row: content-visibility:auto — browser skips paint/layout for off-screen rows.
                      // Defined in index.css. On a busy day with 100+ transactions this cuts the
                      // initial render cost of the list to only the ~10 visible rows.
                      'cv-row w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-gray-50',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-inset',
                      selectedId === sale.id && 'border-l-[3px]'
                    )}
                    style={selectedId === sale.id ? { borderLeftColor: 'var(--mango-yellow)', backgroundColor: 'var(--mango-yellow-xl)' } : {}}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-gray-900 font-mono font-700 text-sm" style={{ fontWeight: 700 }}>{sale.receipt_number}</span>
                        <Badge color={statusColor(sale.status)}>{statusLabel(sale.status)}</Badge>
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
                <Btn size="sm" variant="secondary" onClick={handleReprint}>
                  <Printer size={12} /> Reprint
                </Btn>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4 scrollable">
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
              <div className="border-t border-gray-100 p-3 flex gap-2 shrink-0 flex-wrap">
                <Btn size="sm" variant="mango" className="flex-1" onClick={() => setShowEditModal(true)}>
                  <Edit2 size={12} /> Edit
                </Btn>
                <Btn size="sm" variant="secondary" className="flex-1" onClick={() => setActionModal({ type: 'void' })}>Void</Btn>
                <Btn size="sm" variant="secondary" className="flex-1" onClick={() => setActionModal({ type: 'refund' })}>Refund</Btn>
                <Btn size="sm" variant="danger" onClick={() => { setDeleteModal(true); setDeleteReason(''); }} title="Delete sale">
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

      {showEditModal && saleDetail && (
        <EditSaleModal
          sale={saleDetail}
          onClose={() => setShowEditModal(false)}
          onDone={() => { setShowEditModal(false); refetch(); }}
        />
      )}

      <Modal open={deleteModal} onClose={() => setDeleteModal(false)} title="Delete Sale">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-500">Please provide a reason for deletion.</p>
          <Input label="Reason" value={deleteReason} onChange={setDeleteReason} autoFocus />
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={() => setDeleteModal(false)} className="flex-1">Cancel</Btn>
            <Btn variant="danger" onClick={handleDeleteConfirm} disabled={!deleteReason} className="flex-1">Continue</Btn>
          </div>
        </div>
      </Modal>

      <AnyUserPinModal
        open={showAnyPinForReprint}
        onClose={() => setShowAnyPinForReprint(false)}
        onSuccess={doReprint}
        title="🔒 Authorize Reprint"
        description="Enter your PIN to authorize this reprint."
      />

      <AnyUserPinModal
        open={showAnyPinForDelete}
        onClose={() => setShowAnyPinForDelete(false)}
        onSuccess={doDelete}
        title="🔒 Authorize Delete"
        description="Enter your PIN to permanently delete this sale."
      />
    </div>
  );
}

// ─── Admin Employees Page ─────────────────────────────────────
function AdminEmployeesPage() {
  const { data: users, isLoading } = useUsers();
  const { data: usersList } = useUsersList();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const resetPin = useResetPin();
  const openPinModal = useUIStore(s => s.openPinModal);
  const { user: me } = useAuthStore();

  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', role: 'crew' as 'crew' | 'admin', pin: '' });
  const [pinReset, setPinReset] = useState<{ userId: string; newPin: string } | null>(null);
  const [pinConflictError, setPinConflictError] = useState('');
  const [resetPinConflictError, setResetPinConflictError] = useState('');

  const handleAddUser = async () => {
    if (!newUser.name || newUser.pin.length !== 6) return;
    const ok = await openPinModal({ required_role: 'admin' });
    if (!ok.verified) return;
    try {
      await createUser.mutateAsync(newUser);
      setNewUser({ name: '', role: 'crew', pin: '' });
      setShowAddUser(false);
      setPinConflictError('');
      toast('User created');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error creating user';
      if (msg.toLowerCase().includes('pin') || msg.toLowerCase().includes('duplicate')) {
        setPinConflictError('This PIN is already in use. Please choose a different PIN.');
      } else {
        toast(msg, 'error');
      }
    }
  };

  const handleResetPin = async () => {
    if (!pinReset || pinReset.newPin.length !== 6) return;
    const ok = await openPinModal({ required_role: 'admin' });
    if (!ok.verified) return;
    try {
      await resetPin.mutateAsync({ id: pinReset.userId, new_pin: pinReset.newPin });
      setPinReset(null);
      setResetPinConflictError('');
      toast('PIN reset successfully');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error resetting PIN';
      if (msg.toLowerCase().includes('pin') || msg.toLowerCase().includes('duplicate')) {
        setResetPinConflictError('This PIN is already in use. Please choose a different PIN.');
      } else {
        toast(msg, 'error');
      }
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--surface-page)' }}>
      <div className="px-4 py-3 bg-white border-b border-gray-150 shrink-0 flex items-center justify-between"
        style={{ boxShadow: '0 1px 0 rgba(0,0,0,0.04)' }}>
        <h2 className="text-sm font-800 text-gray-900" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>Staff Management</h2>
        <Btn size="sm" variant="mango" onClick={() => setShowAddUser(true)}><Plus size={14} /> Add Staff</Btn>
      </div>
      <div className="flex-1 overflow-y-auto p-4 scrollable">
        <div className="max-w-2xl mx-auto">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 shimmer rounded-2xl" />)}
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {users?.map((u: User) => (
                <div key={u.id}
                  className={clsx('bg-white border rounded-2xl px-4 py-4 flex items-center gap-3.5 shadow-sm',
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
                    <Btn size="sm" variant="ghost" onClick={() => { setPinReset({ userId: u.id, newPin: '' }); setResetPinConflictError(''); }} title={`Reset PIN for ${u.name}`}>
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

      <Modal open={showAddUser} onClose={() => { setShowAddUser(false); setPinConflictError(''); }} title="Add Staff Member">
        <div className="flex flex-col gap-4">
          <Input label="Full Name" value={newUser.name} onChange={v => setNewUser(p => ({ ...p, name: v }))} autoFocus />
          <Select label="Role" value={newUser.role} onChange={v => setNewUser(p => ({ ...p, role: v as 'crew' | 'admin' }))}
            options={[{ value: 'crew', label: 'Staff / Crew' }, { value: 'admin', label: 'Admin' }]} />
          <div>
            <Input label="6-Digit PIN" type="password" value={newUser.pin} maxLength={6} placeholder="Enter 6 digits"
              onChange={v => { setNewUser(p => ({ ...p, pin: v.replace(/\D/g, '').slice(0, 6) })); setPinConflictError(''); }} />
            {newUser.pin.length > 0 && newUser.pin.length < 6 && (
              <p className="text-xs text-amber-600 font-medium mt-1">{6 - newUser.pin.length} more digit(s) needed</p>
            )}
            {pinConflictError && (
              <div className="flex items-center gap-2 text-red-600 text-xs mt-2 px-3 py-2 rounded-xl bg-red-50 border border-red-100 font-medium">
                <AlertTriangle size={12} /> {pinConflictError}
              </div>
            )}
            <p className="text-xs text-gray-400 mt-1.5">PINs must be unique across all staff members.</p>
          </div>
          <Divider />
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={() => { setShowAddUser(false); setPinConflictError(''); }} className="flex-1">Cancel</Btn>
            <Btn variant="mango" onClick={handleAddUser} loading={createUser.isPending}
              disabled={!newUser.name || newUser.pin.length !== 6} className="flex-1">Create Staff</Btn>
          </div>
        </div>
      </Modal>

      <Modal open={!!pinReset} onClose={() => { setPinReset(null); setResetPinConflictError(''); }} title="Reset Staff PIN">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-500">Enter a new 6-digit PIN. Admin PIN will be required to confirm.</p>
          <div>
            <Input label="New 6-Digit PIN" type="password" value={pinReset?.newPin ?? ''} maxLength={6} placeholder="Enter 6 digits"
              onChange={v => { setPinReset(p => p ? { ...p, newPin: v.replace(/\D/g, '').slice(0, 6) } : null); setResetPinConflictError(''); }} />
            {pinReset?.newPin && pinReset.newPin.length < 6 && (
              <p className="text-xs text-amber-600 font-medium mt-1">{6 - pinReset.newPin.length} more digit(s) needed</p>
            )}
            {resetPinConflictError && (
              <div className="flex items-center gap-2 text-red-600 text-xs mt-2 px-3 py-2 rounded-xl bg-red-50 border border-red-100 font-medium">
                <AlertTriangle size={12} /> {resetPinConflictError}
              </div>
            )}
            <p className="text-xs text-gray-400 mt-1.5">PINs must be unique across all staff members.</p>
          </div>
          <Divider />
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={() => { setPinReset(null); setResetPinConflictError(''); }} className="flex-1">Cancel</Btn>
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
  const [savedPrinter, setSavedPrinter] = useState(getSavedPrinter);
  const [printerLoading, setPrinterLoading] = useState(false);

  useEffect(() => { if (settings) { setForm(settings); setDirty(false); } }, [settings]);

  const set = useCallback((key: string, val: string) => { setForm(p => ({ ...p, [key]: val })); setDirty(true); }, []);

  const handleSave = useCallback(async () => {
    await updateSettings.mutateAsync(form);
    setDirty(false);
    toast('Settings saved');
  }, [updateSettings, form]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); if (dirty) handleSave(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dirty, handleSave]);

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
          <Btn variant="mango" size="sm" onClick={handleSave} loading={updateSettings.isPending} title="Save (Ctrl+S)">
            <Save size={14} /> Save Changes
          </Btn>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4 scrollable">
        {isLoading ? (
          <div className="max-w-md mx-auto space-y-3">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 shimmer rounded-2xl" />)}
          </div>
        ) : (
          <div className="max-w-md mx-auto">
            {dirty && (
              <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-700 font-medium">
                <Save size={12} /> Unsaved changes · Press Ctrl+S to save quickly
              </div>
            )}
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

            <div className="mt-5 bg-white border border-gray-150 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
                <Printer size={14} className="text-gray-500" />
                <span className="text-xs font-700 text-gray-700 uppercase tracking-wide" style={{ fontWeight: 700 }}>
                  Bluetooth Printer
                </span>
              </div>
              <div className="px-5 py-4">
                {savedPrinter ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                      <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                        <Printer size={16} className="text-emerald-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-700 text-emerald-800 truncate" style={{ fontWeight: 700 }}>
                          {savedPrinter.name}
                        </p>
                        <p className="text-xs text-emerald-600 font-mono">{savedPrinter.address}</p>
                        <p className="text-xs text-emerald-500">{savedPrinter.width}mm paper</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Btn variant="secondary" size="sm" className="flex-1" loading={printerLoading}
                        onClick={async () => {
                          setPrinterLoading(true);
                          try { const p = await selectAndSavePrinter(); setSavedPrinter(p); }
                          finally { setPrinterLoading(false); }
                        }}>
                        <RefreshCw size={12} /> Change Printer
                      </Btn>
                      <Btn variant="danger" size="sm" onClick={() => { forgetPrinter(); setSavedPrinter(null); }}>
                        <Trash2 size={12} /> Forget
                      </Btn>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <p className="text-xs text-gray-500">
                      No printer paired yet. Make sure your 57mm Bluetooth printer is powered on and paired in Android Settings, then tap below.
                    </p>
                    <Btn variant="secondary" fullWidth loading={printerLoading}
                      onClick={async () => {
                        setPrinterLoading(true);
                        try { const p = await selectAndSavePrinter(); setSavedPrinter(p); }
                        finally { setPrinterLoading(false); }
                      }}>
                      <Printer size={14} /> Pair Bluetooth Printer
                    </Btn>
                  </div>
                )}
              </div>
            </div>
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

  const actionColor = useCallback((action: string) => {
    if (action.includes('delete') || action.includes('void') || action.includes('remove')) return 'red';
    if (action.includes('create') || action.includes('open')) return 'green';
    if (action.includes('update') || action.includes('edit') || action.includes('reset') || action.includes('close')) return 'yellow';
    return 'gray';
  }, []);

  const entityIcon = useCallback((type: string) => {
    switch (type) {
      case 'sale': return '🧾';
      case 'user': return '👤';
      case 'menu_item': return '☕';
      case 'shift': return '🕐';
      case 'settings': return '⚙️';
      default: return '📋';
    }
  }, []);

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
      <div className="flex-1 overflow-y-auto p-4 scrollable">
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
                <div key={log.id} className="cv-row bg-white border border-gray-150 rounded-2xl px-4 py-3.5 shadow-sm">
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

// ─── KPI Card — memoized, used heavily in dashboard ──────────
const KpiCard = memo(function KpiCard({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: string; color: string;
}) {
  const colorMap: Record<string, { bg: string; icon: string; border: string }> = {
    green:  { bg: '#F0FDF4', icon: '#16A34A', border: '#BBF7D0' },
    blue:   { bg: '#EFF6FF', icon: '#2563EB', border: '#BFDBFE' },
    yellow: { bg: 'var(--mango-yellow-xl)', icon: '#D97706', border: '#FDE68A' },
    red:    { bg: '#FFF1F2', icon: 'var(--warrior-red)', border: '#FECDD3' },
    gray:   { bg: '#F9FAFB', icon: '#6B7280', border: '#E5E7EB' },
  };
  const c = colorMap[color] ?? colorMap.gray;
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
});

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
  const deleteCategory = useDeleteCategory();
  const reorderCategory = useReorderCategory();

  const [tab, setTab] = useState<'items' | 'addons'>('items');
  const [newCatName, setNewCatName] = useState('');
  const [showAddItem, setShowAddItem] = useState(false);
  const [showAddAddon, setShowAddAddon] = useState(false);
  const [editItem, setEditItem] = useState<MenuItem | null>(null);
  const [newItem, setNewItem] = useState({ name: '', category_id: '', sizes: [{ name: 'Regular', price: '' }] });
  const [newAddon, setNewAddon] = useState({ name: '', price: '' });

  const categories = useMemo(() => menuData?.categories ?? [], [menuData]);
  const sortedCategories = useMemo(() => [...categories].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)), [categories]);
  const allAddons = useMemo(() => menuData?.addons ?? [], [menuData]);

  const handleAddCategory = useCallback(async () => {
    if (!newCatName.trim()) return;
    await createCategory.mutateAsync({ name: newCatName, sort_order: categories.length });
    setNewCatName('');
    toast('Category added');
  }, [createCategory, newCatName, categories.length]);

  const handleAddItem = useCallback(async () => {
    const sizes = newItem.sizes.filter(s => s.name && s.price).map(s => ({ name: s.name, price: parseFloat(s.price) }));
    if (!newItem.name || !sizes.length) return;
    await createItem.mutateAsync({ name: newItem.name, category_id: newItem.category_id || undefined, sizes });
    setNewItem({ name: '', category_id: '', sizes: [{ name: 'Regular', price: '' }] });
    setShowAddItem(false);
    toast('Item added');
  }, [createItem, newItem]);

  const handleAddAddon = useCallback(async () => {
    if (!newAddon.name || !newAddon.price) return;
    await createAddon.mutateAsync({ name: newAddon.name, price: parseFloat(newAddon.price) });
    setNewAddon({ name: '', price: '' });
    setShowAddAddon(false);
    toast('Add-on added');
  }, [createAddon, newAddon]);

  const [editForm, setEditForm] = useState<{
    name: string; category_id: string;
    sizes: { id?: string; name: string; price: string }[];
  } | null>(null);

  const openEditItem = useCallback((item: MenuItem) => {
    setEditItem(item);
    setEditForm({ name: item.name, category_id: item.category_id ?? '', sizes: item.sizes.map(s => ({ id: s.id, name: s.name, price: String(s.price) })) });
  }, []);

  const handleEditItem = useCallback(async () => {
    if (!editItem || !editForm) return;
    const sizes = editForm.sizes.filter(s => s.name && s.price).map(s => ({ ...(s.id ? { id: s.id } : {}), name: s.name, price: parseFloat(s.price) }));
    if (!editForm.name || !sizes.length) return;
    await updateItem.mutateAsync({ id: editItem.id, name: editForm.name, category_id: editForm.category_id || undefined, sizes });
    setEditItem(null); setEditForm(null);
    toast('Item updated');
  }, [updateItem, editItem, editForm]);

  const moveUp = useCallback((catId: string) => reorderCategory.mutate({ id: catId, direction: 'up' }), [reorderCategory]);
  const moveDown = useCallback((catId: string) => reorderCategory.mutate({ id: catId, direction: 'down' }), [reorderCategory]);

  const handleDeleteCategory = useCallback(async (catId: string) => {
    if (!confirm('Delete this category? All items inside will become uncategorised. This action is logged.')) return;
    await deleteCategory.mutateAsync(catId);
    toast('Category deleted');
  }, [deleteCategory]);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--surface-page)' }}>
      <div className="px-4 py-3 bg-white border-b border-gray-150 shrink-0 flex items-center gap-3"
        style={{ boxShadow: '0 1px 0 rgba(0,0,0,0.04)' }}>
        <div className="flex bg-gray-100 p-1 rounded-xl gap-1" role="tablist">
          {(['items', 'addons'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              role="tab" aria-selected={tab === t}
              className={clsx('px-4 py-1.5 rounded-xl text-xs font-700 capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400',
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
      <div className="flex-1 overflow-y-auto p-4 scrollable">
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
            {sortedCategories.map((cat: Category, catIdx: number) => {
              const color = getCategoryColor(catIdx);
              const isFirst = catIdx === 0;
              const isLast = catIdx === sortedCategories.length - 1;
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
                    <div className="flex items-center gap-1">
                      <Badge color="gray">{cat.items.length} items</Badge>
                      <button onClick={() => moveUp(cat.id)} disabled={isFirst} title="Move up"
                        className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                        <ArrowUp size={14} />
                      </button>
                      <button onClick={() => moveDown(cat.id)} disabled={isLast} title="Move down"
                        className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                        <ArrowDown size={14} />
                      </button>
                      <button onClick={() => handleDeleteCategory(cat.id)} title="Delete category"
                        className="p-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {cat.items.map((item: MenuItem) => (
                      <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={clsx('text-sm font-600', item.is_active ? 'text-gray-900' : 'text-gray-400 line-through')} style={{ fontWeight: 600 }}>
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
                            aria-pressed={item.is_available}
                            className={clsx('px-2.5 py-1 rounded-xl text-xs font-700 transition-colors border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400',
                              item.is_available
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                : 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                            )}
                            style={{ fontWeight: 700 }}>
                            {item.is_available ? '✓ Available' : "86'd"}
                          </button>
                          <button onClick={() => openEditItem(item)}
                            className="p-2 rounded-xl text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={async () => { if (confirm(`Delete "${item.name}"?`)) await deleteItem.mutateAsync(item.id); }}
                            className="p-2 rounded-xl text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400">
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
                    aria-pressed={addon.is_available}
                    className={clsx('px-3 py-1.5 rounded-xl text-xs font-700 transition-colors border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400',
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
          <Input label="Item Name" value={newItem.name} onChange={v => setNewItem(p => ({ ...p, name: v }))} autoFocus />
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
          <Input label="Add-on Name" value={newAddon.name} onChange={v => setNewAddon(p => ({ ...p, name: v }))} autoFocus />
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

// ─── Detailed Report Modal ────────────────────────────────────
function DetailedReportModal({ onClose }: { onClose: () => void }) {
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('daily');
  const [dateValue, setDateValue] = useState(new Date().toISOString().slice(0, 10));
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);

  const params = useMemo(() => {
    if (period === 'daily') return { period, date: dateValue };
    if (period === 'weekly') {
      const start = startOfWeek(parseISO(dateValue), { weekStartsOn: 1 });
      const end = endOfWeek(parseISO(dateValue), { weekStartsOn: 1 });
      return { period, date_from: format(start, 'yyyy-MM-dd'), date_to: format(end, 'yyyy-MM-dd') };
    }
    if (period === 'monthly') return { period, year, month };
    return { period, year };
  }, [period, dateValue, year, month]);

  const { data, isLoading, error } = useDetailedSalesReport(params);

  return (
    <Modal open onClose={onClose} title="Detailed Sales Report" maxWidth="max-w-4xl">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-gray-100 p-1 rounded-xl" role="tablist">
            {(['daily', 'weekly', 'monthly', 'yearly'] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                role="tab" aria-selected={period === p}
                className={clsx('px-4 py-1.5 rounded-xl text-xs font-700 capitalize transition-colors',
                  period === p ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                )}
                style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                {p}
              </button>
            ))}
          </div>
          {period === 'daily' && (
            <Input type="date" value={dateValue} onChange={setDateValue} className="w-40" />
          )}
          {period === 'weekly' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Week of:</span>
              <Input type="date" value={dateValue} onChange={setDateValue} className="w-40" />
            </div>
          )}
          {period === 'monthly' && (
            <div className="flex items-center gap-2">
              <Select value={String(year)} onChange={v => setYear(Number(v))}
                options={Array.from({length:5}, (_,i)=>({value: String(new Date().getFullYear()-2+i), label: String(new Date().getFullYear()-2+i)}))}
                className="w-24" />
              <Select value={String(month)} onChange={v => setMonth(Number(v))}
                options={Array.from({length:12}, (_,i)=>({value: String(i+1), label: String(i+1).padStart(2,'0')}))}
                className="w-20" />
            </div>
          )}
          {period === 'yearly' && (
            <Select value={String(year)} onChange={v => setYear(Number(v))}
              options={Array.from({length:5}, (_,i)=>({value: String(new Date().getFullYear()-2+i), label: String(new Date().getFullYear()-2+i)}))}
              className="w-24" />
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8"><RefreshCw className="animate-spin text-gray-300" size={24} /></div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertTriangle size={36} className="text-red-400 mb-3" />
            <p className="text-red-600 text-sm font-medium">Failed to load report</p>
            <p className="text-gray-400 text-xs mt-1">Please try again later</p>
          </div>
        ) : data ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard icon={<DollarSign size={18} />} label="Total Sales" value={fmt(data.total_sales ?? 0)} color="green" />
            <KpiCard icon={<Receipt size={18} />} label="Transactions" value={String(data.transaction_count ?? 0)} color="blue" />
            <KpiCard icon={<TrendingUp size={18} />} label="Avg Sale" value={fmt(data.avg_sale ?? 0)} color="yellow" />
            <KpiCard icon={<Tag size={18} />} label="Discounts" value={fmt(data.total_discount ?? 0)} color="red" />
            <KpiCard icon={<AlertTriangle size={18} />} label="Voided" value={String(data.voided_count ?? 0)} color="red" />
            <KpiCard icon={<RefreshCw size={18} />} label="Refunded" value={String(data.refunded_count ?? 0)} color="yellow" />
            <KpiCard icon={<Edit2 size={18} />} label="Edited" value={String(data.edited_count ?? 0)} color="gray" />
            <KpiCard icon={<Trash2 size={18} />} label="Deleted" value={String(data.deleted_count ?? 0)} color="gray" />
          </div>
        ) : (
          <p className="text-gray-400 text-center py-8">No data for selected period.</p>
        )}

        <div className="flex justify-end">
          <Btn variant="secondary" onClick={onClose}>Close</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ─── Admin Dashboard Page ─────────────────────────────────────
function AdminDashboardPage() {
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));
  const { data: report, isLoading } = useSalesReport({ date_from: dateFrom, date_to: dateTo });
  const { data: shift } = useCurrentShift();
  const { navigate } = useUIStore();
  const [showDetailedReport, setShowDetailedReport] = useState(false);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--surface-page)' }}>
      <div className="px-4 py-3 bg-white border-b border-gray-150 shrink-0 flex gap-3 items-end flex-wrap"
        style={{ boxShadow: '0 1px 0 rgba(0,0,0,0.04)' }}>
        <Input label="From" type="date" value={dateFrom} onChange={setDateFrom} className="w-36" />
        <Input label="To" type="date" value={dateTo} onChange={setDateTo} className="w-36" />
        <div className="flex-1" />
        <Btn variant="mango" size="sm" onClick={() => setShowDetailedReport(true)}>
          <FileText size={14} /> Detailed Report
        </Btn>
      </div>
      <div className="flex-1 overflow-y-auto p-4 scrollable">
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
                      <div className="h-3 bg-gray-100 rounded-full overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
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
                    hover:shadow-md transition-shadow text-left group active:scale-98 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
                  style={{ boxShadow: 'var(--shadow-sm)' }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors"
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
      {showDetailedReport && <DetailedReportModal onClose={() => setShowDetailedReport(false)} />}
    </div>
  );
}

// ─── App Shell ────────────────────────────────────────────────
function AppShell() {
  const { page } = useUIStore();
  const { user } = useAuthStore();

  // FIX: Replaced eager pageMap object with lazy rendering.
  // Previously all 7 page components were instantiated on every AppShell
  // render, meaning all their useQuery hooks fired simultaneously — SalesPage
  // and AdminDashboardPage were making API calls even while the cashier was
  // on the POS screen. Now only the current page is mounted.
  const adminPages: Page[] = ['admin_dashboard','admin_menu','admin_employees','admin_settings','admin_audit'];
  const currentPage: Page = adminPages.includes(page) && user?.role !== 'admin' ? 'pos' : page;

  function renderPage() {
    switch (currentPage) {
      case 'pos':               return <POSPage />;
      case 'sales':             return <SalesPage />;
      case 'admin_dashboard':   return <AdminDashboardPage />;
      case 'admin_menu':        return <AdminMenuPage />;
      case 'admin_employees':   return <AdminEmployeesPage />;
      case 'admin_settings':    return <AdminSettingsPage />;
      case 'admin_audit':       return <AdminAuditPage />;
      default:                  return <POSPage />;
    }
  }

  return (
    <div className="w-full h-full flex flex-col" style={{ background: 'var(--surface-page)' }}>
      <Header />
      <main className="flex-1 overflow-hidden" role="main">
        {renderPage()}
      </main>
      <PinModal />
    </div>
  );
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: any) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="h-full flex items-center justify-center flex-col gap-4 p-6 text-center">
          <AlertTriangle size={48} className="text-red-400" />
          <h2 className="text-lg font-800 text-red-700" style={{ fontFamily: 'var(--font-display)' }}>Something went wrong</h2>
          <p className="text-gray-500 text-sm">{this.state.error?.message}</p>
          <Btn variant="secondary" onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}>
            Reload Page
          </Btn>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  const { user, token, logout } = useAuthStore()

  useEffect(() => {
    if (user && token) {
      fetch(`${(import.meta.env.VITE_API_URL ?? '').replace(/\/api$/, '')}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(res => { if (!res.ok) logout() })
        .catch(() => logout())
    }
    autoReconnectPrinter()
  }, [])

  if (!user || !token) return <LoginPage />
  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  )
}