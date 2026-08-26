#!/usr/bin/env node
// apply-fix19.mjs
//
// Root cause (confirmed against the schema/migration comments):
//   - worker/src/index.ts categories.discount_disabled column comment:
//       "when true, SC/PWD/manual discounts are blocked for every item"
//   - worker/migrations/0004_category_discount_disabled.sql comment:
//       "Add a per-category flag to disable SC/PWD/manual discounts"
// Neither ever says p10 (the flat -₱10 discount). p10 was added later in
// migration 0006 and got wired into the SAME categoryBlocksDiscount gate
// as sc/pwd/manual, as a copy-paste oversight — not a deliberate design
// choice. So on any category flagged "No Discount", the server silently
// zeroes out an item's -₱10 discount even though the client (menuData /
// blockedDiscountLines) may — correctly, per the documented scope — not
// treat p10 as blocked at all, or the two can drift out of sync. Either
// way, the fix is the same: p10 should never be gated by a category's
// discount_disabled flag, matching what the column was actually built
// for.
//
// This patch:
//   1. Server (worker/src/index.ts): computes p10 BEFORE and OUTSIDE the
//      categoryBlocksDiscount check, so it always applies regardless of
//      the category's "No Discount" flag.
//   2. Client (src/App.tsx): blockedDiscountLines and clearBlockedDiscounts
//      no longer treat a p10 line as blocked by categoryDiscountDisabled,
//      so the pre-checkout guard and the mismatch-retry handler agree
//      with the server and won't strip a valid -₱10 discount or loop on
//      a false mismatch.
//
// v2: matches ignoring CRLF vs LF line endings (Windows checkouts of this
// repo commonly have CRLF), and writes the file back using whichever line
// ending the file already used, so line endings are never changed.
//
// Usage:
//   node apply-fix19.mjs /path/to/MW-POS

import fs from 'node:fs';
import path from 'node:path';

const repoArg = process.argv[2];
if (!repoArg) {
  console.error('Usage: node apply-fix19.mjs /path/to/MW-POS');
  process.exit(1);
}

const repoRoot = path.resolve(repoArg);
const workerFile = path.join(repoRoot, 'worker', 'src', 'index.ts');
const appFile = path.join(repoRoot, 'src', 'App.tsx');

for (const f of [workerFile, appFile]) {
  if (!fs.existsSync(f)) {
    console.error(`Could not find: ${f}`);
    console.error('Make sure the path points at the root of your MW-POS checkout.');
    process.exit(1);
  }
}

// ── line-ending-agnostic patch helper ───────────────────────────────
// Reads the file, detects whether it's predominantly CRLF or LF,
// normalizes both the file content and the search/replace blocks to LF
// for matching, then writes the result back using the file's original
// line ending so nothing about the file's format changes underneath you.
function applyBlock(filePath, oldBlockLF, newBlockLF, label) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const usesCRLF = (raw.match(/\r\n/g) || []).length > (raw.length / 200); // predominant check
  const normalized = raw.replace(/\r\n/g, '\n');

  if (!normalized.includes(oldBlockLF)) {
    console.error(`Could not find the expected block for: ${label}`);
    console.error(`  File: ${filePath}`);
    console.error('  The file may have changed since this patch was written.');
    return { ok: false, wrote: false };
  }

  const patchedNormalized = normalized.replace(oldBlockLF, newBlockLF);
  const finalContent = usesCRLF ? patchedNormalized.replace(/\n/g, '\r\n') : patchedNormalized;

  fs.writeFileSync(filePath, finalContent, 'utf8');
  return { ok: true, wrote: true };
}

let anyFailure = false;

// ════════════════════════════════════════════════════════════════
// 1) worker/src/index.ts — stop gating p10 on categoryBlocksDiscount
// ════════════════════════════════════════════════════════════════
{
  const oldBlock = `    const categoryBlocksDiscount = discountDisabledByItemId.get(item.item_id) === true
    let discAmt = 0
    if (categoryBlocksDiscount) {
      discAmt = 0
    } else if (item.discount_type === 'sc') discAmt = Math.min(scAmt, itemBase)
    else if (item.discount_type === 'pwd') discAmt = Math.min(pwdAmt, itemBase)
    else if (item.discount_type === 'p15') discAmt = itemBase * 0.15
    else if (item.discount_type === 'p100') discAmt = itemBase
    else if (item.discount_type === 'p10') discAmt = Math.min(10, itemBase)
    else if (item.discount_pct > 0) discAmt = itemBase * (item.discount_pct / 100)`;

  const newBlock = `    const categoryBlocksDiscount = discountDisabledByItemId.get(item.item_id) === true
    let discAmt = 0
    // FIX #19: categories.discount_disabled was built to gate SC/PWD/
    // manual discounts only (see column comment above and migration
    // 0004) — p10 (-₱10) is a flat promo discount and was never meant
    // to be blockable by that flag. It must be computed before/outside
    // the categoryBlocksDiscount check so a "No Discount" category
    // doesn't silently zero it out.
    if (item.discount_type === 'p10') {
      discAmt = Math.min(10, itemBase)
    } else if (categoryBlocksDiscount) {
      discAmt = 0
    } else if (item.discount_type === 'sc') discAmt = Math.min(scAmt, itemBase)
    else if (item.discount_type === 'pwd') discAmt = Math.min(pwdAmt, itemBase)
    else if (item.discount_type === 'p15') discAmt = itemBase * 0.15
    else if (item.discount_type === 'p100') discAmt = itemBase
    else if (item.discount_pct > 0) discAmt = itemBase * (item.discount_pct / 100)`;

  const result = applyBlock(workerFile, oldBlock, newBlock, 'server checkout discount computation');
  if (result.ok) {
    console.log('✅ Patched worker/src/index.ts (server checkout computation)');
  } else {
    anyFailure = true;
  }
}

