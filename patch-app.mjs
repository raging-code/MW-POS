#!/usr/bin/env node
// patch-app2.mjs
// Run from the project root:   node patch-app2.mjs
//
// Applies three targeted fixes to src/App.tsx:
//
//   FIX 1 — CartItemRow: replace full useCartStore() with action-only selector.
//     CartItemRow is memoized but subscribes to the entire cart store.
//     It only CALLS actions (removeItem, updateQty, setDiscount) — it never
//     READS cart state. So every time any cart item changes (qty, discount,
//     note), all CartItemRow instances re-render even though their data didn't
//     change. Selecting only the three action functions (which are stable
//     references in Zustand) means CartItemRow re-renders only when its own
//     `item` prop changes.
//
//   FIX 2 — Note textarea: debounce setNote to stop full POSPage re-renders
//     on every keystroke.
//     POSPage subscribes to useCartStore() (full store). Every character typed
//     in the "Special instructions" textarea calls cart.setNote() which
//     triggers a Zustand set(), which re-renders POSPage — including the entire
//     menu grid. A 300ms debounce using a local useRef timer means the store
//     only updates after the user pauses typing. The textarea shows the live
//     value via local useState so it feels instant.
//
//   FIX 3 — Add cv-row class to sales list rows and audit log rows.
//     index.css defines `.cv-row { content-visibility: auto; contain-intrinsic-size: 0 80px; }`
//     which tells the browser to skip paint and layout for rows that are
//     off-screen. This class was defined but never applied in JSX.
//     Adding it to the sales list <button> and audit log <div> rows means
//     the browser only renders the ~8-10 rows visible in the viewport,
//     not all 100+ rows in a busy day's transaction list.

import fs from 'fs';
import path from 'path';

const filePath = path.resolve('src/App.tsx');
let src = fs.readFileSync(filePath, 'utf8');

// ─── FIX 1: CartItemRow — action-only selector ───────────────────────────────
const OLD_CART_ITEM_ROW_STORE = `  const cart = useCartStore();
 
  const accentColors = ['#F59E0B','#059669','#E11D48','#7C3AED','#0284C7','#EA580C','#DB2777','#0F766E'];
  const accentColor = useMemo(() => {
    const idx = item.item_id.charCodeAt(0) % accentColors.length;
    return accentColors[idx] ?? '#F59E0B';
  }, [item.item_id]);
 
  const handleRemove    = useCallback(() => cart.removeItem(item.cart_key), [cart, item.cart_key]);
  const handleQtyMinus  = useCallback(() => cart.updateQty(item.cart_key, -1), [cart, item.cart_key]);
  const handleQtyPlus   = useCallback(() => cart.updateQty(item.cart_key, 1),  [cart, item.cart_key]);
  const handleScToggle  = useCallback(() => cart.setDiscount(item.cart_key, item.discount_type === 'sc'  ? null : 'sc'),  [cart, item.cart_key, item.discount_type]);
  const handlePwdToggle = useCallback(() => cart.setDiscount(item.cart_key, item.discount_type === 'pwd' ? null : 'pwd'), [cart, item.cart_key, item.discount_type]);
  const handleAddonTap  = useCallback(() => onOpenAddonPicker(item.cart_key, item.addons), [onOpenAddonPicker, item.cart_key, item.addons]);`;

const NEW_CART_ITEM_ROW_STORE = `  // FIX: Select only the three action functions from the cart store.
  // CartItemRow is memo'd and never reads cart STATE — it only calls actions.
  // Subscribing to the full store caused every CartItemRow to re-render on
  // every cart mutation (qty change, discount toggle, note edit) even when
  // the row's own item data hadn't changed.
  // Zustand action functions are stable references (created once), so this
  // selector never triggers a re-render on its own.
  const removeItem   = useCartStore(s => s.removeItem);
  const updateQty    = useCartStore(s => s.updateQty);
  const setDiscount  = useCartStore(s => s.setDiscount);

  const accentColors = ['#F59E0B','#059669','#E11D48','#7C3AED','#0284C7','#EA580C','#DB2777','#0F766E'];
  const accentColor = useMemo(() => {
    const idx = item.item_id.charCodeAt(0) % accentColors.length;
    return accentColors[idx] ?? '#F59E0B';
  }, [item.item_id]);

  const handleRemove    = useCallback(() => removeItem(item.cart_key), [removeItem, item.cart_key]);
  const handleQtyMinus  = useCallback(() => updateQty(item.cart_key, -1), [updateQty, item.cart_key]);
  const handleQtyPlus   = useCallback(() => updateQty(item.cart_key, 1),  [updateQty, item.cart_key]);
  const handleScToggle  = useCallback(() => setDiscount(item.cart_key, item.discount_type === 'sc'  ? null : 'sc'),  [setDiscount, item.cart_key, item.discount_type]);
  const handlePwdToggle = useCallback(() => setDiscount(item.cart_key, item.discount_type === 'pwd' ? null : 'pwd'), [setDiscount, item.cart_key, item.discount_type]);
  const handleAddonTap  = useCallback(() => onOpenAddonPicker(item.cart_key, item.addons), [onOpenAddonPicker, item.cart_key, item.addons]);`;

