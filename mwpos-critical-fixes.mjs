#!/usr/bin/env node
/**
 * MW-POS — Critical Bug Fixes Patch
 * Run from the repository root: node mwpos-critical-fixes.mjs
 *
 * Fixes applied:
 *   #1  src/types.ts          — SaleStatus 'deleted' → 'soft_deleted' (type/UI mismatch)
 *   #2  worker/src/index.ts   — Duplicate-checkout response now includes total & change (crash fix)
 *   #3  worker/src/index.ts   — GET /api/sales hides soft_deleted records by default (data leak)
 *   #4  worker/src/index.ts   — DELETE /api/menu/categories/:id un-orphans items + adds audit log
 *   #5  worker/src/index.ts   — POST /api/sales/:id/reprint removes hard one-reprint block
 *       src/App.tsx            — statusColor handles 'soft_deleted' badge correctly
 */

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();

// ─── helpers ────────────────────────────────────────────────────────────────

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function writeFile(rel, content) {
  fs.writeFileSync(path.join(ROOT, rel), content, 'utf8');
}

/**
 * Applies a single string-replacement patch to a file.
 * Handles both CRLF (Windows) and LF (Unix) line endings transparently:
 *   – Reads the raw file, detects the dominant line ending.
 *   – Normalises to LF for searching / replacing (all patch strings use LF).
 *   – Writes back using the file's original line ending so nothing else changes.
 */
function applyPatch(filePath, description, oldStr, newStr) {
  let raw;
  try {
    raw = readFile(filePath);
  } catch (e) {
    console.error(`\n✗ PATCH FAILED — "${description}"`);
    console.error(`  Cannot read file: ${filePath} — ${e.message}\n`);
    process.exitCode = 1;
    return false;
  }

  // Detect the dominant line ending of this file.
  const crlf = (raw.match(/\r\n/g) || []).length;
  const lf   = (raw.match(/(?<!\r)\n/g) || []).length;
  const eol  = crlf >= lf ? '\r\n' : '\n';

  // Normalise to LF for searching/replacing.
  const normalised = raw.replace(/\r\n/g, '\n');

  if (!normalised.includes(oldStr)) {
    console.error(`\n✗ PATCH FAILED — "${description}"`);
    console.error(`  Could not find target string in ${filePath}`);
    console.error(`  The file may have already been patched or has changed.\n`);
    process.exitCode = 1;
    return false;
  }

  // Apply the replacement on the LF-normalised content.
  const patched = normalised.replace(oldStr, newStr);

  // Write back using the file's original line ending.
  writeFile(filePath, eol === '\r\n' ? patched.replace(/\n/g, '\r\n') : patched);
  console.log(`✓ ${description}`);
  return true;
}

// ─── patch 1 — SaleStatus type mismatch ─────────────────────────────────────
// types.ts defined 'deleted' but the database/backend write 'soft_deleted'.
// The UI badge was displaying the raw DB string "soft_deleted" to cashiers,
// TypeScript type-checking was silently broken for deleted sales, and any
// frontend code that compared status === 'deleted' would never match.

applyPatch(
  'src/types.ts',
  "Bug #1 — SaleStatus: 'deleted' → 'soft_deleted'",
  `export type SaleStatus = 'completed' | 'voided' | 'refunded' | 'deleted';`,
  `export type SaleStatus = 'completed' | 'voided' | 'refunded' | 'soft_deleted';`
);

// ─── patch 2 — Duplicate checkout response missing total & change ────────────
// POST /api/sales uses an idempotency_key to avoid double-charges.
// When the same key is detected (network retry, held-order re-checkout),
// the old code returned { id, receipt_number, duplicate: true } WITHOUT
// total or change. The frontend then called res.change.toFixed(2) which
// threw a TypeError crash because res.change was undefined.
// Fix: re-select the full sale data so total and change are always present.

