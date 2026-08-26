#!/usr/bin/env node
/**
 * apply-fix17.mjs
 *
 * Bug: the FIX #16 mismatch handler refetches the menu and tells the
 * cashier "totals were refreshed", but it never actually removes the
 * now-disallowed discount from the cart line. `total` / `cartSubtotal` /
 * `discountTotal` / `payments` are all derived purely from cart.items in
 * the Zustand store, which the refetch never touches. So the modal keeps
 * showing the same discounted total, the cashier hits "Confirm Sale"
 * again with the identical cart, and the server rejects it again with
 * the exact same mismatch — it loops forever on that item.
 *
 * Fix: when the server rejects with a totals mismatch, refetch the menu,
 * then use the FRESH result to actually strip the discount from any cart
 * line whose category now has discounts disabled (reusing the existing
 * setDiscount(cart_key, null) store action), resync the single-line cash
 * payment to the corrected total, and tell the cashier which item was
 * affected instead of a generic "re-check and try again".
 *
 * Usage: node apply-fix17.mjs /path/to/MW-POS
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const target = process.argv[2];
if (!target) {
  console.error('Usage: node apply-fix17.mjs /path/to/MW-POS');
  process.exit(1);
}

const appPath = join(target, 'src', 'App.tsx');
if (!existsSync(appPath)) {
  console.error(`Could not find src/App.tsx under ${target}`);
  process.exit(1);
}

let src = readFileSync(appPath, 'utf8');
let applied = 0;

function replaceOnce(label, oldStr, newStr) {
  const idx = src.indexOf(oldStr);
  if (idx === -1) {
    console.error(`FAILED: could not find anchor for "${label}". File may have changed — aborting without writing.`);
    process.exit(1);
  }
  const second = src.indexOf(oldStr, idx + oldStr.length);
  if (second !== -1) {
    console.error(`FAILED: anchor for "${label}" is not unique. Aborting without writing.`);
    process.exit(1);
  }
  src = src.slice(0, idx) + newStr + src.slice(idx + oldStr.length);
  applied++;
  console.log(`applied: ${label}`);
}

// ── 1. Pull the setDiscount store action into CheckoutModal ───────────────
replaceOnce(
  'wire up setDiscount action',
  [
    "  const { data: menuData, refetch: refetchMenu, isFetching: menuChecking } = useMenu();",
    "  const [freshMenuChecked, setFreshMenuChecked] = useState(false);",
  ].join('\n'),
  [
    "  const { data: menuData, refetch: refetchMenu, isFetching: menuChecking } = useMenu();",
    "  const [freshMenuChecked, setFreshMenuChecked] = useState(false);",
    "  // FIX #17: needed so the mismatch handler below can actually strip a",
    "  // disallowed discount off a cart line instead of just refetching and",
    "  // re-toasting (see doCheckout's catch block).",
    "  const setDiscountAction = useCartStore(s => s.setDiscount);",
  ].join('\n')
);

// ── 2. Extract a reusable "clear blocked discounts against fresh data"  ───
//      helper right after blockedDiscountLines is computed.
replaceOnce(
  'add clearBlockedDiscounts helper',
  [
    "  const blockedDiscountLines = useMemo(",
    "    () => cartItems.filter(i =>",
    "      (i.discount_type != null || i.discount_pct > 0) &&",
    "      i.category_id != null &&",
    "      categoryDiscountDisabled.get(i.category_id) === true",
    "    ),",
    "    [cartItems, categoryDiscountDisabled]",
    "  );",
  ].join('\n'),
  [
    "  const blockedDiscountLines = useMemo(",
    "    () => cartItems.filter(i =>",
    "      (i.discount_type != null || i.discount_pct > 0) &&",
    "      i.category_id != null &&",
    "      categoryDiscountDisabled.get(i.category_id) === true",
    "    ),",
    "    [cartItems, categoryDiscountDisabled]",
    "  );",
    "",
    "  // FIX #17: blockedDiscountLines only gates the button + toast — it",
    "  // never touches cart.items, and total/cartSubtotal/discountTotal/",
    "  // payments are all derived purely from cart.items. So after a",
    "  // mismatch + refetch, the cart still carries the disallowed discount",
    "  // and resubmitting fails again with the identical error. This helper",
    "  // takes a FRESH categories list (passed explicitly so it never reads",
    "  // a stale closure over menuData) and actually removes the discount",
    "  // from every line that's now blocked, returning their names.",
    "  const clearBlockedDiscounts = useCallback((freshCategories: Category[] | undefined) => {",
    "    const disabledMap = new Map<string, boolean>();",
    "    for (const cat of freshCategories ?? []) disabledMap.set(cat.id, !!cat.discount_disabled);",
    "    const cleared: string[] = [];",
    "    for (const item of cartItems) {",
    "      const isDiscounted = item.discount_type != null || item.discount_pct > 0;",
    "      if (isDiscounted && item.category_id != null && disabledMap.get(item.category_id) === true) {",
    "        setDiscountAction(item.cart_key, null);",
    "        cleared.push(item.item_name);",
    "      }",
    "    }",
    "    return cleared;",
    "  }, [cartItems, setDiscountAction]);",
  ].join('\n')
);

// ── 3. Make the mismatch handler actually fix the cart, not just refetch ──
replaceOnce(
  'fix mismatch catch handler',
  [
    "      if (/does not match order total/i.test(msg)) {",
    "        // The server rejected our totals — almost always because a",
    "        // category's discount rules changed after we last fetched the",
    "        // menu (see FIX #16 above). Refresh so the client's guard and",
    "        // totals match the server's reality, and tell the cashier what",
    "        // actually happened instead of showing the raw payment-vs-order",
    "        // numbers, which is meaningless to them.",
    "        refetchMenu();",
    "        toast('Discount rules changed for one or more items — totals were refreshed. Please re-check the amount and try again.', 'error');",
    "      } else {",
  ].join('\n'),
  [
    "      if (/does not match order total/i.test(msg)) {",
    "        // The server rejected our totals — almost always because a",
    "        // category's discount rules changed after we last fetched the",
    "        // menu (see FIX #16 above). FIX #17: refetching alone doesn't",
    "        // fix anything — total/payments are derived from cart.items,",
    "        // which the refetch never touches, so retrying would fail the",
    "        // same way forever. Pull the fresh categories directly from the",
    "        // refetch result and strip the discount from every line that's",
    "        // now actually disallowed, so the corrected total is what the",
    "        // cashier sees and resubmits.",
    "        const freshResult = await refetchMenu();",
    "        const cleared = clearBlockedDiscounts(freshResult.data?.categories);",
    "        if (cleared.length > 0) {",
    "          toast(`Discount removed from \"${cleared[0]}\"${cleared.length > 1 ? ` and ${cleared.length - 1} other item(s)` : ''} — discounts are disabled for its category. Totals updated, please re-check and confirm.`, 'error');",
    "        } else {",
    "          toast('Discount rules changed for one or more items — totals were refreshed. Please re-check the amount and try again.', 'error');",
    "        }",
    "      } else {",
  ].join('\n')
);

// ── 4. doCheckout now calls clearBlockedDiscounts and reads
//      blockedDiscountLines — both need to be in its useCallback deps
//      so it never runs a stale closure.
replaceOnce(
  'fix doCheckout dependency array',
  [
    "  }, [user, cartItems, cartNote, cartIdempotency, discountTotal, cartSubtotal,",
    "      checkout, shift, hasCash, tendered, tenderedNum, payments, refetchMenu]);",
  ].join('\n'),
  [
    "  }, [user, cartItems, cartNote, cartIdempotency, discountTotal, cartSubtotal,",
    "      checkout, shift, hasCash, tendered, tenderedNum, payments, refetchMenu,",
    "      blockedDiscountLines, clearBlockedDiscounts]);",
  ].join('\n')
);

writeFileSync(appPath, src, 'utf8');
console.log(`\nDone. ${applied} block(s) patched in ${appPath}`);
console.log('Next: cd into the repo and run `npx tsc --noEmit` to confirm it compiles.');
