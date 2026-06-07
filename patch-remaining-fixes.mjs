/**
 * patch-remaining-fixes.mjs
 * Fixes 4 remaining issues in MW-POS:
 *   Fix 1 — Note debounce ref never nulled → textarea stuck after checkout
 *   Fix 2 — Addon price in sales detail shows per-unit instead of total
 *   Fix 3 — Force-logout path skips queryClient.clear()
 *   Fix 4 — Remove dead 'admin_inventory' from Page type union
 *
 * Usage:  node patch-remaining-fixes.mjs
 * Safe:   backs up every touched file to *.remaining-fix-bak before editing
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// ─── helpers ────────────────────────────────────────────────────────────────

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function write(rel, content) {
  fs.writeFileSync(path.join(ROOT, rel), content, 'utf8');
}

function backup(rel) {
  const src = path.join(ROOT, rel);
  fs.copyFileSync(src, src + '.remaining-fix-bak');
}

function applyFix(label, rel, oldStr, newStr) {
  const content = read(rel);
  if (!content.includes(oldStr)) {
    console.error(`❌  ${label}: pattern NOT found in ${rel} — skipping`);
    return false;
  }
  if (content.indexOf(oldStr) !== content.lastIndexOf(oldStr)) {
    console.error(`❌  ${label}: pattern matched MORE THAN ONCE in ${rel} — skipping (unsafe)`);
    return false;
  }
  backup(rel);
  write(rel, content.replace(oldStr, newStr));
  console.log(`✅  ${label}`);
  return true;
}

// ─── Fix 1 — Note debounce ref never cleared ────────────────────────────────
// After the timer fires it calls cart.setNote() but leaves the ref holding a
// stale timer ID (truthy). The guard `if (!noteDebounceRef.current)` then
// permanently prevents re-syncing the textarea from cart state, so after
// checkout clears the cart the old note stays visible.
// Fix: null the ref inside the timer callback so the guard resets correctly.

applyFix(
  'Fix 1 — null noteDebounceRef after timer fires',
  'src/App.tsx',
  `noteDebounceRef.current = setTimeout(() => cart.setNote(val), 300);`,
  `noteDebounceRef.current = setTimeout(() => {
      cart.setNote(val);
      noteDebounceRef.current = null; // reset so guard re-arms for next sync
    }, 300);`,
);

// ─── Fix 2 — Addon price in sales detail panel shows per-unit ────────────────
// Receipt (line 704) correctly multiplies addon_price * qty, but the sales
// detail side panel just shows addon_price alone. For addons with qty > 1
// this displays half (or less) of the actual charged amount.

applyFix(
  'Fix 2 — multiply addon_price by qty in sales detail panel',
  'src/App.tsx',
  `<span>+ {a.addon_name}</span><span>{fmt(a.addon_price)}</span>`,
  `<span>+ {a.addon_name}</span><span>{fmt(a.addon_price * a.qty)}</span>`,
);

// ─── Fix 3 — Force-logout path skips queryClient.clear() ─────────────────────
// The manual logout button correctly calls queryClient.clear() before logout().
// But the automatic 401/403 force-logout path (App component, useEffect) calls
// logout() directly, leaving stale React Query cache behind. On a shared POS
// terminal the next user could briefly see the previous user's data.
// Fix: add useQueryClient() hook to App() and clear cache on force-logout.

applyFix(
  'Fix 3a — add useQueryClient hook to App()',
  'src/App.tsx',
  `export default function App() {
  const { user, token, logout } = useAuthStore()`,
  `export default function App() {
  const { user, token, logout } = useAuthStore()
  const queryClient = useQueryClient()`,
);

applyFix(
  'Fix 3b — clear cache before force-logout on 401/403',
  'src/App.tsx',
  `.then(res => { if (res.status === 401 || res.status === 403) logout() })`,
  `.then(res => { if (res.status === 401 || res.status === 403) { queryClient.clear(); logout() } })`,
);

// ─── Fix 4 — Remove dead 'admin_inventory' from Page type union ──────────────
// 'admin_inventory' is declared in the Page union but has no corresponding
// component or AppShell case. Navigating to it would silently fall through to
// the default (POSPage). Removing it makes the type accurate and prevents any
// accidental navigation to a non-existent page.

applyFix(
  'Fix 4 — remove dead admin_inventory from Page union',
  'src/types.ts',
  `  | 'admin_inventory'\n`,
  ``,
);

// ─── summary ────────────────────────────────────────────────────────────────

console.log(`
─────────────────────────────────────────────
Next steps:
  1. npm run build          (verify TypeScript compiles clean)
  2. npx cap sync android
  3. cd android && .\\gradlew clean assembleRelease

Backups written to *.remaining-fix-bak — delete when happy.
─────────────────────────────────────────────
`);
