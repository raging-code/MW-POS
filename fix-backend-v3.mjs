/**
 * MW-POS Backend Bug Fix Patch — v3 (revised: CRLF-safe + corrected anchors)
 *
 * Usage:  node fix-backend-v3.mjs
 *         (run from repo root, same folder as worker/)
 *
 * Fixes  (8 bugs, backend-only, no frontend changes needed):
 *   A  category_id: null instead of undefined in DELETE category
 *   B  void + refund routes restricted to admin (were open to crew)
 *   C  PUT /api/users/:id whitelists allowed fields (prevents pin_hash overwrite)
 *   D  Receipt counter uses Manila date (UTC+8) not UTC date
 *   E  All date-range filters use Manila→UTC conversion (4 routes)
 *   F  PIN validated as 6 numeric digits, not just length-6
 *   G  Cash-drop validates amount > 0 and shift is open
 *   H  recordPinFail stores null (not undefined) for locked_until
 */

import fs   from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dir    = path.dirname(fileURLToPath(import.meta.url))
const SRC      = path.join(__dir, 'worker', 'src', 'index.ts')
const BACKUP   = SRC + '.v3-backup'

// ── helpers ────────────────────────────────────────────────────────────────

function banner(msg) { console.log('\n' + '─'.repeat(60)); console.log('  ' + msg); console.log('─'.repeat(60)) }

let applied = 0, skipped = 0, already = 0
const results = []

function patch(label, search, replace, sentinel) {
  // Read fresh each time so successive patches build on each other.
  // Normalise CRLF → LF so the script works on both Windows and Unix.
  let src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n')

  // Already applied?
  if (src.includes(sentinel)) {
    console.log(`  ✔  [${label}] already applied — skipping.`)
    already++
    results.push({ label, status: 'already' })
    return
  }

  if (!src.includes(search)) {
    console.log(`  ⚠  [${label}] anchor not found — SKIPPED.`)
    console.log(`     Your local file may differ; apply manually if needed.`)
    skipped++
    results.push({ label, status: 'skipped' })
    return
  }

  src = src.replace(search, replace)
  // Write back with LF endings (safe for all modern editors and git)
  fs.writeFileSync(SRC, src, 'utf8')
  console.log(`  ✓  [${label}] applied.`)
  applied++
  results.push({ label, status: 'applied' })
}

// ── run ────────────────────────────────────────────────────────────────────

console.log('╔════════════════════════════════════════════════════════╗')
console.log('║   MW-POS Backend Bug Fix Patch  (v3 revised)          ║')
console.log('╚════════════════════════════════════════════════════════╝')

if (!fs.existsSync(SRC)) {
  console.error(`\n  ✗  Cannot find ${SRC}\n  Run this script from the repo root.\n`)
  process.exit(1)
}

if (!fs.existsSync(BACKUP)) {
  fs.copyFileSync(SRC, BACKUP)
  console.log(`  ℹ  Backup saved → index.ts.v3-backup`)
} else {
  console.log(`  ℹ  Backup already exists, skipping.`)
}

// ══════════════════════════════════════════════════════════════════════════
// FIX A — category_id: undefined → null in DELETE /api/menu/categories/:id
// ══════════════════════════════════════════════════════════════════════════
banner('Fix A — category delete: category_id null (not undefined)')
patch(
  'Fix A — category_id: null in DELETE category',
  `  await db.update(menuItems).set({ category_id: undefined }).where(eq(menuItems.category_id, id))`,
  `  // FIX A: use null so Drizzle emits SET category_id = NULL.
  // undefined is omitted from the SET clause, leaving items with a dangling
  // FK reference that makes them invisible in every menu query.
  await db.update(menuItems).set({ category_id: null }).where(eq(menuItems.category_id, id))`,
  'FIX A: use null so Drizzle emits SET category_id = NULL'
)

