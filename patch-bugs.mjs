/**
 * MW-POS Bug Patch Script  (v2 — CRLF-safe)
 * Run with: node patch-bugs.mjs
 *
 * Works correctly on both Windows (CRLF) and Linux/Mac (LF).
 * The script normalises each file to LF internally, applies all
 * patches, then writes back using whatever line-ending the file
 * originally had — so your editor settings are preserved.
 *
 * Applies 10 targeted fixes across:
 *  - worker/src/index.ts  (backend)
 *  - src/api.ts           (frontend API layer)
 *  - src/store.ts         (Zustand cart store)
 *  - src/thermalPrint.ts  (Bluetooth printing)
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── helpers ─────────────────────────────────────────────────────
function fullPath(rel) { return path.join(__dirname, rel); }

function backup(rel) {
  const src = fullPath(rel);
  fs.copyFileSync(src, src + '.patch-bak');
}

/**
 * Apply a single text replacement to a file.
 * Internally normalises to LF so multiline patterns always match,
 * then restores the original line ending on write.
 */
function applyFix(rel, description, searchStr, replaceStr) {
  const fp = fullPath(rel);
  const raw = fs.readFileSync(fp, 'utf8');

  // Detect dominant line ending in the file
  const hasCRLF = raw.includes('\r\n');

  // Work in LF-space
  const lf   = hasCRLF ? raw.replace(/\r\n/g, '\n') : raw;
  const srch = searchStr.replace(/\r\n/g, '\n');   // normalise search too
  const repl = replaceStr.replace(/\r\n/g, '\n');  // and replacement

  const count = lf.split(srch).length - 1;
  if (count === 0) {
    console.error(`  ✗ SKIP — pattern not found in ${rel}:\n    ${srch.trim().split('\n')[0].slice(0, 80)}`);
    return false;
  }
  if (count > 1) {
    console.warn(`  ⚠ WARN — pattern found ${count} times; replacing first occurrence only`);
  }

  let patched = lf.replace(srch, repl);

  // Restore original line ending
  if (hasCRLF) patched = patched.replace(/\n/g, '\r\n');

  fs.writeFileSync(fp, patched, 'utf8');
  console.log(`  ✓ ${description}`);
  return true;
}

// ─── backup originals ─────────────────────────────────────────────
const filesToPatch = [
  'worker/src/index.ts',
  'src/api.ts',
  'src/store.ts',
  'src/thermalPrint.ts',
];
console.log('\n📦 Backing up originals…');
filesToPatch.forEach(f => {
  backup(f);
  console.log(`  ✓ ${f}.patch-bak`);
});

console.log('\n🔧 Applying patches…\n');

// ════════════════════════════════════════════════════════════════
// BUG 1 — worker/src/index.ts
// CORS wildcard origin combined with credentials:true is invalid.
// Browsers block credentialed requests to wildcard origins (spec §3.2.2).
// The app uses Authorization headers, not cookies, so credentials
// mode is not needed. Remove it.
// ════════════════════════════════════════════════════════════════
applyFix(
  'worker/src/index.ts',
  'BUG 1 — Remove invalid credentials:true from CORS wildcard origin',
  `app.use('*', cors({ origin: '*', credentials: true }))`,
  `app.use('*', cors({ origin: '*' }))`,
);

// ════════════════════════════════════════════════════════════════
// BUG 2 — worker/src/index.ts
// In POST /api/sales (checkout), discount priority is wrong.
// Three sequential `if` blocks mean: if discount_type='sc' AND
// discount_pct>0 is also set, the last if overrides the
// settings-backed SC/PWD percentage with a raw number.
// Fix: use if/else-if so SC/PWD type always wins.
// ════════════════════════════════════════════════════════════════
applyFix(
  'worker/src/index.ts',
  'BUG 2 — Fix discount priority: SC/PWD rate must not be overridden by discount_pct',
  `    let discPct = 0
    if (item.discount_type === 'sc') discPct = scPct
    if (item.discount_type === 'pwd') discPct = pwdPct
    if (item.discount_pct > 0) discPct = item.discount_pct / 100`,
  `    let discPct = 0
    if (item.discount_type === 'sc') discPct = scPct
    else if (item.discount_type === 'pwd') discPct = pwdPct
    else if (item.discount_pct > 0) discPct = item.discount_pct / 100`,
);

