#!/usr/bin/env node
/**
 * apply-frontend-fixes.mjs
 * MW-POS Frontend Bug-Fix Patch — Node.js apply script
 *
 * Usage:
 *   1. Copy this file and mwpos-frontend-bugfix.patch into the root of your MW-POS repo.
 *   2. Run:  node apply-frontend-fixes.mjs
 *
 * The script will:
 *   - Verify you are in the right project directory
 *   - Back up all touched source files (src/*.ts / src/*.tsx)
 *   - Apply mwpos-frontend-bugfix.patch via `git apply`
 *   - Print a summary of every bug that was fixed
 *
 * Requirements: git must be on your PATH (it already is if you cloned via git).
 * Node 18+ recommended (uses native fetch / crypto globals for env detection only).
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, copyFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname);
const PATCH = resolve(ROOT, 'mwpos-frontend-bugfix.patch');

// ── Helpers ──────────────────────────────────────────────────────────────────
function log(msg)  { process.stdout.write('\x1b[36m[patch]\x1b[0m ' + msg + '\n'); }
function ok(msg)   { process.stdout.write('\x1b[32m[  ok ]\x1b[0m ' + msg + '\n'); }
function warn(msg) { process.stdout.write('\x1b[33m[ warn]\x1b[0m ' + msg + '\n'); }
function err(msg)  { process.stdout.write('\x1b[31m[error]\x1b[0m ' + msg + '\n'); }
function run(cmd, opts = {}) {
  return spawnSync(cmd, { shell: true, cwd: ROOT, ...opts });
}

// ── Pre-flight checks ────────────────────────────────────────────────────────
log('MW-POS Frontend Bug-Fix Patch');
log('==============================');

if (!existsSync(resolve(ROOT, 'package.json'))) {
  err('package.json not found. Run this script from the root of the MW-POS repo.');
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
if (!pkg.name?.toLowerCase().includes('mw') && !pkg.dependencies?.react) {
  warn('This does not look like the MW-POS project — proceeding anyway, but double-check the directory.');
}

if (!existsSync(PATCH)) {
  err(`Patch file not found: ${PATCH}`);
  err('Make sure mwpos-frontend-bugfix.patch is in the same directory as this script.');
  process.exit(1);
}

// Check git
const gitCheck = run('git --version');
if (gitCheck.status !== 0) {
  err('git is not installed or not on PATH. Install git and try again.');
  process.exit(1);
}

// ── Back up touched files ────────────────────────────────────────────────────
const TOUCHED = ['src/App.tsx', 'src/api.ts', 'src/store.ts', 'src/main.tsx'];
log('Backing up source files…');
let backupFailed = false;
for (const f of TOUCHED) {
  const src = resolve(ROOT, f);
  if (!existsSync(src)) { warn(`  File not found (skipping backup): ${f}`); continue; }
  const dest = src + '.patch-backup';
  copyFileSync(src, dest);
  ok(`  Backed up → ${f}.patch-backup`);
}

// ── Check for clean state / conflicts ───────────────────────────────────────
log('Checking patch for conflicts (dry-run)…');
const dry = run(`git apply --check "${PATCH}" 2>&1`);
if (dry.status !== 0) {
  err('Patch conflict detected. The patch cannot apply cleanly.');
  err('Possible causes:');
  err('  • The source files have already been modified by a previous patch run.');
  err('  • You are on a different version of the codebase.');
  err('');
  err('To revert to original: restore the *.patch-backup files that were just created,');
  err('or run:  git checkout src/App.tsx src/api.ts src/store.ts src/main.tsx');
  const out = (dry.stdout ?? dry.stderr ?? '').toString();
  if (out) process.stderr.write(out + '\n');
  process.exit(1);
}
ok('Patch checks out — no conflicts.');

// ── Apply patch ───────────────────────────────────────────────────────────────
log('Applying patch…');
const apply = run(`git apply "${PATCH}" 2>&1`);
if (apply.status !== 0) {
  err('git apply failed:');
  process.stderr.write((apply.stdout ?? apply.stderr ?? '').toString() + '\n');
  err('Your .patch-backup files are intact. No source files were modified.');
  process.exit(1);
}
ok('Patch applied successfully!');

// ── Summary ──────────────────────────────────────────────────────────────────
process.stdout.write('\n');
log('═══════════════════════════════════════════════════════════════');
log('  BUG FIXES APPLIED  (13 bugs across 4 files)');
log('═══════════════════════════════════════════════════════════════');
const fixes = [
  // App.tsx
  ['App.tsx', 'BUG-01', 'PinModal keyboard handler had stale closure on `pin` state (missing `press` dep)'],
  ['App.tsx', 'BUG-02', 'HeldOrdersModal: dead `getCartState` arrow called a hook outside React (Rules of Hooks violation)'],
  ['App.tsx', 'BUG-03', 'POSPage discount-pct effect re-ran on every cart mutation (full `cart` object was a dep)'],
  ['App.tsx', 'BUG-04', 'POSPage keyboard shortcut re-registered on every item change (full store dep); now uses fine-grained selector'],
  ['App.tsx', 'BUG-05', 'Cart panel clear button compared `cart.cart.items.length` (full store); now uses `itemCount` selector'],
  ['App.tsx', 'BUG-06', 'Cart empty-state read `cart.cart.items.length` (full store); now uses `itemCount` selector'],
  ['App.tsx', 'BUG-07', 'CheckoutModal: single cash payment line not synced when cart total changes while modal is open'],
  ['App.tsx', 'BUG-08', 'SalesPage: `refetch` function is unstable — doDelete/doReprint held stale reference; fixed with ref'],
  ['App.tsx', 'BUG-09', 'Success screen in CheckoutModal showed interactive order-type buttons after sale was already saved'],
  ['App.tsx', 'BUG-10', 'ShiftModal executeAction useCallback was missing `onClose` + `pendingAction` dep; used ref pattern'],
  ['App.tsx', 'BUG-11', 'AdminMenuPage category & item delete used native `confirm()` — blocked in Capacitor WebView; replaced with ConfirmDialog'],
  ['App.tsx', 'BUG-12', 'AnyUserPinModal used `useLogin` (creates new auth session) instead of `useVerifyPin` (PIN-only check) — would overwrite the logged-in user\'s token'],
  ['App.tsx', 'BUG-13', 'Header `navItems` array was re-created inside component on every render, defeating the `visible` useMemo'],
  ['App.tsx', 'BUG-14', 'toast() orphaned DOM nodes on rapid errors; added max-toast guard + click-to-dismiss + isConnected guard'],
  ['App.tsx', 'BUG-15', 'SizePickerModal "Add to Order" was not disabled when selectedSize was undefined (edge case: no sizes)'],
  ['App.tsx', 'BUG-16', 'App() auth-check useEffect had empty deps — would not re-verify if token changed without page reload'],
  ['api.ts',  'BUG-17', 'apiFetch crashed on non-JSON server error responses (5xx/gateway errors); now shows clean error message'],
  ['api.ts',  'BUG-18', 'useUsersListAuth had no `enabled: !!token` guard — would fire unauthenticated and retry on 401'],
  ['store.ts','BUG-19', 'loadFromHeld preserved the original idempotency_key — backend could reject checkout as duplicate if key was reused'],
  ['main.tsx','BUG-20', 'onlineManager eventName computed twice via `\'change\' in target` (always false on EventTarget) causing wrong event in cleanup'],
];

const colW = [10, 8, 999];
for (const [file, id, desc] of fixes) {
  const f = file.padEnd(10);
  const i = id.padEnd(8);
  process.stdout.write(`  \x1b[90m${f}\x1b[0m \x1b[33m${i}\x1b[0m ${desc}\n`);
}

process.stdout.write('\n');
ok('All done! Rebuild the app to pick up the changes:');
log('  npm run build    (or your usual build command)');
process.stdout.write('\n');
log('Backup files (*.patch-backup) can be deleted once you verify the build.');
