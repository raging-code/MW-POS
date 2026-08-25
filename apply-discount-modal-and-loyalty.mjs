#!/usr/bin/env node
// apply-discount-modal-and-loyalty.mjs
//
// Two changes to MW-POS's Order tab:
//
//   1. DISCOUNT PICKER MODAL
//      Replaces the 4 separate inline discount buttons (SC / PWD / 15% /
//      100%) on each cart line with a single "Discount" button that opens
//      a modal listing every available discount, including a new flat
//      -₱10 option ("-₱10 Discount"). Toggling the currently-active
//      discount again in the modal clears it, same as before.
//      New discount type: 'p10' — flat ₱10 off the line (not × qty),
//      clamped so it never exceeds the line's own subtotal.
//        - src/types.ts     — DiscountType gets 'p10'
//        - src/store.ts     — computeItemTotals() branch for 'p10'
//        - src/App.tsx      — discountLabel(), new DiscountPickerModal,
//                              CartItemRow now renders one button + modal
//        - src/index.css    — .discount-btn-p10 / .discount-btn-picker
//        - worker/src/index.ts — checkout recomputes 'p10' server-side
//                                 too (never trusts client totals), and
//                                 the sale_items Drizzle schema enum
//        - worker/migrations/0006_discount_type_p10.sql — widens the
//          sale_items.discount_type CHECK constraint (SQLite requires a
//          table rebuild to alter a CHECK constraint)
//
//   2. LOYALTY FREE ADD-ON
//      Adds a "🎁 Loyalty free" checkbox under the qty stepper for each
//      selected add-on inside the existing Add-ons modal (CartAddonPickerModal).
//      Checking it zeroes that add-on's price for this cart line. No new
//      field on CartAddon/the DB schema — a "loyalty free" add-on is,
//      everywhere downstream (totals, receipts, checkout), simply an
//      add-on whose addon_price is 0. This keeps the change scoped to
//      the modal only.
//        - src/App.tsx — CartAddonPickerModal gains freeAddonIds state,
//                         toggleLoyaltyFree(), and the checkbox UI
//
// Usage:
//   node apply-discount-modal-and-loyalty.mjs            (run from repo root)
//   node apply-discount-modal-and-loyalty.mjs --dry-run   (show what would change)
//
// Idempotent: safe to run multiple times; already-applied changes are
// detected and skipped.

import fs from 'node:fs'
import path from 'node:path'

const DRY_RUN = process.argv.includes('--dry-run')
const ROOT = process.cwd()

const TYPES_FILE   = path.join(ROOT, 'src', 'types.ts')
const STORE_FILE    = path.join(ROOT, 'src', 'store.ts')
const APP_FILE      = path.join(ROOT, 'src', 'App.tsx')
const CSS_FILE      = path.join(ROOT, 'src', 'index.css')
const WORKER_FILE   = path.join(ROOT, 'worker', 'src', 'index.ts')
const MIGRATION_DIR = path.join(ROOT, 'worker', 'migrations')
const MIGRATION_FILE = path.join(MIGRATION_DIR, '0006_discount_type_p10.sql')

let anyChange = false

// Track which files use CRLF so we can restore it on write — Windows
// checkouts (core.autocrlf=true) commonly have CRLF line endings, but all
// anchors/inserts in this script are written with plain \n. We normalize
// to \n on read and convert back to the file's original ending on write.
const crlfFiles = new Set()

function readFile(p) {
  if (!fs.existsSync(p)) {
    console.error(`✗ Required file not found: ${p}`)
    console.error(`  Make sure you're running this from the MW-POS repo root.`)
    process.exit(1)
  }
  const raw = fs.readFileSync(p, 'utf8')
  if (raw.includes('\r\n')) crlfFiles.add(p)
  return raw.replace(/\r\n/g, '\n')
}

function writeFile(p, content) {
  const out = crlfFiles.has(p) ? content.replace(/\n/g, '\r\n') : content
  if (DRY_RUN) {
    console.log(`  [dry-run] would write ${path.relative(ROOT, p)}`)
    return
  }
  fs.writeFileSync(p, out, 'utf8')
  console.log(`  ✓ wrote ${path.relative(ROOT, p)}`)
}

// Replaces the first occurrence of `find` with `replace` in `content`.
// Returns null if `find` isn't present (already applied, or file has
// drifted). Throws if `find` occurs more than once (anchor not unique).
function applyOnce(content, find, replace, label) {
  const count = content.split(find).length - 1
  if (count === 0) return null
  if (count > 1) {
    throw new Error(`Anchor for "${label}" matched ${count} times — expected exactly 1. Aborting to avoid a bad patch.`)
  }
  return content.replace(find, replace)
}

