#!/usr/bin/env node
// apply-discount-modal-fix.mjs
//
// FIX for a bug introduced by apply-discount-modal-and-loyalty.mjs: the
// Discount button worked (item.discount_type could still be toggled) but
// DiscountPickerModal never visually appeared.
//
// ROOT CAUSE
//   DiscountPickerModal was mounted inside CartItemRow, which lives inside
//   the cart list's `.scrollable` container. That container has
//   `transform: translateZ(0)` (a scroll-perf optimization already in the
//   codebase). Any ancestor with a CSS `transform` becomes a new containing
//   block for `position: fixed` descendants — so the modal's `fixed inset-0`
//   was being positioned/clipped relative to the small scrollable cart
//   panel instead of the viewport, instead of overlaying the whole screen.
//   This is exactly why CartAddonPickerModal was already lifted out of
//   CartItemRow and into POSPage (see the pre-existing comment in the repo:
//   "CartAddonPickerModal is NO LONGER rendered here — it's in POSPage").
//   DiscountPickerModal needs the same treatment.
//
// FIX
//   - POSPage gains `discountPickerFor` state + handleOpenDiscountPicker /
//     handleSelectDiscount, and renders <DiscountPickerModal> itself
//     (same pattern as the existing addonPickerFor / CartAddonPickerModal).
//   - CartItemRow no longer owns modal open/close state — it takes a new
//     `onOpenDiscountPicker` prop and just calls it on tap.
//
// Usage:
//   node apply-discount-modal-fix.mjs            (run from repo root)
//   node apply-discount-modal-fix.mjs --dry-run   (show what would change)
//
// Requires apply-discount-modal-and-loyalty.mjs to have been run first
// (this script's anchors target the code that patch produced). Idempotent:
// safe to run multiple times.

import fs from 'node:fs'
import path from 'node:path'

const DRY_RUN = process.argv.includes('--dry-run')
const ROOT = process.cwd()
const APP_FILE = path.join(ROOT, 'src', 'App.tsx')