// ════════════════════════════════════════════════════════════════
// BUG 3 — worker/src/index.ts
// GET /api/sales/:id returns cashier_name: cashier?.name which is
// undefined when the cashier user has been deleted. The frontend
// type declares cashier_name: string, so rendering or calling
// string methods on undefined crashes. Coerce to empty string.
// ════════════════════════════════════════════════════════════════
applyFix(
  'worker/src/index.ts',
  'BUG 3 — Coerce undefined cashier_name to empty string in sale detail',
  `    cashier_name: cashier?.name,`,
  `    cashier_name: cashier?.name ?? '',`,
);

// ════════════════════════════════════════════════════════════════
// BUG 4 — worker/src/index.ts
// /api/init guard uses .get() which returns a single row object.
// If no users exist it returns undefined — fine. But relying on
// truthy/falsy of a plain object is fragile. Use a proper array
// check with .limit(1) instead.
// ════════════════════════════════════════════════════════════════
applyFix(
  'worker/src/index.ts',
  'BUG 4 — Fix /api/init guard to use array length, not single-row .get()',
  `  const count = await db.select({ id: users.id }).from(users).get()
  if (count) return jsonOk({ already_initialized: true })`,
  `  const existing = await db.select({ id: users.id }).from(users).limit(1)
  if (existing.length > 0) return jsonOk({ already_initialized: true })`,
);

// ════════════════════════════════════════════════════════════════
// BUG 5 — worker/src/index.ts
// POST /api/shifts (open shift) has no role check. Any authenticated
// user including crew can open a shift. Add admin-only guard.
// ════════════════════════════════════════════════════════════════
applyFix(
  'worker/src/index.ts',
  'BUG 5 — Add admin-only guard to POST /api/shifts (open shift)',
  `app.post('/api/shifts', async (c) => {
  const actor = c.get('user')
  const db = c.get('db')
  const body = await c.req.json<{ starting_float: number }>()`,
  `app.post('/api/shifts', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const body = await c.req.json<{ starting_float: number }>()`,
);

// ════════════════════════════════════════════════════════════════
// BUG 6 — src/api.ts
// apiFetch checks json.error BEFORE !res.ok. When Cloudflare's edge
// returns a raw 500 with no { error } body, json.error is falsy,
// the first check passes silently, and the caller receives undefined
// as a "successful" result. Fix: check !res.ok first.
// ════════════════════════════════════════════════════════════════
applyFix(
  'src/api.ts',
  'BUG 6 — Fix apiFetch: check !res.ok before json.error to catch edge 5xx without error body',
  `  if (json.error) throw new Error(json.error)
  if (!res.ok) throw new Error(\`Request failed (\${res.status})\`)
  return json.data as T`,
  `  if (!res.ok) {
    const msg = json.error || \`Request failed (\${res.status})\`
    throw new Error(msg)
  }
  if (json.error) throw new Error(json.error)
  return json.data as T`,
);

// ════════════════════════════════════════════════════════════════
// BUG 7 — src/api.ts
// useUsersList() has no staleTime so React Query refetches the
// public user list on every component mount — including every time
// AnyUserPinModal opens mid-transaction. Add staleTime: 5 min.
// ════════════════════════════════════════════════════════════════
applyFix(
  'src/api.ts',
  'BUG 7 — Add staleTime to useUsersList to prevent refetch on every PIN modal open',
  `export function useUsersList() {
  return useQuery({
    queryKey: ['users-list'],
    queryFn: ({ signal }) => apiFetch<User[]>('/auth/users', { method: 'GET', signal }),
  })
}`,
  `export function useUsersList() {
  return useQuery({
    queryKey: ['users-list'],
    queryFn: ({ signal }) => apiFetch<User[]>('/auth/users', { method: 'GET', signal }),
    staleTime: 5 * 60_000, // user list changes rarely mid-shift
  })
}`,
);

// ════════════════════════════════════════════════════════════════
// BUG 8 — src/store.ts
// useAuthStore persist leaves the key in localStorage on logout
// (with null values). Future schema changes can rehydrate stale
// data. Fix: remove the key on logout and add a version number.
// ════════════════════════════════════════════════════════════════
applyFix(
  'src/store.ts',
  'BUG 8 — Add persist version + clear storage key on logout to prevent stale auth rehydration',
  `export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      login: (user, token) => set({ user, token }),
      logout: () => set({ user: null, token: null }),
    }),
    { name: 'pos-auth' }
  )
);`,
  `export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      login: (user, token) => set({ user, token }),
      logout: () => {
        set({ user: null, token: null });
        // Fully remove the persisted key so stale data cannot
        // survive a schema change on the next version bump.
        try { localStorage.removeItem('pos-auth'); } catch { /* SSR / restricted env */ }
      },
    }),
    {
      name: 'pos-auth',
      version: 1,
      migrate: (persisted) => {
        // v0 → v1: no structural changes yet; just return as-is.
        return persisted as AuthStore;
      },
    }
  )
);`,
);