// ══════════════════════════════════════════════════════════════════════════
// FIX B — void + refund require admin role
// ══════════════════════════════════════════════════════════════════════════
banner('Fix B — void + refund: admin-only guard')
patch(
  'Fix B1 — void requires admin',
  `app.post('/api/sales/:id/void', async (c) => {
  const actor = c.get('user')
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{ reason: string }>()
  if (!body.reason) return jsonErr('Reason required')`,
  `app.post('/api/sales/:id/void', async (c) => {
  const actor = c.get('user')
  // FIX B: void is a financial action — admin only
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{ reason: string }>()
  if (!body.reason) return jsonErr('Reason required')`,
  'FIX B: void is a financial action — admin only'
)

patch(
  'Fix B2 — refund requires admin',
  `app.post('/api/sales/:id/refund', async (c) => {
  const actor = c.get('user')
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{ reason: string }>()
  if (!body.reason) return jsonErr('Reason required')`,
  `app.post('/api/sales/:id/refund', async (c) => {
  const actor = c.get('user')
  // FIX B: refund is a financial action — admin only
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{ reason: string }>()
  if (!body.reason) return jsonErr('Reason required')`,
  'FIX B: refund is a financial action — admin only'
)

// ══════════════════════════════════════════════════════════════════════════
// FIX C — PUT /api/users/:id: whitelist update fields
// ══════════════════════════════════════════════════════════════════════════
banner('Fix C — PUT /api/users/:id: whitelist fields')
patch(
  'Fix C — whitelist user update fields',
  `  await db.update(users).set({ ...body }).where(eq(users.id, id))`,
  `  // FIX C: whitelist — only name, role, is_active may be updated.
  // Spreading the raw body could let a caller overwrite pin_hash or created_by.
  const safeFields: Partial<typeof users.$inferInsert> = {}
  if (body.name      !== undefined) safeFields.name      = body.name
  if (body.role      !== undefined) safeFields.role      = body.role
  if (body.is_active !== undefined) safeFields.is_active = body.is_active
  await db.update(users).set(safeFields).where(eq(users.id, id))`,
  'FIX C: whitelist — only name, role, is_active may be updated'
)

// ══════════════════════════════════════════════════════════════════════════
// FIX D — Receipt counter: use Manila date (UTC+8) not UTC date
// ══════════════════════════════════════════════════════════════════════════
banner('Fix D — Receipt counter: Manila timezone date')
patch(
  'Fix D — receipt dateKey uses Manila time',
  `  const today = new Date()
  const dateKey = today.toISOString().slice(0, 10).replace(/-/g, '')`,
  `  // FIX D: Manila is UTC+8. Shift by 8 h before slicing the ISO string so
  // receipts before 08:00 Manila time don't carry yesterday's date.
  const manilaDate = new Date(Date.now() + 8 * 3_600_000)
  const dateKey = manilaDate.toISOString().slice(0, 10).replace(/-/g, '')`,
  'FIX D: Manila is UTC+8'
)

// ══════════════════════════════════════════════════════════════════════════
// FIX E — Date-range filters: add manilaToUTC helper + apply everywhere
// ══════════════════════════════════════════════════════════════════════════
banner('Fix E — Add manilaToUTC helper')
patch(
  'Fix E — add manilaToUTC helper function',
  `function addHours(h: number): string {
  return new Date(Date.now() + h * 3_600_000).toISOString()
}`,
  `function addHours(h: number): string {
  return new Date(Date.now() + h * 3_600_000).toISOString()
}

// FIX E: convert a Manila (UTC+8) calendar date string ("YYYY-MM-DD") to a
// UTC ISO boundary suitable for comparing against stored created_at values.
// Without this, date-range queries miss the first 8 h of each day (00:00–07:59
// Manila time) and may include the first 8 h of the following day.
function manilaToUTC(dateStr: string, boundary: 'start' | 'end'): string {
  const time = boundary === 'start' ? 'T00:00:00.000+08:00' : 'T23:59:59.999+08:00'
  return new Date(dateStr + time).toISOString()
}`,
  'FIX E: convert a Manila (UTC+8) calendar date string'
)