if (!src.includes(OLD_CART_ITEM_ROW_STORE)) {
  console.error('FIX 1 FAILED: Could not find CartItemRow store block. Already patched?');
  process.exit(1);
}
src = src.replace(OLD_CART_ITEM_ROW_STORE, NEW_CART_ITEM_ROW_STORE);
console.log('✓ FIX 1 applied: CartItemRow now uses action-only selectors');

// ─── FIX 2: Note textarea debounce ───────────────────────────────────────────
// Step 2a: Add noteRef and noteDebounceRef to POSPage state declarations
const OLD_POSPAGE_REFS = `  const searchRef = useRef<HTMLInputElement>(null);
  const [addonPickerFor, setAddonPickerFor] = useState<{
    cartKey: string;
    currentAddons: CartAddon[];
  } | null>(null);`;

const NEW_POSPAGE_REFS = `  const searchRef = useRef<HTMLInputElement>(null);
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
  }, [cart]);`;

if (!src.includes(OLD_POSPAGE_REFS)) {
  console.error('FIX 2a FAILED: Could not find POSPage refs block. Already patched?');
  process.exit(1);
}
src = src.replace(OLD_POSPAGE_REFS, NEW_POSPAGE_REFS);
console.log('✓ FIX 2a applied: noteLocal state and debounce handler added to POSPage');

// Step 2b: Replace the textarea to use local state and debounced handler
const OLD_NOTE_TEXTAREA = `            <textarea
              value={cart.cart.note}
              onChange={e => cart.setNote(e.target.value)}
              placeholder="Special instructions…"
              rows={2}
              className="w-full bg-gray-50 border border-gray-200 text-gray-700 rounded-xl px-3 py-2.5 text-xs
                focus:outline-none focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/20
                placeholder-gray-350 resize-none font-medium transition-colors"
            />`;

const NEW_NOTE_TEXTAREA = `            <textarea
              value={noteLocal}
              onChange={handleNoteChange}
              placeholder="Special instructions…"
              rows={2}
              className="w-full bg-gray-50 border border-gray-200 text-gray-700 rounded-xl px-3 py-2.5 text-xs
                focus:outline-none focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/20
                placeholder-gray-350 resize-none font-medium transition-colors"
            />`;

if (!src.includes(OLD_NOTE_TEXTAREA)) {
  console.error('FIX 2b FAILED: Could not find note textarea. Already patched?');
  process.exit(1);
}
src = src.replace(OLD_NOTE_TEXTAREA, NEW_NOTE_TEXTAREA);
console.log('✓ FIX 2b applied: note textarea now uses debounced local state');

// ─── FIX 3a: cv-row on sales list rows ───────────────────────────────────────
const OLD_SALES_ROW = `                  <button key={sale.id}
                    onClick={() => setSelectedId(s => s === sale.id ? null : sale.id)}
                    aria-pressed={selectedId === sale.id}
                    className={clsx(
                      'w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-gray-50',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-inset',
                      selectedId === sale.id && 'border-l-[3px]'
                    )}`;

const NEW_SALES_ROW = `                  <button key={sale.id}
                    onClick={() => setSelectedId(s => s === sale.id ? null : sale.id)}
                    aria-pressed={selectedId === sale.id}
                    className={clsx(
                      // cv-row: content-visibility:auto — browser skips paint/layout for off-screen rows.
                      // Defined in index.css. On a busy day with 100+ transactions this cuts the
                      // initial render cost of the list to only the ~10 visible rows.
                      'cv-row w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-gray-50',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-inset',
                      selectedId === sale.id && 'border-l-[3px]'
                    )}`;

if (!src.includes(OLD_SALES_ROW)) {
  console.error('FIX 3a FAILED: Could not find sales list row className. Already patched?');
  process.exit(1);
}
src = src.replace(OLD_SALES_ROW, NEW_SALES_ROW);
console.log('✓ FIX 3a applied: cv-row added to sales list rows');

// ─── FIX 3b: cv-row on audit log rows ────────────────────────────────────────
const OLD_AUDIT_ROW = `                <div key={log.id} className="bg-white border border-gray-150 rounded-2xl px-4 py-3.5 shadow-sm">`;

const NEW_AUDIT_ROW = `                <div key={log.id} className="cv-row bg-white border border-gray-150 rounded-2xl px-4 py-3.5 shadow-sm">`;

if (!src.includes(OLD_AUDIT_ROW)) {
  console.error('FIX 3b FAILED: Could not find audit log row className. Already patched?');
  process.exit(1);
}
src = src.replace(OLD_AUDIT_ROW, NEW_AUDIT_ROW);
console.log('✓ FIX 3b applied: cv-row added to audit log rows');

// ─── Write output ─────────────────────────────────────────────────────────────
fs.writeFileSync(filePath, src, 'utf8');
console.log('\n✅ All fixes applied to src/App.tsx');
