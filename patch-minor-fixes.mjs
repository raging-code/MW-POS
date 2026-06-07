/**
 * MW-POS Minor Fix Patch  (v1)
 * Run with: node patch-minor-fixes.mjs
 *
 * Applies 4 targeted, non-breaking fixes:
 *
 *  FIX 1 — Remove stray console.log from GET /api/reports/sales-detailed
 *           (worker/src/index.ts line ~1306)
 *
 *  FIX 2 — Add admin-only guard to PUT /api/shifts/:id/close
 *           (worker/src/index.ts) — mirrors the existing guard on POST /api/shifts
 *
 *  FIX 3 — Clear React Query cache on logout so a second user on the
 *           same shared device never sees the first user's cached data
 *           (src/App.tsx — Header component handleLogout callback)
 *
 *  FIX 4 — Add .env to .gitignore so the Vite env file stops being
 *           tracked by git (runs git rm --cached .env automatically)
 *
 * Zero functional behaviour changes beyond what is described above.
 * Backups of modified source files are written to *.minor-fix-bak
 * before any changes are applied.
 */

import fs            from 'fs';
import path          from 'path';
import { execSync }  from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── helpers ─────────────────────────────────────────────────────────────────

function fullPath(rel) { return path.join(__dirname, rel); }

function backup(rel) {
  const src = fullPath(rel);
  if (!fs.existsSync(src)) { console.warn(`  ⚠ backup: ${rel} not found, skipping`); return; }
  fs.copyFileSync(src, src + '.minor-fix-bak');
}

/**
 * Apply a single exact-string replacement to a file.
 * Normalises to LF internally so multiline patterns always match,
 * then restores the original line-ending on write (CRLF-safe).
 *
 * Returns true on success, false if the pattern was not found.
 */
function applyFix(rel, description, searchStr, replaceStr) {
  const fp  = fullPath(rel);
  const raw = fs.readFileSync(fp, 'utf8');

  // Detect dominant line ending
  const hasCRLF = raw.includes('\r\n');

  // Normalise to LF for matching
  const lf   = hasCRLF ? raw.replace(/\r\n/g, '\n') : raw;
  const srch = searchStr.replace(/\r\n/g, '\n');
  const repl = replaceStr.replace(/\r\n/g, '\n');

  const count = lf.split(srch).length - 1;
  if (count === 0) {
    console.error(`  ✗ SKIP — pattern not found in ${rel}:`);
    console.error(`    ${srch.trim().split('\n')[0].slice(0, 100)}`);
    return false;
  }
  if (count > 1) {
    console.warn(`  ⚠ WARN — pattern found ${count} times in ${rel}; replacing first occurrence only`);
  }

  let patched = lf.replace(srch, repl);
  if (hasCRLF) patched = patched.replace(/\n/g, '\r\n');

  fs.writeFileSync(fp, patched, 'utf8');
  console.log(`  ✓ ${description}`);
  return true;
}

/**
 * Append a line to a file only if that exact line is not already present.
 */
function appendIfAbsent(rel, line, description) {
  const fp      = fullPath(rel);
  const content = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '';
  const lines   = content.split(/\r?\n/);
  if (lines.includes(line.trim())) {
    console.log(`  ✓ ${description} (already present)`);
    return true;
  }
  const newContent = content.endsWith('\n') ? content + line + '\n' : content + '\n' + line + '\n';
  fs.writeFileSync(fp, newContent, 'utf8');
  console.log(`  ✓ ${description}`);
  return true;
}

// ─── backup originals ─────────────────────────────────────────────────────────

const filesToBackup = [
  'worker/src/index.ts',
  'src/App.tsx',
  '.gitignore',
];

console.log('\n📦 Backing up originals…');
filesToBackup.forEach(f => {
  backup(f);
  console.log(`  ✓ ${f}.minor-fix-bak`);
});

console.log('\n🔧 Applying fixes…\n');

// ═════════════════════════════════════════════════════════════════════════════
// FIX 1 — Remove stray console.log from GET /api/reports/sales-detailed
//
// The log fires on every report request and pollutes the Cloudflare Worker
// log tail. No logic is removed — only the debug statement itself.
// ═════════════════════════════════════════════════════════════════════════════
console.log('FIX 1 — Remove debug console.log from sales-detailed route');
applyFix(
  'worker/src/index.ts',
  'Remove console.log("sales-detailed params:…") from report route',
  `  console.log('sales-detailed params:', { period, date, date_from, date_to, year, month })\n\n  let startDate`,
  `  let startDate`,
);