banner('Fix E — Apply manilaToUTC to GET /api/sales')
patch(
  'Fix E1 — GET /api/sales date filter',
  `  if (date_from) query = query.where(gte(sales.created_at, date_from))
  if (date_to)   query = query.where(lte(sales.created_at, date_to + 'T23:59:59.999'))`,
  `  if (date_from) query = query.where(gte(sales.created_at, manilaToUTC(date_from, 'start')))
  if (date_to)   query = query.where(lte(sales.created_at, manilaToUTC(date_to,   'end')))`,
  `manilaToUTC(date_from, 'start')))
  if (date_to)   query = query.where(lte(sales.created_at, manilaToUTC(date_to`
)

banner('Fix E — Apply manilaToUTC to GET /api/reports/sales')
patch(
  'Fix E2 — GET /api/reports/sales date filter',
  `  if (date_from) salesQuery = salesQuery.where(gte(sales.created_at, date_from))
  if (date_to) salesQuery = salesQuery.where(lte(sales.created_at, date_to + 'T23:59:59'))`,
  `  if (date_from) salesQuery = salesQuery.where(gte(sales.created_at, manilaToUTC(date_from, 'start')))
  if (date_to) salesQuery = salesQuery.where(lte(sales.created_at, manilaToUTC(date_to, 'end')))`,
  `manilaToUTC(date_from, 'start')))
  if (date_to) salesQuery = salesQuery.where(lte(sales.created_at, manilaToUTC(date_to`
)

banner('Fix E — Apply manilaToUTC to GET /api/reports/sales-detailed')
patch(
  'Fix E3 — GET /api/reports/sales-detailed from/to',
  `  const from = startDate + 'T00:00:00.000Z'
  const to   = endDate   + 'T23:59:59.999Z'`,
  `  // FIX E: use Manila→UTC conversion so daily periods cover 00:00–23:59 Manila time
  const from = manilaToUTC(startDate, 'start')
  const to   = manilaToUTC(endDate,   'end')`,
  `FIX E: use Manila\u2192UTC conversion so daily periods cover 00:00\u201323:59 Manila time`
)

banner('Fix E — Apply manilaToUTC to GET /api/audit-logs')
patch(
  'Fix E4 — GET /api/audit-logs date filter',
  `  if (date_from) query = query.where(gte(auditLogs.created_at, date_from))
  if (date_to) query = query.where(lte(auditLogs.created_at, date_to + 'T23:59:59'))`,
  `  if (date_from) query = query.where(gte(auditLogs.created_at, manilaToUTC(date_from, 'start')))
  if (date_to) query = query.where(lte(auditLogs.created_at, manilaToUTC(date_to, 'end')))`,
  `manilaToUTC(date_from, 'start')))
  if (date_to) query = query.where(lte(auditLogs.created_at, manilaToUTC(date_to`
)

// ══════════════════════════════════════════════════════════════════════════
// FIX F — PIN validation: must be 6 numeric digits
// ══════════════════════════════════════════════════════════════════════════
banner('Fix F — PIN must be 6 numeric digits')
patch(
  'Fix F1 — POST /api/users PIN numeric check',
  `  if (!body.name || !body.pin || body.pin.length !== 6) return jsonErr('Name and 6-digit PIN required')`,
  `  // FIX F: require exactly 6 decimal digits — length-only check allows "ABCDEF"
  if (!body.name || !body.pin || !/^\\d{6}$/.test(body.pin)) return jsonErr('Name and 6-digit numeric PIN required')`,
  'FIX F: require exactly 6 decimal digits'
)

patch(
  'Fix F2 — reset-pin PIN numeric check',
  `  if (!body.new_pin || body.new_pin.length !== 6) return jsonErr('6-digit PIN required')`,
  `  // FIX F: require exactly 6 decimal digits
  if (!body.new_pin || !/^\\d{6}$/.test(body.new_pin)) return jsonErr('6-digit numeric PIN required')`,
  'FIX F: require exactly 6 decimal digits\n  if (!body.new_pin'
)