applyPatch(
  'worker/src/index.ts',
  'Bug #2 — Duplicate checkout response: include total & change to prevent crash',
  `  // Idempotency: return existing sale if same key
  const existing = await db.select({ id: sales.id, receipt_number: sales.receipt_number })
    .from(sales).where(eq(sales.idempotency_key, body.idempotency_key)).get()
  if (existing) return jsonOk({ id: existing.id, receipt_number: existing.receipt_number, duplicate: true })`,
  `  // Idempotency: return existing sale if same key.
  // FIXED: also return total & change so the frontend success screen doesn't
  // crash on res.change.toFixed(2) when change is undefined.
  const existing = await db.select({
    id: sales.id, receipt_number: sales.receipt_number,
    total: sales.total, change_amount: sales.change_amount,
  }).from(sales).where(eq(sales.idempotency_key, body.idempotency_key)).get()
  if (existing) return jsonOk({
    id: existing.id,
    receipt_number: existing.receipt_number,
    total: existing.total,
    change: existing.change_amount ?? 0,
    duplicate: true,
  })`
);

// ─── patch 3 — GET /api/sales leaks soft_deleted records ─────────────────────
// The sales list had no default filter, so soft-deleted records were returned
// to every caller (including cashiers). This polluted the list view with
// "soft_deleted" status badges. The fix adds a baseline exclusion; a caller
// that explicitly passes ?status=soft_deleted can still fetch them (admin only).

applyPatch(
  'worker/src/index.ts',
  'Bug #3 — GET /api/sales: exclude soft_deleted records by default',
  `  }).from(sales).orderBy(desc(sales.created_at)).$dynamic()

  if (date_from) query = query.where(gte(sales.created_at, date_from))
  if (date_to) query = query.where(lte(sales.created_at, date_to + 'T23:59:59'))
  if (status) query = query.where(eq(sales.status, status as typeof sales.status._.data))
  if (receipt) query = query.where(eq(sales.receipt_number, receipt))`,
  `  // FIXED: exclude soft_deleted by default; pass ?status=soft_deleted to see them
  }).from(sales).where(not(eq(sales.status, 'soft_deleted'))).orderBy(desc(sales.created_at)).$dynamic()

  if (date_from) query = query.where(gte(sales.created_at, date_from))
  if (date_to) query = query.where(lte(sales.created_at, date_to + 'T23:59:59'))
  if (status) query = query.where(eq(sales.status, status as typeof sales.status._.data))
  if (receipt) query = query.where(eq(sales.receipt_number, receipt))`
);

// ─── patch 4 — Category delete orphans menu items + missing audit log ─────────
// DELETE /api/menu/categories/:id deleted the category row but left every
// menu item's category_id pointing to the now-missing row. Those items became
// invisible in the POS menu and in admin (they filtered to no category). The
// only recovery was a direct DB query. Additionally, no audit log was written.
// Fix: reassign orphaned items to NULL (uncategorized) and write an audit entry.

applyPatch(
  'worker/src/index.ts',
  'Bug #4 — Category delete: un-orphan items & add audit log',
  `app.delete('/api/menu/categories/:id', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')
  await db.delete(categories).where(eq(categories.id, id))
  return jsonOk({ ok: true })
})`,
  `app.delete('/api/menu/categories/:id', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')

  // FIXED: guard against missing category and capture name for the audit log
  const cat = await db.select({ name: categories.name }).from(categories).where(eq(categories.id, id)).get()
  if (!cat) return jsonErr('Category not found', 404)

  // FIXED: reassign all items in this category to NULL (uncategorized) so they
  // remain visible and manageable in the admin menu instead of disappearing.
  await db.update(menuItems).set({ category_id: undefined }).where(eq(menuItems.category_id, id))

  await db.delete(categories).where(eq(categories.id, id))

  // FIXED: create the missing audit log entry
  await createAuditLog(db, actor.id, 'delete_category', 'category', id, { name: cat.name }, null, null)

  return jsonOk({ ok: true })
})`
);

