#!/usr/bin/env node
// apply-fix16.mjs
//
// Fixes the recurring "Payment total (X) does not match order total (Y)"
// error at checkout (₱10 gap, same shape as before — 55 vs 65 this time).
//
// ROOT CAUSE (this is NOT the same bug as FIX #4, it's the FIX #4 guard
// being undermined by client-side caching):
//   - useMenu() caches category data (incl. `discount_disabled`) with a
//     5-minute staleTime, and window-focus refetching is globally disabled
//     (see main.tsx / api.ts comments) — both intentional for LAN
//     performance.
//   - blockedDiscountLines (FIX #4) checks that CACHED category data.
//   - If an admin flips "discounts disabled" on a category from another
//     terminal, THIS terminal can keep serving stale (discounts-allowed)
//     category data for up to 5 minutes.
//   - Cashier adds a discounted item -> guard passes (stale data says OK)
//     -> client computes a total WITH the discount -> server checks the
//     DB live, applies NO discount -> rejects with a totals mismatch
//     equal to the discount amount.
//
// FIX:
//   1. Force a fresh menu refetch the instant the checkout modal opens,
//      so the guard checks live data at the moment it matters (money
//      changing hands), not whatever was cached minutes ago.
//   2. Disable "Confirm Sale" until that fresh check completes.
//   3. If the server still rejects (admin toggled it *while* the modal
//      was open — a much smaller race), refetch the menu and show the
//      cashier an actionable message instead of the raw "Payment total
//      (X) does not match order total (Y)" string.
//
// Usage:
//   node apply-fix16.mjs [path-to-repo]
//   (defaults to current directory)

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.argv[2] || '.';
const filePath = join(repoRoot, 'src/App.tsx');

let src;
try {
  src = readFileSync(filePath, 'utf8');
} catch (e) {
  console.error(`Could not read ${filePath}: ${e.message}`);
  process.exit(1);
}

let patched = src;
let changes = 0;

// ── 1. Fresh menu fetch on checkout modal open ──────────────────────────
const oldMenuLine = `  const { user } = useAuthStore();
  // FIX #4: needed to check each cart line's category discount_disabled
  // flag before checkout — see blockedDiscountLines below.
  const { data: menuData } = useMenu();`;

const newMenuBlock = `  const { user } = useAuthStore();
  // FIX #4: needed to check each cart line's category discount_disabled
  // flag before checkout — see blockedDiscountLines below.
  //
  // FIX #16: useMenu() is cached with a 5-min staleTime and window-focus
  // refetching is globally disabled (see main.tsx / api.ts), so the
  // category data blockedDiscountLines relies on can be stale on THIS
  // terminal for up to 5 minutes even when it's fresh on the server. If
  // an admin disables discounts on a category from another terminal, a
  // cashier here can still add a "discounted" item, have the (stale)
  // guard let it through, submit a total that includes the discount, and
  // get rejected by the server — which always re-checks live — with a
  // "Payment total (X) does not match order total (Y)" error equal to
  // the discount amount. Force a fresh fetch the moment this modal opens
  // so the guard is checked against live data right before money
  // changes hands.
  const { data: menuData, refetch: refetchMenu, isFetching: menuChecking } = useMenu();
  const [freshMenuChecked, setFreshMenuChecked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    refetchMenu().finally(() => { if (!cancelled) setFreshMenuChecked(true); });
    return () => { cancelled = true; };
    // Only on mount — this modal is remounted each time checkout opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);`;

if (patched.includes(oldMenuLine)) {
  patched = patched.replace(oldMenuLine, newMenuBlock);
  changes++;
} else {
  console.error('✗ Could not find the useMenu() block to patch (step 1). File may already be patched, or has diverged — check manually.');
}

// ── 2. Actionable error handling in doCheckout's catch block ───────────
const oldCatch = `    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Checkout failed', 'error');
    }
  }, [user, cartItems, cartNote, cartIdempotency, discountTotal, cartSubtotal,
      checkout, shift, hasCash, tendered, tenderedNum, payments]);`;

const newCatch = `    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Checkout failed';
      if (/does not match order total/i.test(msg)) {
        // The server rejected our totals — almost always because a
        // category's discount rules changed after we last fetched the
        // menu (see FIX #16 above). Refresh so the client's guard and
        // totals match the server's reality, and tell the cashier what
        // actually happened instead of showing the raw payment-vs-order
        // numbers, which is meaningless to them.
        refetchMenu();
        toast('Discount rules changed for one or more items — totals were refreshed. Please re-check the amount and try again.', 'error');
      } else {
        toast(msg, 'error');
      }
    }
  }, [user, cartItems, cartNote, cartIdempotency, discountTotal, cartSubtotal,
      checkout, shift, hasCash, tendered, tenderedNum, payments, refetchMenu]);`;

if (patched.includes(oldCatch)) {
  patched = patched.replace(oldCatch, newCatch);
  changes++;
} else {
  console.error('✗ Could not find the doCheckout catch block to patch (step 2). File may already be patched, or has diverged — check manually.');
}

// ── 3. Disable "Confirm Sale" until the fresh check completes ──────────
const oldButton = `            <Btn variant="mango" size="lg" onClick={doCheckout}
              disabled={blockedDiscountLines.length > 0 || !balanced || !tenderedOk}
              loading={checkout.isPending} className="flex-[2]">
              Confirm Sale
            </Btn>`;

const newButton = `            <Btn variant="mango" size="lg" onClick={doCheckout}
              disabled={blockedDiscountLines.length > 0 || !balanced || !tenderedOk || !freshMenuChecked || menuChecking}
              loading={checkout.isPending || !freshMenuChecked} className="flex-[2]">
              {!freshMenuChecked ? 'Checking latest prices…' : 'Confirm Sale'}
            </Btn>`;

if (patched.includes(oldButton)) {
  patched = patched.replace(oldButton, newButton);
  changes++;
} else {
  console.error('✗ Could not find the Confirm Sale button to patch (step 3). File may already be patched, or has diverged — check manually.');
}

if (changes === 0) {
  console.error('\nNo changes applied. Nothing was written.');
  process.exit(1);
}

writeFileSync(filePath, patched, 'utf8');
console.log(`✓ Applied ${changes}/3 patch block(s) to ${filePath}`);
if (changes < 3) {
  console.log('  Some blocks were skipped — see ✗ lines above. Re-check those sections manually.');
  process.exit(1);
}
console.log('\nDone. Recommended next steps:');
console.log('  1. cd into your repo, run `npx tsc --noEmit` to confirm it compiles.');
console.log('  2. Test: toggle "discounts disabled" on a category from a second');
console.log('     browser/tab, then open checkout with a discounted item on the');
console.log('     first tab within the 5-min cache window — it should now refetch');
console.log('     and either block the discount immediately or, if the toggle');
console.log('     happens mid-checkout, show a clear "rules changed" message');
console.log('     instead of the raw totals-mismatch error.');