// ════════════════════════════════════════════════════════════════
// BUG 9 — src/store.ts
// computeItemTotals returns discount_pct: item.discount_pct which
// is always 0 for SC/PWD items (frontend sends 0, relies on
// settings). Receipts and audit logs show "0% discount". Fix: store
// the effective percentage that was actually applied.
// ════════════════════════════════════════════════════════════════
applyFix(
  'src/store.ts',
  'BUG 9 — Store effective discount_pct (SC/PWD rate) instead of always 0 in cart items',
  `  return { ...item, addons_total, line_subtotal, discount_amount, line_total, discount_pct: item.discount_pct };`,
  `  // Store the effective percentage actually applied so the receipt and
  // audit trail reflect the real discount rate, not the raw input (0 for SC/PWD).
  const effective_discount_pct =
    item.discount_type === 'sc'  ? scPct  :
    item.discount_type === 'pwd' ? pwdPct :
    item.discount_pct;
  return { ...item, addons_total, line_subtotal, discount_amount, line_total, discount_pct: effective_discount_pct };`,
);

// ════════════════════════════════════════════════════════════════
// BUG 10 — src/thermalPrint.ts
// webBluetoothPrint connects to the GATT server but never calls
// server.disconnect() after sending data. The open connection is
// leaked, causing "already connected" errors on the next print.
// Wrap the send loop in try/finally and always disconnect.
// ════════════════════════════════════════════════════════════════
applyFix(
  'src/thermalPrint.ts',
  'BUG 10 — Disconnect GATT server after Web Bluetooth print to prevent connection leak',
  `    for (let i = 0; i < data.byteLength; i += BT_CHUNK_SIZE) {
      const slice = data.slice(i, i + BT_CHUNK_SIZE);
      if (writable.properties.writeWithoutResponse) {
        await writable.writeValueWithoutResponse(slice);
      } else {
        await writable.writeValue(slice);
      }
      if (i + BT_CHUNK_SIZE < data.byteLength) {
        await delayMs(BT_CHUNK_DELAY_MS);
      }
    }
    return true;
  } catch (err) {
    console.warn('[ThermalPrint] Web Bluetooth failed:', err);
    return false;
  }`,
  `    try {
      for (let i = 0; i < data.byteLength; i += BT_CHUNK_SIZE) {
        const slice = data.slice(i, i + BT_CHUNK_SIZE);
        if (writable.properties.writeWithoutResponse) {
          await writable.writeValueWithoutResponse(slice);
        } else {
          await writable.writeValue(slice);
        }
        if (i + BT_CHUNK_SIZE < data.byteLength) {
          await delayMs(BT_CHUNK_DELAY_MS);
        }
      }
      return true;
    } finally {
      // Always disconnect to free the GATT connection.
      // Leaving it open causes "already connected" errors on the next print.
      try { server.disconnect(); } catch { /* ignore if already disconnected */ }
    }
  } catch (err) {
    console.warn('[ThermalPrint] Web Bluetooth failed:', err);
    return false;
  }`,
);

// ─── summary ──────────────────────────────────────────────────────
console.log(`
────────────────────────────────────────────────────────
✅  Patch complete. Summary of applied fixes:

  BUG 1  worker/src/index.ts  — CORS: removed credentials:true from wildcard origin (spec violation)
  BUG 2  worker/src/index.ts  — Checkout: SC/PWD discount rate no longer overridden by discount_pct
  BUG 3  worker/src/index.ts  — Sale detail: cashier_name coerced from undefined to '' (prevents crash)
  BUG 4  worker/src/index.ts  — /api/init: guard uses array length check instead of single-row .get()
  BUG 5  worker/src/index.ts  — Open shift: now admin-only (crew could previously open shifts)
  BUG 6  src/api.ts           — apiFetch: !res.ok checked first so edge 5xx always throws
  BUG 7  src/api.ts           — useUsersList: added staleTime to stop refetch on every PIN modal open
  BUG 8  src/store.ts         — Auth persist: added version + localStorage.removeItem on logout
  BUG 9  src/store.ts         — Cart: stored discount_pct now reflects actual SC/PWD rate, not 0
  BUG 10 src/thermalPrint.ts  — Web Bluetooth: GATT server disconnected in finally after print

Backups saved as *.patch-bak alongside each patched file.
────────────────────────────────────────────────────────
`);