function patchFile(filePath, edits) {
  let content = readFile(filePath)
  let fileChanged = false

  for (const edit of edits) {
    const alreadyApplied = edit.already && content.includes(edit.already)
    if (alreadyApplied) {
      console.log(`  • ${edit.label}: already applied, skipping`)
      continue
    }
    const next = applyOnce(content, edit.find, edit.replace, edit.label)
    if (next === null) {
      console.log(`  ⚠ ${edit.label}: anchor not found (already applied differently, or file has changed) — skipping`)
      continue
    }
    content = next
    fileChanged = true
    anyChange = true
    console.log(`  ✓ ${edit.label}`)
  }

  if (fileChanged) writeFile(filePath, content)
  else console.log(`  (no changes to ${path.relative(ROOT, filePath)})`)
}

console.log('── src/types.ts ──')
patchFile(TYPES_FILE, [
  {
    label: `DiscountType gains 'p10'`,
    already: `'sc' | 'pwd' | 'p15' | 'p100' | 'p10' | null`,
    find: `export type DiscountType = 'sc' | 'pwd' | 'p15' | 'p100' | null;`,
    replace: `export type DiscountType = 'sc' | 'pwd' | 'p15' | 'p100' | 'p10' | null;`,
  },
])

console.log('\n── src/store.ts ──')
patchFile(STORE_FILE, [
  {
    label: `computeItemTotals(): 'p10' branch`,
    already: `item.discount_type === 'p10'`,
    find: `  } else if (item.discount_type === 'p100') {
    // 100% off — comps the line entirely.
    discount_amount = total_before_discount;
  } else {`,
    replace: `  } else if (item.discount_type === 'p100') {
    // 100% off — comps the line entirely.
    discount_amount = total_before_discount;
  } else if (item.discount_type === 'p10') {
    // Flat ₱10 off the line (not multiplied by qty) — clamp so it never
    // exceeds the line's own total.
    discount_amount = Math.min(10, total_before_discount);
  } else {`,
  },
])

console.log('\n── src/index.css ──')
patchFile(CSS_FILE, [
  {
    label: `.discount-btn-p10 / .discount-btn-picker styles`,
    already: `.discount-btn-picker`,
    find: `.discount-btn-p100 { background: #FEF2F2; color: #B91C1C; border-color: #FECACA; }
.discount-btn-p100.active { background: #DC2626; color: #fff; border-color: #DC2626; }

/* ── Toast ── */`,
    replace: `.discount-btn-p100 { background: #FEF2F2; color: #B91C1C; border-color: #FECACA; }
.discount-btn-p100.active { background: #DC2626; color: #fff; border-color: #DC2626; }
.discount-btn-p10  { background: #ECFDF5; color: #047857; border-color: #A7F3D0; }
.discount-btn-p10.active { background: #059669; color: #fff; border-color: #059669; }
/* Single "Discount" trigger button on the cart row — opens DiscountPickerModal */
.discount-btn-picker { background: #F9FAFB; color: #4B5563; border-color: #E5E7EB; display: inline-flex; align-items: center; }
.discount-btn-picker.active { background: #ECFDF5; color: #047857; border-color: #A7F3D0; }

/* ── Toast ── */`,
  },
])

console.log('\n── worker/src/index.ts ──')
patchFile(WORKER_FILE, [
  {
    label: `sale_items Drizzle schema enum gains 'p10'`,
    already: `enum: ['sc', 'pwd', 'p15', 'p100', 'p10']`,
    find: `  discount_type:   text('discount_type', { enum: ['sc', 'pwd', 'p15', 'p100'] }),`,
    replace: `  discount_type:   text('discount_type', { enum: ['sc', 'pwd', 'p15', 'p100', 'p10'] }),`,
  },
  {
    label: `CheckoutItem type gains 'p10'`,
    already: `discount_type?: 'sc' | 'pwd' | 'p15' | 'p100' | 'p10'`,
    find: `  discount_type?: 'sc' | 'pwd' | 'p15' | 'p100'`,
    replace: `  discount_type?: 'sc' | 'pwd' | 'p15' | 'p100' | 'p10'`,
  },
  {
    label: `checkout discAmt computation: 'p10' branch`,
    already: `item.discount_type === 'p10') discAmt`,
    find: `    else if (item.discount_type === 'p15') discAmt = itemBase * 0.15
    else if (item.discount_type === 'p100') discAmt = itemBase
    else if (item.discount_pct > 0) discAmt = itemBase * (item.discount_pct / 100)`,
    replace: `    else if (item.discount_type === 'p15') discAmt = itemBase * 0.15
    else if (item.discount_type === 'p100') discAmt = itemBase
    else if (item.discount_type === 'p10') discAmt = Math.min(10, itemBase)
    else if (item.discount_pct > 0) discAmt = itemBase * (item.discount_pct / 100)`,
  },
  {
    label: `discount_pct-zeroing list includes 'p10'`,
    already: `item.discount_type === 'p100' || item.discount_type === 'p10') ? 0`,
    find: `      discount_pct: (item.discount_type === 'sc' || item.discount_type === 'pwd' || item.discount_type === 'p15' || item.discount_type === 'p100') ? 0 : item.discount_pct,`,
    replace: `      discount_pct: (item.discount_type === 'sc' || item.discount_type === 'pwd' || item.discount_type === 'p15' || item.discount_type === 'p100' || item.discount_type === 'p10') ? 0 : item.discount_pct,`,
  },
])