// ════════════════════════════════════════════════════════════════
// 2) src/App.tsx — blockedDiscountLines / clearBlockedDiscounts
// ════════════════════════════════════════════════════════════════
{
  const oldBlocked = `  const blockedDiscountLines = useMemo(
    () => cartItems.filter(i =>
      (i.discount_type != null || i.discount_pct > 0) &&
      i.category_id != null &&
      categoryDiscountDisabled.get(i.category_id) === true
    ),
    [cartItems, categoryDiscountDisabled]
  );`;

  const newBlocked = `  const blockedDiscountLines = useMemo(
    // FIX #19: p10 (-₱10) is a flat promo discount, not the SC/PWD/
    // manual discount categories.discount_disabled was built to gate
    // (see server-side comment). Exclude p10 lines here so this guard
    // agrees with the server and doesn't block/strip a valid discount.
    () => cartItems.filter(i =>
      (i.discount_type != null || i.discount_pct > 0) &&
      i.discount_type !== 'p10' &&
      i.category_id != null &&
      categoryDiscountDisabled.get(i.category_id) === true
    ),
    [cartItems, categoryDiscountDisabled]
  );`;

  const result1 = applyBlock(appFile, oldBlocked, newBlocked, 'blockedDiscountLines');
  if (result1.ok) {
    console.log('✅ Patched src/App.tsx (blockedDiscountLines)');
  } else {
    anyFailure = true;
  }

  const oldClear = `    for (const item of cartItems) {
      const isDiscounted = item.discount_type != null || item.discount_pct > 0;
      if (isDiscounted && item.category_id != null && disabledMap.get(item.category_id) === true) {
        setDiscountAction(item.cart_key, null);
        cleared.push(item.item_name);
      }
    }`;

  const newClear = `    for (const item of cartItems) {
      const isDiscounted = item.discount_type != null || item.discount_pct > 0;
      // FIX #19: don't strip a valid p10 (-₱10) discount — it's exempt
      // from categories.discount_disabled, same reasoning as
      // blockedDiscountLines above.
      if (isDiscounted && item.discount_type !== 'p10' && item.category_id != null && disabledMap.get(item.category_id) === true) {
        setDiscountAction(item.cart_key, null);
        cleared.push(item.item_name);
      }
    }`;

  // Re-read since the file may have just been written by the block above.
  const result2 = applyBlock(appFile, oldClear, newClear, 'clearBlockedDiscounts');
  if (result2.ok) {
    console.log('✅ Patched src/App.tsx (clearBlockedDiscounts)');
  } else {
    anyFailure = true;
  }
}

if (anyFailure) {
  console.error('');
  console.error('One or more blocks were not found — see errors above. Any block that');
  console.error('DID match was still applied and saved. No changes were made for blocks');
  console.error('that failed to match.');
  process.exit(1);
}

console.log('');
console.log('Summary: -₱10 (p10) discounts now always apply, regardless of a');
console.log('category\'s "No Discount" toggle — matching what that flag was');
console.log('actually documented to gate (SC/PWD/manual discounts only).');
console.log('');
console.log('Known follow-up (not included in this patch, cosmetic only):');
console.log('  CartItemRow still hides the whole "Discount" button and shows');
console.log('  "Not available for this category" for ANY item in a "No Discount"');
console.log('  category — including p10. That\'s a UI-only limitation now (it no');
console.log('  longer affects checkout correctness): a cashier just can\'t open the');
console.log('  picker to pick -₱10 on such an item from the cart row. If you want');
console.log('  p10 selectable there too, that needs a small follow-up threading a');
console.log('  per-discount-type disabled list into DiscountPickerModal — happy to');
console.log('  do that next if you want it.');
console.log('');
console.log('Next steps:');
console.log('  1. cd into the repo and run: npx tsc --noEmit (both src/ and worker/)');
console.log('  2. Redeploy the worker: npx wrangler deploy');
console.log('  3. Rebuild/redeploy the frontend');
console.log('  4. Re-test: apply -₱10 on an item whose category has "No Discount"');
console.log('     toggled on, and confirm checkout succeeds with the ₱10 off.');
