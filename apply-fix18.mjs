#!/usr/bin/env node
/**
 * apply-fix18.mjs
 *
 * Second, separate cause of the same "Payment total (X) does not match
 * order total (Y)" symptom, still reproducible after fix17.
 *
 * fix17 fixed staleness in `categories` (the discount_disabled flag) by
 * refetching the menu on mismatch and stripping discounts that are now
 * blocked. But there is a SECOND independent stale-data source feeding
 * the same total: the SC/PWD flat-peso discount amount, which lives in
 * `useSettings()` (query key ['settings']) — a completely different
 * query from `useMenu()` — and inherits the same 5-min staleTime /
 * disabled focus-refetch from the global QueryClient default (main.tsx).
 *
 * Cart lines with discount_type 'sc' or 'pwd' compute their
 * discount_amount from `scPct`/`pwdPct` in the Zustand cart store (see
 * computeItemTotals in store.ts). Those are synced from `useSettings()`
 * via a useEffect that calls `cart.setDiscountPcts(sc, pwd)` — but
 * setDiscountPcts only overwrites the two numbers in the store; it does
 * NOT recompute existing cart lines. So if an admin changes the SC/PWD
 * peso amount from another terminal, an already-added SC/PWD line keeps
 * computing its old discount_amount client-side until that specific line
 * is touched again (qty change, addon change, discount re-picked) —
 * which a cashier mid-checkout has no reason to do. The server always
 * recomputes from the live setting and rejects with the same kind of
 * mismatch fix17 was built for, but fix17's recovery path only looks at
 * `categories`, never at `settings`, so it silently finds nothing to
 * clear and falls back to the generic "please re-check" toast forever.
 *
 * Fix, two parts:
 *
 *  1. store.ts: setDiscountPcts now recomputes discount_amount/line_total
 *     for every existing cart line whenever scPct/pwdPct change, instead
 *     of only touching future computeItemTotals() calls.
 *
 *  2. App.tsx: the checkout mismatch handler now also refetches settings
 *     (in parallel with the fix17 menu refetch) and re-applies them via
 *     setDiscountPcts — which, after part 1, immediately recomputes any
 *     SC/PWD lines against the live rate. The toast is extended to cover
 *     this case too.
 *
 * Usage: node apply-fix18.mjs /path/to/MW-POS
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const target = process.argv[2];
if (!target) {
  console.error('Usage: node apply-fix18.mjs /path/to/MW-POS');
  process.exit(1);
}

const appPath = join(target, 'src', 'App.tsx');
const storePath = join(target, 'src', 'store.ts');
for (const [label, p] of [['src/App.tsx', appPath], ['src/store.ts', storePath]]) {
  if (!existsSync(p)) {
    console.error(`Could not find ${label} under ${target}`);
    process.exit(1);
  }
}

let appSrc = readFileSync(appPath, 'utf8');
let storeSrc = readFileSync(storePath, 'utf8');
let applied = 0;

function replaceOnce(fileLabel, getSrc, setSrc, label, oldStr, newStr) {
  const src = getSrc();
  const idx = src.indexOf(oldStr);
  if (idx === -1) {
    console.error(`FAILED (${fileLabel}): could not find anchor for "${label}". File may have changed — aborting without writing.`);
    process.exit(1);
  }
  const second = src.indexOf(oldStr, idx + oldStr.length);
  if (second !== -1) {
    console.error(`FAILED (${fileLabel}): anchor for "${label}" is not unique. Aborting without writing.`);
    process.exit(1);
  }
  setSrc(src.slice(0, idx) + newStr + src.slice(idx + oldStr.length));
  applied++;
  console.log(`applied [${fileLabel}]: ${label}`);
}

// ── store.ts: 1. make setDiscountPcts recompute existing lines ────────────
replaceOnce(
  'src/store.ts', () => storeSrc, (s) => { storeSrc = s; },
  'setDiscountPcts recomputes existing cart lines',
  "  setDiscountPcts: (sc, pwd) => set({ scPct: sc, pwdPct: pwd }),",
  [
    "  // FIX #18: previously this only overwrote scPct/pwdPct — existing",
    "  // cart lines keep whatever discount_amount they were computed with",
    "  // until something else touches that line (qty/addon/discount change).",
    "  // If an admin changes the SC/PWD peso amount from another terminal",
    "  // while a line using 'sc' or 'pwd' is already in the cart, the",
    "  // client total silently drifts from what the server will compute.",
    "  // Recompute every line immediately so the two rates and the",
    "  // displayed total can never disagree.",
    "  setDiscountPcts: (sc, pwd) => set((state) => ({",
    "    scPct: sc,",
    "    pwdPct: pwd,",
    "    cart: {",
    "      ...state.cart,",
    "      items: state.cart.items.map((i) => computeItemTotals(i, sc, pwd)),",
    "    },",
    "  })),",
  ].join('\n')
);

// ── App.tsx: 2a. pull useSettings' refetch + setDiscountPcts action ───────
replaceOnce(
  'src/App.tsx', () => appSrc, (s) => { appSrc = s; },
  'wire up settings refetch + setDiscountPcts in CheckoutModal',
  [
    "  const checkout         = useCheckout();",
    "  const { data: settings } = useSettings();",
    "  const total            = useCartTotal();",
  ].join('\n'),
  [
    "  const checkout         = useCheckout();",
    "  // FIX #18: refetch + setDiscountPcts pulled in so the mismatch",
    "  // handler below can re-sync scPct/pwdPct against a LIVE read, not",
    "  // just the 5-min-stale cached value — see setDiscountPcts's own",
    "  // comment in store.ts for why that alone is now enough to fix",
    "  // already-added SC/PWD lines.",
    "  const { data: settings, refetch: refetchSettings } = useSettings();",
    "  const setDiscountPctsAction = useCartStore(s => s.setDiscountPcts);",
    "  const total            = useCartTotal();",
  ].join('\n')
);

// ── App.tsx: 2b. extend the mismatch handler to also refresh settings ─────
replaceOnce(
  'src/App.tsx', () => appSrc, (s) => { appSrc = s; },
  'extend mismatch handler to cover stale SC/PWD settings',
  [
    "        const freshResult = await refetchMenu();",
    "        const cleared = clearBlockedDiscounts(freshResult.data?.categories);",
    "        if (cleared.length > 0) {",
    "          toast(`Discount removed from \"${cleared[0]}\"${cleared.length > 1 ? ` and ${cleared.length - 1} other item(s)` : ''} — discounts are disabled for its category. Totals updated, please re-check and confirm.`, 'error');",
    "        } else {",
    "          toast('Discount rules changed for one or more items — totals were refreshed. Please re-check the amount and try again.', 'error');",
    "        }",
  ].join('\n'),
  [
    "        const [freshResult, freshSettings] = await Promise.all([refetchMenu(), refetchSettings()]);",
    "        const cleared = clearBlockedDiscounts(freshResult.data?.categories);",
    "        // FIX #18: also re-sync scPct/pwdPct from a live settings read.",
    "        // setDiscountPctsAction recomputes every cart line's totals as",
    "        // part of this call (see store.ts), so an SC/PWD line whose",
    "        // peso amount changed on another terminal is corrected here too,",
    "        // not just lines blocked by a category's discount_disabled flag.",
    "        const prevScPct = useCartStore.getState().scPct;",
    "        const prevPwdPct = useCartStore.getState().pwdPct;",
    "        const nextScPct = parseFloat(freshSettings.data?.sc_discount_pct ?? String(prevScPct));",
    "        const nextPwdPct = parseFloat(freshSettings.data?.pwd_discount_pct ?? String(prevPwdPct));",
    "        const scPwdChanged = nextScPct !== prevScPct || nextPwdPct !== prevPwdPct;",
    "        if (scPwdChanged) setDiscountPctsAction(nextScPct, nextPwdPct);",
    "        if (cleared.length > 0 && scPwdChanged) {",
    "          toast(`Discount rules changed for \"${cleared[0]}\" and possibly other items — totals were refreshed. Please re-check and confirm.`, 'error');",
    "        } else if (cleared.length > 0) {",
    "          toast(`Discount removed from \"${cleared[0]}\"${cleared.length > 1 ? ` and ${cleared.length - 1} other item(s)` : ''} — discounts are disabled for its category. Totals updated, please re-check and confirm.`, 'error');",
    "        } else if (scPwdChanged) {",
    "          toast('The senior/PWD discount amount changed — totals were refreshed. Please re-check the amount and try again.', 'error');",
    "        } else {",
    "          toast('Discount rules changed for one or more items — totals were refreshed. Please re-check the amount and try again.', 'error');",
    "        }",
  ].join('\n')
);

// ── App.tsx: 2c. dependency array needs the new refs ───────────────────────
replaceOnce(
  'src/App.tsx', () => appSrc, (s) => { appSrc = s; },
  'add new refs to doCheckout dependency array',
  [
    "  }, [user, cartItems, cartNote, cartIdempotency, discountTotal, cartSubtotal,",
    "      checkout, shift, hasCash, tendered, tenderedNum, payments, refetchMenu,",
    "      blockedDiscountLines, clearBlockedDiscounts]);",
  ].join('\n'),
  [
    "  }, [user, cartItems, cartNote, cartIdempotency, discountTotal, cartSubtotal,",
    "      checkout, shift, hasCash, tendered, tenderedNum, payments, refetchMenu,",
    "      blockedDiscountLines, clearBlockedDiscounts, refetchSettings, setDiscountPctsAction]);",
  ].join('\n')
);

writeFileSync(storePath, storeSrc, 'utf8');
writeFileSync(appPath, appSrc, 'utf8');
console.log(`\nDone. ${applied} block(s) patched across src/store.ts and src/App.tsx`);
console.log('Next: cd into the repo and run `npx tsc --noEmit` to confirm it compiles.');