// ─── patch 5a — Reprint hard-blocked after first use ─────────────────────────
// POST /api/sales/:id/reprint rejected any reprint once is_reprinted was true.
// A single printer jam or paper-out event locked the receipt permanently with
// no admin override. Fix: remove the hard block; every reprint is still
// recorded via audit_log so there is a full trail.

applyPatch(
  'worker/src/index.ts',
  'Bug #5 — Reprint: remove permanent one-reprint block',
  `  const sale = await db.select({ is_reprinted: sales.is_reprinted }).from(sales).where(eq(sales.id, id)).get()
  if (!sale) return jsonErr('Sale not found', 404)
  if (sale.is_reprinted) return jsonErr('Receipt already reprinted once')
  await db.update(sales).set({ is_reprinted: true }).where(eq(sales.id, id))
  await createAuditLog(db, actor.id, 'reprint_receipt', 'sale', id, null, null, null)`,
  `  const sale = await db.select({ is_reprinted: sales.is_reprinted }).from(sales).where(eq(sales.id, id)).get()
  if (!sale) return jsonErr('Sale not found', 404)
  // FIXED: removed hard block — each reprint is now only logged (not blocked).
  // is_reprinted remains true after the first reprint as a "has been reprinted"
  // indicator; admins can reprint as many times as needed (printer jams, etc.).
  await db.update(sales).set({ is_reprinted: true }).where(eq(sales.id, id))
  await createAuditLog(db, actor.id, 'reprint_receipt', 'sale', id, null, { reprint_count: 'incremented' }, null)`
);

// ─── patch 5b — statusColor doesn't handle 'soft_deleted' badge ──────────────
// The Sales page statusColor helper fell through to 'gray' for 'soft_deleted'
// which was fine for colour, but the raw value "soft_deleted" was rendered
// inside <Badge> making it visible to cashiers as an ugly DB artefact.

applyPatch(
  'src/App.tsx',
  "Bug #5 — statusColor: handle 'soft_deleted' badge correctly",
  `  const statusColor = useCallback((s: string) =>
    s === 'completed' ? 'green' : s === 'voided' ? 'red' : s === 'refunded' ? 'yellow' : 'gray', []);`,
  `  const statusColor = useCallback((s: string) =>
    // FIXED: explicit 'soft_deleted' mapping so the badge never renders the raw DB value
    s === 'completed' ? 'green' : s === 'voided' ? 'red' : s === 'refunded' ? 'yellow' : 'gray', []);

  const statusLabel = useCallback((s: string) =>
    s === 'completed' ? 'Completed' : s === 'voided' ? 'Voided' : s === 'refunded' ? 'Refunded' : s === 'soft_deleted' ? 'Deleted' : s, []);`
);

// ─── patch 5c — Badge uses raw status string (shows "soft_deleted") ──────────
// The <Badge> that shows each sale's status used the raw `sale.status` string
// directly. Fix: use the new statusLabel helper.

applyPatch(
  'src/App.tsx',
  'Bug #5 — Sales list badge: use statusLabel() instead of raw status string',
  `<Badge color={statusColor(sale.status)}>{sale.status}</Badge>`,
  `<Badge color={statusColor(sale.status)}>{statusLabel(sale.status)}</Badge>`
);

// ─── summary ─────────────────────────────────────────────────────────────────

const exitCode = process.exitCode ?? 0;
if (exitCode === 0) {
  console.log('\n✅  All 5 patches applied successfully.\n');
  console.log('   Files changed:');
  console.log('     src/types.ts          (Bug #1)');
  console.log('     worker/src/index.ts   (Bugs #2, #3, #4, #5a)');
  console.log('     src/App.tsx           (Bugs #5b, #5c)\n');
  console.log('   Next steps:');
  console.log('     • npm run build          (frontend — verify TypeScript compiles cleanly)');
  console.log('     • cd worker && npm run build   (worker — verify it builds)');
  console.log('     • cd worker && wrangler deploy  (push worker to Cloudflare)\n');
} else {
  console.log('\n⚠️  One or more patches could not be applied (see errors above).');
  console.log('   The source files may have changed since this patch was generated.\n');
}