console.log('\n── worker/migrations/0006_discount_type_p10.sql ──')
if (fs.existsSync(MIGRATION_FILE)) {
  console.log(`  • already exists, skipping`)
} else if (!fs.existsSync(MIGRATION_DIR)) {
  console.error(`✗ Migration directory not found: ${MIGRATION_DIR}`)
  process.exit(1)
} else {
  const sql = `-- Widen sale_items.discount_type CHECK constraint to allow the new
-- flat ₱10 discount type ('p10') alongside 'sc'/'pwd'/'p15'/'p100'.
-- SQLite can't ALTER a CHECK constraint directly, so we rebuild the
-- table (standard 12-step pattern) and restore its index.

PRAGMA foreign_keys=OFF;

CREATE TABLE sale_items_new (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  item_id_ref TEXT,
  item_name TEXT NOT NULL,
  size_name TEXT,
  base_price REAL NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  discount_type TEXT CHECK(discount_type IN ('sc','pwd','p15','p100','p10')),
  discount_pct REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  addons_total REAL NOT NULL DEFAULT 0,
  final_price REAL NOT NULL
);

INSERT INTO sale_items_new
  (id, sale_id, item_id_ref, item_name, size_name, base_price, qty,
   discount_type, discount_pct, discount_amount, addons_total, final_price)
SELECT
  id, sale_id, item_id_ref, item_name, size_name, base_price, qty,
  discount_type, discount_pct, discount_amount, addons_total, final_price
FROM sale_items;

DROP TABLE sale_items;
ALTER TABLE sale_items_new RENAME TO sale_items;

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);

PRAGMA foreign_keys=ON;
`
  if (DRY_RUN) {
    console.log(`  [dry-run] would create ${path.relative(ROOT, MIGRATION_FILE)}`)
  } else {
    fs.writeFileSync(MIGRATION_FILE, sql, 'utf8')
    console.log(`  ✓ wrote ${path.relative(ROOT, MIGRATION_FILE)}`)
  }
  anyChange = true
}