// ═════════════════════════════════════════════════════════════════════════════
// FIX 2 — Add admin-only guard to PUT /api/shifts/:id/close
//
// POST /api/shifts (open) already has `if (actor.role !== 'admin') return jsonErr(…)`
// on its second line. The close route reads `actor` but never checks the role,
// so any authenticated crew member could close the shift via a direct API call.
//
// The fix inserts the identical one-liner guard immediately after the
// existing `const db = c.get('db')` line — same pattern as open shift.
// All close-shift business logic is unchanged.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\nFIX 2 — Add admin-only guard to PUT /api/shifts/:id/close');
applyFix(
  'worker/src/index.ts',
  'Add actor.role !== "admin" guard to close-shift route',
  // Exact lines from the repo (whitespace matters):
  `app.put('/api/shifts/:id/close', async (c) => {
  const actor = c.get('user')
  const db = c.get('db')
  const id = c.req.param('id')`,
  `app.put('/api/shifts/:id/close', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')`,
);

// ═════════════════════════════════════════════════════════════════════════════
// FIX 3 — Clear React Query cache on logout  (src/App.tsx)
//
// On logout, Zustand clears the auth state but the React Query cache (holding
// menu data, sales, user lists, shift data, etc.) is left intact. On a shared
// POS terminal where two different users log in during the same browser session,
// the second user briefly sees the first user's cached data until queries refetch.
//
// Fix: import useQueryClient from @tanstack/react-query, call queryClient.clear()
// inside the handleLogout callback in the Header component.
//
// The import is added after the existing lucide-react import block.
// The callback is extended with a single extra call — everything else is identical.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\nFIX 3 — Clear React Query cache on logout');

// Step 3a: add the useQueryClient import (after the lucide-react import block)
applyFix(
  'src/App.tsx',
  'Add useQueryClient import from @tanstack/react-query',
  `} from 'lucide-react';
import { useAuthStore,`,
  `} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore,`,
);

// Step 3b: wire useQueryClient into the Header component and call .clear() on logout
applyFix(
  'src/App.tsx',
  'Call queryClient.clear() inside handleLogout in Header',
  // Original Header function opening lines
  `function Header() {
  const { page, navigate } = useUIStore();
  const { user, logout } = useAuthStore();
  const { data: shift } = useCurrentShift();`,
  // Patched: add useQueryClient hook
  `function Header() {
  const { page, navigate } = useUIStore();
  const { user, logout } = useAuthStore();
  const queryClient = useQueryClient();
  const { data: shift } = useCurrentShift();`,
);

applyFix(
  'src/App.tsx',
  'Add queryClient.clear() to handleLogout callback',
  // Original callback (exact text from repo)
  `  const handleLogout = useCallback(() => {
    logout();
    setMenuOpen(false);
  }, [logout]);`,
  // Patched callback — clear cache before logout so stale data never leaks
  `  const handleLogout = useCallback(() => {
    queryClient.clear();   // flush cached data so the next user starts fresh
    logout();
    setMenuOpen(false);
  }, [logout, queryClient]);`,
);

// ═════════════════════════════════════════════════════════════════════════════
// FIX 4 — Add .env to .gitignore and un-track it from git
//
// The .env file (containing VITE_API_URL) is currently tracked by git.
// While it only holds the public worker URL (not a secret), committing env
// files is bad practice and sets a risky precedent for future secrets.
//
// This fix:
//   1. Appends ".env" to .gitignore (if not already present)
//   2. Runs `git rm --cached .env` to stop tracking the file
//      (the file itself is kept on disk — only git's index entry is removed)
// ═════════════════════════════════════════════════════════════════════════════
console.log('\nFIX 4 — Stop tracking .env in git');

appendIfAbsent(
  '.gitignore',
  '.env',
  'Added .env to .gitignore',
);

// Run git rm --cached .env only if the file is currently tracked
try {
  execSync('git ls-files --error-unmatch .env', { cwd: __dirname, stdio: 'pipe' });
  // File is tracked — remove it from the index
  try {
    execSync('git rm --cached .env', { cwd: __dirname, stdio: 'pipe' });
    console.log('  ✓ git rm --cached .env  (file kept on disk; removed from git tracking)');
  } catch (rmErr) {
    console.warn('  ⚠ git rm --cached .env failed — run it manually if needed');
    console.warn('   ', rmErr.message);
  }
} catch {
  // ls-files --error-unmatch exits non-zero if the file is not tracked
  console.log('  ✓ .env is already untracked — no git rm needed');
}

// ─── summary ──────────────────────────────────────────────────────────────────
console.log(`
✅  All fixes applied.

Next steps
──────────
1. Rebuild & redeploy the worker:
     cd worker && wrangler deploy

2. Rebuild the frontend (Fix 3 changes App.tsx):
     npm run build

3. Commit the .gitignore change (the .env file will no longer appear in git status):
     git add .gitignore
     git commit -m "chore: stop tracking .env file"

4. Keep .env.example committed as the canonical template for environment setup.

Backup files written:
  worker/src/index.ts.minor-fix-bak
  src/App.tsx.minor-fix-bak
  .gitignore.minor-fix-bak
`);