// ══════════════════════════════════════════════════════════════════════════
// FIX G — Cash drop: validate amount > 0 and shift is open
// ══════════════════════════════════════════════════════════════════════════
banner('Fix G — Cash-drop: validate amount & shift status')
patch(
  'Fix G — cash-drop amount and shift validation',
  `  const body = await c.req.json<{ amount: number; reason: string }>()
  if (!body.reason) return jsonErr('Reason required')
  const id = uid()
  await db.insert(cashDrops).values({ id, shift_id, user_id: actor.id, amount: body.amount, reason: body.reason, created_at: nowISO() })`,
  `  const body = await c.req.json<{ amount: number; reason: string }>()
  if (!body.reason) return jsonErr('Reason required')
  // FIX G: validate amount is a positive finite number
  if (!body.amount || body.amount <= 0 || !isFinite(body.amount)) return jsonErr('Amount must be a positive number')
  // FIX G: validate shift exists and is still open
  const shiftRec = await db.select({ status: shifts.status }).from(shifts).where(eq(shifts.id, shift_id)).get()
  if (!shiftRec) return jsonErr('Shift not found', 404)
  if (shiftRec.status !== 'open') return jsonErr('Cannot add a cash drop to a closed shift')
  const id = uid()
  await db.insert(cashDrops).values({ id, shift_id, user_id: actor.id, amount: body.amount, reason: body.reason, created_at: nowISO() })`,
  'FIX G: validate amount is a positive finite number'
)

// ══════════════════════════════════════════════════════════════════════════
// FIX H — recordPinFail: use null directly, not locked_until ?? undefined
// ══════════════════════════════════════════════════════════════════════════
banner('Fix H — recordPinFail: store null not undefined')
patch(
  'Fix H — recordPinFail null for locked_until',
  `  await db.insert(pinAttempts).values({
    identifier, attempts, locked_until: locked_until ?? undefined, updated_at: nowISO(),
  }).onConflictDoUpdate({
    target: pinAttempts.identifier,
    set: { attempts, locked_until: locked_until ?? undefined, updated_at: nowISO() },
  })`,
  `  // FIX H: pass locked_until directly (null when attempts < 5).
  // null ?? undefined = undefined which Drizzle drops from SET, leaving a
  // stale locked_until in place. Passing null generates SET locked_until = NULL.
  await db.insert(pinAttempts).values({
    identifier, attempts, locked_until: locked_until, updated_at: nowISO(),
  }).onConflictDoUpdate({
    target: pinAttempts.identifier,
    set: { attempts, locked_until: locked_until, updated_at: nowISO() },
  })`,
  'FIX H: pass locked_until directly (null when attempts < 5)'
)

// ── summary ────────────────────────────────────────────────────────────────
console.log('\n')
console.log('┌──────────────────────────────────────────────────────────┐')
console.log('│  MW-POS Backend Patch v3 — Complete                     │')
console.log('├──────────────────────────────────────────────────────────┤')
console.log(`│  Applied:      ${String(applied).padEnd(3)}  fix(es)                              │`)
console.log(`│  Already done: ${String(already).padEnd(3)}  (idempotent skips)                  │`)
console.log(`│  Skipped:      ${String(skipped).padEnd(3)}  (anchor not found)                  │`)
console.log('├──────────────────────────────────────────────────────────┤')
console.log('│  Fixes in this patch:                                    │')
console.log('│    A. category delete: items set to null not undefined   │')
console.log('│    B. void + refund restricted to admin role             │')
console.log('│    C. PUT /api/users/:id whitelists update fields        │')
console.log('│    D. receipt counter uses Manila date (UTC+8)           │')
console.log('│    E. all date-range filters use Manila→UTC (4 routes)   │')
console.log('│    F. PIN validated as 6 numeric digits                  │')
console.log('│    G. cash-drop validates amount > 0 + shift is open     │')
console.log('│    H. recordPinFail stores null not undefined            │')
console.log('├──────────────────────────────────────────────────────────┤')
console.log('│  Backup: worker/src/index.ts.v3-backup                   │')
console.log('│  Deploy: cd worker && npm run deploy                     │')
console.log('└──────────────────────────────────────────────────────────┘')

if (skipped > 0) {
  console.log(`\nNOTE: ${skipped} fix(es) were skipped (anchor not found).`)
  console.log('  This usually means your local file differs from the GitHub')
  console.log('  version — apply those fixes manually.\n')
  results.filter(r => r.status === 'skipped').forEach(r => console.log(`  • ${r.label}`))
}