let anyChange = false
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
    if (edit.already && content.includes(edit.already)) {
      console.log(`  • ${edit.label}: already applied, skipping`)
      continue
    }
    const next = applyOnce(content, edit.find, edit.replace, edit.label)
    if (next === null) {
      console.log(`  ⚠ ${edit.label}: anchor not found (already applied differently, base patch not run yet, or file has changed) — skipping`)
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

console.log('── src/App.tsx ──')
patchFile(APP_FILE, [
  {
    label: `POSPage: add discountPickerFor state`,
    already: `discountPickerFor`,
    find: `  const [addonPickerFor, setAddonPickerFor] = useState<{
    cartKey: string;
    currentAddons: CartAddon[];
    categoryId: string | null;
  } | null>(null);`,
    replace: `  const [addonPickerFor, setAddonPickerFor] = useState<{
    cartKey: string;
    currentAddons: CartAddon[];
    categoryId: string | null;
  } | null>(null);
  // Discount picker modal must be rendered here (POSPage), NOT inside
  // CartItemRow — CartItemRow lives inside the cart list's \`.scrollable\`
  // container, which has \`transform: translateZ(0)\` for scroll perf. Any
  // ancestor with a \`transform\` becomes a new containing block for
  // \`position: fixed\` descendants, so a modal mounted inside it gets
  // clipped/mispositioned to that container instead of covering the
  // viewport. Same reason CartAddonPickerModal lives here instead of in
  // CartItemRow (see the FIX comment near addonPickerFor above).
  const [discountPickerFor, setDiscountPickerFor] = useState<{
    cartKey: string;
    activeType: CartItem['discount_type'];
  } | null>(null);`,
  },
  {
    label: `POSPage: add handleOpenDiscountPicker / handleSelectDiscount`,
    already: `handleOpenDiscountPicker`,
    find: `  const handleOpenAddonPicker = useCallback((cartKey: string, currentAddons: CartAddon[], categoryId: string | null) => {
    setAddonPickerFor({ cartKey, currentAddons, categoryId });
  }, []);`,
    replace: `  const handleOpenAddonPicker = useCallback((cartKey: string, currentAddons: CartAddon[], categoryId: string | null) => {
    setAddonPickerFor({ cartKey, currentAddons, categoryId });
  }, []);

  const handleOpenDiscountPicker = useCallback((cartKey: string, activeType: CartItem['discount_type']) => {
    setDiscountPickerFor({ cartKey, activeType });
  }, []);
  const setDiscountAction = useCartStore(s => s.setDiscount);
  const handleSelectDiscount = useCallback((type: Exclude<CartItem['discount_type'], null>) => {
    setDiscountPickerFor(prev => {
      if (!prev) return prev;
      setDiscountAction(prev.cartKey, prev.activeType === type ? null : type);
      return null;
    });
  }, [setDiscountAction]);`,
  },
  {
    label: `POSPage: pass onOpenDiscountPicker to CartItemRow`,
    already: `onOpenDiscountPicker={handleOpenDiscountPicker}`,
    find: `    allAddons={allAddons}
    discountDisabled={categories.find((c: Category) => c.id === item.category_id)?.discount_disabled ?? false}
    onOpenAddonPicker={handleOpenAddonPicker}
  />`,
    replace: `    allAddons={allAddons}
    discountDisabled={categories.find((c: Category) => c.id === item.category_id)?.discount_disabled ?? false}
    onOpenAddonPicker={handleOpenAddonPicker}
    onOpenDiscountPicker={handleOpenDiscountPicker}
  />`,
  },
  {
    label: `POSPage: render DiscountPickerModal alongside CartAddonPickerModal`,
    already: `discountPickerFor && (
        <DiscountPickerModal`,
    find: `      onClose={() => setAddonPickerFor(null)}
    />
  )}
    </div>
  );
}`,
    replace: `      onClose={() => setAddonPickerFor(null)}
    />
  )}
      {discountPickerFor && (
        <DiscountPickerModal
          activeType={discountPickerFor.activeType}
          onSelect={handleSelectDiscount}
          onClose={() => setDiscountPickerFor(null)}
        />
      )}
    </div>
  );
}`,
  },
  {
    label: `CartItemRow: accept onOpenDiscountPicker prop`,
    already: `onOpenDiscountPicker: (cartKey: string, activeType: CartItem['discount_type']) => void;`,
    find: `const CartItemRow = memo(function CartItemRow({
  item,
  allAddons,
  discountDisabled,
  onOpenAddonPicker,
}: {
  item: CartItem;
  allAddons: Addon[];
  discountDisabled?: boolean;
  onOpenAddonPicker: (cartKey: string, currentAddons: CartAddon[], categoryId: string | null) => void;
}) {`,
    replace: `const CartItemRow = memo(function CartItemRow({
  item,
  allAddons,
  discountDisabled,
  onOpenAddonPicker,
  onOpenDiscountPicker,
}: {
  item: CartItem;
  allAddons: Addon[];
  discountDisabled?: boolean;
  onOpenAddonPicker: (cartKey: string, currentAddons: CartAddon[], categoryId: string | null) => void;
  onOpenDiscountPicker: (cartKey: string, activeType: CartItem['discount_type']) => void;
}) {`,
  },
  {
    label: `CartItemRow: drop local discount modal state, delegate to onOpenDiscountPicker`,
    already: `onOpenDiscountPicker(item.cart_key, item.discount_type)`,
    find: `  const removeItem   = useCartStore(s => s.removeItem);
  const updateQty    = useCartStore(s => s.updateQty);
  const setDiscount  = useCartStore(s => s.setDiscount);`,
    replace: `  const removeItem   = useCartStore(s => s.removeItem);
  const updateQty    = useCartStore(s => s.updateQty);`,
  },
  {
    label: `CartItemRow: replace local modal handlers with delegating call`,
    already: `onOpenDiscountPicker(item.cart_key, item.discount_type)`,
    find: `  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const handleOpenDiscountModal  = useCallback(() => setShowDiscountModal(true),  []);
  const handleCloseDiscountModal = useCallback(() => setShowDiscountModal(false), []);
  const handleSelectDiscount = useCallback((type: Exclude<CartItem['discount_type'], null>) => {
    // Selecting the currently-active discount again clears it (toggle behavior,
    // same as the old individual buttons).
    setDiscount(item.cart_key, item.discount_type === type ? null : type);
    setShowDiscountModal(false);
  }, [setDiscount, item.cart_key, item.discount_type]);`,
    replace: `  const handleOpenDiscountModal = useCallback(
    () => onOpenDiscountPicker(item.cart_key, item.discount_type),
    [onOpenDiscountPicker, item.cart_key, item.discount_type]
  );`,
  },
  {
    label: `CartItemRow: remove local DiscountPickerModal render (now in POSPage)`,
    already: `DiscountPickerModal and CartAddonPickerModal are NOT rendered here`,
    find: `      {showDiscountModal && (
        <DiscountPickerModal
          activeType={item.discount_type}
          onSelect={handleSelectDiscount}
          onClose={handleCloseDiscountModal}
        />
      )}
      {/* CartAddonPickerModal is NO LONGER rendered here — it's in POSPage */}
    </article>
  );
});`,
    replace: `      {/* DiscountPickerModal and CartAddonPickerModal are NOT rendered here —
          both live in POSPage. CartItemRow sits inside the cart list's
          \`.scrollable\` container (transform: translateZ(0) for scroll perf),
          and a fixed-position modal mounted inside a transformed ancestor
          gets contained/clipped to that ancestor instead of the viewport. */}
    </article>
  );
});`,
  },
])

console.log('\n' + '─'.repeat(60))
if (DRY_RUN) {
  console.log(anyChange ? 'Dry run complete — changes are pending.' : 'Dry run complete — nothing to change.')
} else if (anyChange) {
  console.log('✓ Done. Next: npm run build, then review the diff and commit.')
} else {
  console.log('Nothing changed — everything was already applied (or the base patch hasn\'t been run yet).')
}