console.log('\n── src/App.tsx ──')
patchFile(APP_FILE, [
  {
    label: `discountLabel() gains 'p10' case`,
    already: `case 'p10': return '-₱10';`,
    find: `    case 'p100': return '100%';
    default: return '';
  }
}`,
    replace: `    case 'p100': return '100%';
    case 'p10': return '-₱10';
    default: return '';
  }
}`,
  },
  {
    label: `CartAddonPickerModal: loyalty-free state + toggle`,
    already: `toggleLoyaltyFree`,
    find: `    setSelected(prev => prev.map(a => a.addon_id === addonId ? { ...a, qty: Math.max(1, a.qty + delta) } : a));
  }, []);

  const handleApply = useCallback(() => { setAddons(cartKey, selected); onClose(); }, [setAddons, cartKey, selected, onClose]);`,
    replace: `    setSelected(prev => prev.map(a => a.addon_id === addonId ? { ...a, qty: Math.max(1, a.qty + delta) } : a));
  }, []);

  // Loyalty card redemption: crew can mark a selected add-on as free. We
  // don't track a separate "original price" field on CartAddon — instead we
  // remember it locally in this modal (keyed by addon_id, sourced from the
  // menu's Addon list) purely for display, and zero out addon_price itself
  // when applying. That way addons_total, receipts, and checkout all just
  // work with zero downstream changes: a loyalty-free add-on is, everywhere
  // else in the app, an add-on that costs ₱0.
  const loyaltyFree = useMemo(() => {
    const s = new Set<string>();
    currentAddons.forEach(a => { if (a.addon_price === 0) s.add(a.addon_id); });
    return s;
  }, [currentAddons]);
  const [freeAddonIds, setFreeAddonIds] = useState<Set<string>>(loyaltyFree);

  const toggleLoyaltyFree = useCallback((addon: Addon) => {
    setFreeAddonIds(prev => {
      const next = new Set(prev);
      if (next.has(addon.id)) next.delete(addon.id); else next.add(addon.id);
      return next;
    });
    setSelected(prev => prev.map(a => a.addon_id === addon.id
      ? { ...a, addon_price: freeAddonIds.has(addon.id) ? addon.price : 0 }
      : a
    ));
  }, [freeAddonIds]);

  const handleApply = useCallback(() => { setAddons(cartKey, selected); onClose(); }, [setAddons, cartKey, selected, onClose]);`,
  },
  {
    label: `CartAddonPickerModal: checkbox UI + FREE price label`,
    already: `🎁 Loyalty free`,
    find: `                  <div className="flex-1 min-w-0">
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
                  )}`,
    replace: `                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-600 text-gray-900" style={{ fontWeight: 600 }}>{addon.name}</div>
                    {sel && freeAddonIds.has(addon.id) ? (
                      <div className="text-xs font-700 text-emerald-600 mt-0.5">FREE (loyalty)</div>
                    ) : (
                      <div className="text-xs font-700 text-amber-700 mt-0.5">+{fmt(addon.price)} each</div>
                    )}
                  </div>
                  {sel && (
                    <div className="flex flex-col items-end gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
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
                      <label className="flex items-center gap-1 text-[10px] font-600 text-gray-500 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={freeAddonIds.has(addon.id)}
                          onChange={() => toggleLoyaltyFree(addon)}
                          className="w-3 h-3 accent-emerald-600"
                        />
                        🎁 Loyalty free
                      </label>
                    </div>
                  )}`,
  },
  {
    label: `CartItemRow: replace 4 discount toggles with modal open/select handlers`,
    already: `handleSelectDiscount`,
    find: `  const handleScToggle   = useCallback(() => setDiscount(item.cart_key, item.discount_type === 'sc'   ? null : 'sc'),   [setDiscount, item.cart_key, item.discount_type]);
  const handlePwdToggle  = useCallback(() => setDiscount(item.cart_key, item.discount_type === 'pwd'  ? null : 'pwd'),  [setDiscount, item.cart_key, item.discount_type]);
  const handleP15Toggle  = useCallback(() => setDiscount(item.cart_key, item.discount_type === 'p15'  ? null : 'p15'),  [setDiscount, item.cart_key, item.discount_type]);
  const handleP100Toggle = useCallback(() => setDiscount(item.cart_key, item.discount_type === 'p100' ? null : 'p100'), [setDiscount, item.cart_key, item.discount_type]);
  const handleAddonTap  = useCallback(() => onOpenAddonPicker(item.cart_key, item.addons, item.category_id), [onOpenAddonPicker, item.cart_key, item.addons, item.category_id]);`,
    replace: `  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const handleOpenDiscountModal  = useCallback(() => setShowDiscountModal(true),  []);
  const handleCloseDiscountModal = useCallback(() => setShowDiscountModal(false), []);
  const handleSelectDiscount = useCallback((type: Exclude<CartItem['discount_type'], null>) => {
    // Selecting the currently-active discount again clears it (toggle behavior,
    // same as the old individual buttons).
    setDiscount(item.cart_key, item.discount_type === type ? null : type);
    setShowDiscountModal(false);
  }, [setDiscount, item.cart_key, item.discount_type]);
  const handleAddonTap  = useCallback(() => onOpenAddonPicker(item.cart_key, item.addons, item.category_id), [onOpenAddonPicker, item.cart_key, item.addons, item.category_id]);`,
  },
  {
    label: `CartItemRow: single Discount button + DiscountPickerModal render, new modal component`,
    already: `const DISCOUNT_OPTIONS:`,
    find: `        {discountDisabled ? (
          <span className="text-[11px] text-gray-400 italic">Not available for this category</span>
        ) : (
          <>
            <button
              onClick={handleScToggle}
              aria-pressed={item.discount_type === 'sc'}
              className={\`discount-btn discount-btn-sc \${item.discount_type === 'sc' ? 'active' : ''}\`}>
              SC
            </button>
            <button
              onClick={handlePwdToggle}
              aria-pressed={item.discount_type === 'pwd'}
              className={\`discount-btn discount-btn-pwd \${item.discount_type === 'pwd' ? 'active' : ''}\`}>
              PWD
            </button>
            <button
              onClick={handleP15Toggle}
              aria-pressed={item.discount_type === 'p15'}
              className={\`discount-btn discount-btn-p15 \${item.discount_type === 'p15' ? 'active' : ''}\`}>
              15%
            </button>
            <button
              onClick={handleP100Toggle}
              aria-pressed={item.discount_type === 'p100'}
              className={\`discount-btn discount-btn-p100 \${item.discount_type === 'p100' ? 'active' : ''}\`}>
              100%
            </button>
          </>
        )}
        {item.discount_type && (
          <span className="ml-auto text-xs font-semibold text-emerald-600">
            −{fmt(item.discount_amount)}
          </span>
        )}
      </div>
      {/* CartAddonPickerModal is NO LONGER rendered here — it's in POSPage */}
    </article>
  );
});`,
    replace: `        {discountDisabled ? (
          <span className="text-[11px] text-gray-400 italic">Not available for this category</span>
        ) : (
          <button
            onClick={handleOpenDiscountModal}
            aria-haspopup="dialog"
            className={\`discount-btn discount-btn-picker \${item.discount_type ? 'active' : ''}\`}>
            <Tag size={11} className="shrink-0" style={{ marginRight: 4 }} />
            {item.discount_type ? discountLabel(item.discount_type) : 'Discount'}
          </button>
        )}
        {item.discount_type && (
          <span className="ml-auto text-xs font-semibold text-emerald-600">
            −{fmt(item.discount_amount)}
          </span>
        )}
      </div>
      {showDiscountModal && (
        <DiscountPickerModal
          activeType={item.discount_type}
          onSelect={handleSelectDiscount}
          onClose={handleCloseDiscountModal}
        />
      )}
      {/* CartAddonPickerModal is NO LONGER rendered here — it's in POSPage */}
    </article>
  );
});

// ─── Discount Picker Modal — single entry point listing every ──
// available discount type for a cart line, opened from the one
// "Discount" button on CartItemRow.
const DISCOUNT_OPTIONS: { type: Exclude<CartItem['discount_type'], null>; label: string; hint: string; className: string }[] = [
  { type: 'sc',   label: 'Senior Citizen (SC)', hint: 'Fixed peso amount off the line', className: 'discount-btn-sc' },
  { type: 'pwd',  label: 'PWD',                 hint: 'Fixed peso amount off the line', className: 'discount-btn-pwd' },
  { type: 'p15',  label: '15% Off',             hint: '15% off this line',              className: 'discount-btn-p15' },
  { type: 'p100', label: '100% Off',            hint: 'Comps this line entirely',        className: 'discount-btn-p100' },
  { type: 'p10',  label: '-₱10 Discount',       hint: '₱10 off this line',              className: 'discount-btn-p10' },
];

function DiscountPickerModal({
  activeType, onSelect, onClose,
}: {
  activeType: CartItem['discount_type'];
  onSelect: (type: Exclude<CartItem['discount_type'], null>) => void;
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} title="🏷️ Discounts" maxWidth="max-w-sm">
      <div className="flex flex-col gap-2">
        {DISCOUNT_OPTIONS.map(opt => {
          const isActive = activeType === opt.type;
          return (
            <button
              key={opt.type}
              onClick={() => onSelect(opt.type)}
              aria-pressed={isActive}
              className={clsx(
                'flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border-2 transition-colors duration-100 text-left',
                isActive ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 bg-white hover:border-gray-300'
              )}>
              <div className="min-w-0">
                <div className={\`discount-btn \${opt.className} \${isActive ? 'active' : ''}\`} style={{ display: 'inline-block', marginBottom: 4 }}>
                  {opt.label}
                </div>
                <div className="text-xs text-gray-400">{opt.hint}</div>
              </div>
              {isActive && <span className="text-emerald-600 font-700 text-xs shrink-0">Applied ✓</span>}
            </button>
          );
        })}
        <Btn variant="secondary" onClick={onClose} className="mt-1">Close</Btn>
      </div>
    </Modal>
  );
}`,
  },
])

console.log('\n' + '─'.repeat(60))
if (DRY_RUN) {
  console.log(anyChange ? 'Dry run complete — changes are pending.' : 'Dry run complete — nothing to change.')
} else if (anyChange) {
  console.log('✓ Done. Next steps:')
  console.log('  1. cd worker && npx wrangler d1 migrations apply <YOUR_DB_NAME>')
  console.log('     (applies 0006_discount_type_p10.sql — needed before checkout will')
  console.log('     accept the new -₱10 discount, since it widens a DB CHECK constraint)')
  console.log('  2. npm run build   (frontend)')
  console.log('  3. Review the diff, then commit.')
} else {
  console.log('Nothing changed — everything was already applied.')
}
