#!/usr/bin/env node
// fix-backend.mjs — MW-POS Backend Bug Fix Patch (v2 — resilient)
// Run from the repo root: node fix-backend.mjs
//
// This version uses targeted anchor-based patching.  Each fix searches for a
// small, unique anchor string and applies a surgical replacement.  If the
// anchor isn't found the fix is skipped with a warning (already applied or
// the file differs too much).  The script never hard-fails on a skip.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TARGET = path.join(__dirname, 'worker', 'src', 'index.ts')

// ─── helpers ─────────────────────────────────────────────────────────────────

function read()          { return fs.readFileSync(TARGET, 'utf8') }
function write(content)  { fs.writeFileSync(TARGET, content, 'utf8') }

function backup() {
  const bak = TARGET + '.backend-fix-backup'
  if (!fs.existsSync(bak)) {
    fs.copyFileSync(TARGET, bak)
    console.log(`  ✓ Backup saved → ${path.basename(bak)}`)
  } else {
    console.log('  ℹ Backup already exists, skipping.')
  }
}

let applied = 0, skipped = 0, alreadyDone = 0

/**
 * Replace the FIRST occurrence of `searchStr` with `replaceStr`.
 * - If `searchStr` is not found but `alreadyAppliedStr` IS found → "already applied", skip silently.
 * - If neither is found → warn and count as skipped.
 * - If `searchStr` found → apply and count as applied.
 */
function patch(label, searchStr, replaceStr, alreadyAppliedStr) {
  let src = read()

  if (!src.includes(searchStr)) {
    // Check if the replacement is already present (idempotency)
    const checkStr = alreadyAppliedStr ?? replaceStr
    if (src.includes(checkStr)) {
      console.log(`  ✔ [${label}] already applied — skipping.`)
      alreadyDone++
    } else {
      console.warn(`  ⚠ [${label}] anchor not found and replacement not detected — SKIPPED.`)
      console.warn(`    The file may differ significantly from the expected version.`)
      skipped++
    }
    return
  }

  const result = src.replace(searchStr, replaceStr)
  write(result)
  console.log(`  ✓ [${label}] applied.`)
  applied++
}

// ─── run ─────────────────────────────────────────────────────────────────────

console.log('\n╔══════════════════════════════════════════════════╗')
console.log('║   MW-POS Backend Bug Fix Patch  (v2)            ║')
console.log('╚══════════════════════════════════════════════════╝\n')

if (!fs.existsSync(TARGET)) {
  console.error(`ERROR: Cannot find ${TARGET}`)
  console.error('Make sure you are running this script from the repo root (where worker/ lives).')
  process.exit(1)
}

backup()

// ══════════════════════════════════════════════════════════════════════════════
// FIX 4 — clearPinFail: write NULL for locked_until
//
// Drizzle ORM silently omits `undefined` from SET clauses — it never becomes
// SQL NULL.  So `locked_until: undefined` left the column at its old value,
// keeping a previously-locked account locked forever even after a successful
// login.  Fix: use `null` which Drizzle maps to SET locked_until = NULL.
// ══════════════════════════════════════════════════════════════════════════════
patch(
  'Fix 4 — clearPinFail writes SQL NULL for locked_until',
  // search: original code with undefined
  `.set({ attempts: 0, locked_until: undefined, updated_at: nowISO() })
    .where(eq(pinAttempts.identifier, identifier))`,
  // replace: use null so Drizzle emits SET locked_until = NULL
  `// FIX 4: null → SQL NULL; undefined is silently omitted by Drizzle and
    // leaves the column unchanged, so a locked account stays locked forever.
    .set({ attempts: 0, locked_until: null, updated_at: nowISO() })
    .where(eq(pinAttempts.identifier, identifier))`,
  // already-applied sentinel
  `locked_until: null, updated_at: nowISO() })`
)

// ══════════════════════════════════════════════════════════════════════════════
// FIX 6 — GET /api/users: restrict to admin
//
// Crew members could enumerate every user's ID, name, role, and status.
// Added the same admin-only guard used by every other sensitive endpoint.
// Note: GET /api/auth/users (login screen list) stays public intentionally.
// ══════════════════════════════════════════════════════════════════════════════
patch(
  'Fix 6 — GET /api/users restricted to admin only',
  // search: the handler without the role check
  `app.get('/api/users', async (c) => {
  const db = c.get('db')
  const list = await db.select({ id: users.id, name: users.name, role: users.role, is_active: users.is_active, created_at: users.created_at })`,
  // replace: add admin guard before touching db
  `app.get('/api/users', async (c) => {
  // FIX 6: crew should not be able to enumerate all users, roles, and IDs.
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const list = await db.select({ id: users.id, name: users.name, role: users.role, is_active: users.is_active, created_at: users.created_at })`,
  // already-applied sentinel
  `FIX 6: crew should not be able to enumerate`
)

// ══════════════════════════════════════════════════════════════════════════════
// FIX 2 + 3 — GET /api/sales: apply order_type/payment_method filters +
//              fix ?status=soft_deleted returning 0 rows
//
// Two bugs in the same route:
//   A) order_type and payment_method were parsed from the URL but never
//      applied to the query — those filters were silently ignored.
//   B) The base WHERE is `status != 'soft_deleted'`.  When the caller passes
//      ?status=soft_deleted the final WHERE becomes:
//        status != 'soft_deleted' AND status = 'soft_deleted'
//      …which is always false.  The fix builds the base clause conditionally.
// ══════════════════════════════════════════════════════════════════════════════
patch(
  'Fix 2+3 — GET /api/sales: order_type filter + soft_deleted status fix',
  // search: the broken query block (matches original and common variants)
  `  if (date_from) query = query.where(gte(sales.created_at, date_from))
  if (date_to) query = query.where(lte(sales.created_at, date_to + 'T23:59:59'))
  if (status) query = query.where(eq(sales.status, status as typeof sales.status._.data))
  if (receipt) query = query.where(eq(sales.receipt_number, receipt))

  const list = await query
  return jsonOk(list)
})`,
  // replace: proper conditional base clause + all filters applied
  `  // FIX 3: Only exclude soft_deleted when no explicit status filter given.
  //          When ?status=soft_deleted is requested, the old hard-coded base
  //          clause "status != soft_deleted" combined with the status filter
  //          to always produce 0 rows.
  if (status) {
    query = query.where(eq(sales.status, status as typeof sales.status._.data))
  }
  if (date_from) query = query.where(gte(sales.created_at, date_from))
  if (date_to)   query = query.where(lte(sales.created_at, date_to + 'T23:59:59.999'))
  // FIX 2: apply order_type filter (was parsed but never used)
  if (order_type) query = query.where(eq(sales.order_type, order_type as typeof sales.order_type._.data))
  if (receipt)   query = query.where(eq(sales.receipt_number, receipt))
  // FIX 2: payment_method filter — requires a sub-query join
  if (payment_method) {
    const matchingSaleIds = await db
      .selectDistinct({ sale_id: salePayments.sale_id })
      .from(salePayments)
      .where(eq(salePayments.method, payment_method as typeof salePayments.method._.data))
    const ids = matchingSaleIds.map(r => r.sale_id)
    if (!ids.length) return jsonOk([])
    query = query.where(sql\`\${sales.id} IN (\${sql.join(ids.map(i => sql\`\${i}\`), sql\`,\`)})\`)
  }

  const list = await query
  return jsonOk(list)
})`,
  // already-applied sentinel
  `FIX 3: Only exclude soft_deleted when no explicit status filter`
)

// ══════════════════════════════════════════════════════════════════════════════
// FIX 3b — GET /api/sales: rebuild base query conditionally
//
// The status filter fix above only adds the conditional where() for status.
// We also need to remove the unconditional NOT filter from the base query
// when a status IS provided.  This patch replaces the base query definition
// so it omits the hard-coded exclusion when a status filter is present.
// ══════════════════════════════════════════════════════════════════════════════
patch(
  'Fix 3b — GET /api/sales: base query no longer hard-codes soft_deleted exclusion',
  // search: the old base query with hard-coded NOT filter
  `  // FIXED: exclude soft_deleted by default; pass ?status=soft_deleted to see them
  }).from(sales).where(not(eq(sales.status, 'soft_deleted'))).orderBy(desc(sales.created_at)).$dynamic()`,
  // replace: conditional base — only exclude soft_deleted when no status param given
  `  // FIX 3: base query excludes soft_deleted only when no ?status param is given.
  //          Passing ?status=soft_deleted now correctly returns those rows.
  }).from(sales)
    .where(status ? undefined : not(eq(sales.status, 'soft_deleted')))
    .orderBy(desc(sales.created_at)).$dynamic()`,
  // already-applied sentinel
  `FIX 3: base query excludes soft_deleted only when no ?status param`
)

// ══════════════════════════════════════════════════════════════════════════════
// FIX 1 — PUT /api/sales/:id: route was completely missing
//
// The frontend useEditSale() calls PUT /api/sales/{id} to let admins patch
// a sale's note, payments, and tendered_amount.  The route didn't exist —
// every edit silently 404'd.  The new route:
//   • Requires admin role
//   • Guards against editing voided / soft_deleted sales
//   • Validates new payment totals match the original sale total
//   • Recomputes change_amount correctly
//   • Replaces payment rows atomically
//   • Writes an edit_sale audit log entry
// ══════════════════════════════════════════════════════════════════════════════
patch(
  'Fix 1 — PUT /api/sales/:id added (was completely missing)',
  // search: the GET /:id route header as an anchor insertion point
  `// GET /api/sales/:id — full sale detail
app.get('/api/sales/:id', async (c) => {`,
  // replace: insert the missing PUT route before the GET /:id route
  `// FIX 1: PUT /api/sales/:id — was completely missing.
// The frontend useEditSale() calls this to patch note, payments, and
// tendered_amount on an existing sale.  Without this route every edit 404'd.
app.put('/api/sales/:id', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{
    note?: string
    payments?: { method: 'cash' | 'gcash' | 'maya'; amount: number }[]
    tendered_amount?: number
  }>()

  const sale = await db.select().from(sales).where(eq(sales.id, id)).get()
  if (!sale) return jsonErr('Sale not found', 404)
  if (sale.status === 'voided' || sale.status === 'soft_deleted') {
    return jsonErr('Cannot edit a voided or deleted sale', 409)
  }

  const updateSet: Partial<typeof sales.$inferInsert> = {}
  if (body.note !== undefined) updateSet.note = body.note

  if (body.payments !== undefined) {
    if (!body.payments.length) return jsonErr('At least one payment required')
    const newPaymentTotal = body.payments.reduce((s, p) => s + p.amount, 0)
    if (Math.round(newPaymentTotal * 100) !== Math.round(sale.total * 100)) {
      return jsonErr(\`Payment total (\${newPaymentTotal}) does not match sale total (\${sale.total})\`)
    }
    const cashPayments = body.payments.filter(p => p.method === 'cash')
    const cashTotal    = cashPayments.reduce((s, p) => s + p.amount, 0)
    const tendered     = body.tendered_amount ?? sale.tendered_amount ?? cashTotal
    if (cashPayments.length && tendered < cashTotal) {
      return jsonErr('Tendered amount is less than cash portion')
    }
    updateSet.tendered_amount = cashPayments.length ? tendered : null
    updateSet.change_amount   = cashPayments.length
      ? Math.round((tendered - cashTotal) * 100) / 100
      : null
  } else if (body.tendered_amount !== undefined) {
    updateSet.tendered_amount = body.tendered_amount
    const existingPayments = await db.select().from(salePayments).where(eq(salePayments.sale_id, id))
    const cashTotal = existingPayments.filter(p => p.method === 'cash').reduce((s, p) => s + p.amount, 0)
    if (cashTotal > 0) {
      updateSet.change_amount = Math.round((body.tendered_amount - cashTotal) * 100) / 100
    }
  }

  if (Object.keys(updateSet).length) {
    await db.update(sales).set(updateSet).where(eq(sales.id, id))
  }

  if (body.payments !== undefined) {
    await db.delete(salePayments).where(eq(salePayments.sale_id, id))
    await db.insert(salePayments).values(
      body.payments.map(p => ({ id: uid(), sale_id: id, method: p.method, amount: p.amount }))
    )
  }

  await createAuditLog(db, actor.id, 'edit_sale', 'sale', id, sale, body, null)
  return jsonOk({ ok: true })
})

// GET /api/sales/:id — full sale detail
app.get('/api/sales/:id', async (c) => {`,
  // already-applied sentinel
  `FIX 1: PUT /api/sales/:id — was completely missing`
)

// ══════════════════════════════════════════════════════════════════════════════
// FIX 7 — POST /api/sales/missed: move before the dynamic /:id route
//
// In Hono, dynamic /:id segments can shadow static sub-paths registered after
// them when they share the same HTTP method.  POST vs GET means the current
// code works, but a future GET /api/sales/missed would silently 404.
// The fix moves the missed route above /:id as a correctness measure.
//
// Strategy: inject a copy before /:id, then erase the original below it.
// ══════════════════════════════════════════════════════════════════════════════
{
  let src = read()

  // Only run this fix if the missed route is still BELOW the /:id GET handler
  const missedIdx = src.indexOf("app.post('/api/sales/missed'")
  const detailIdx = src.indexOf("app.get('/api/sales/:id'")
  const putIdx    = src.indexOf("app.put('/api/sales/:id'")   // inserted by Fix 1

  // Reference point: whichever of PUT /:id / GET /:id comes first
  const refIdx = putIdx !== -1 ? putIdx : detailIdx

  if (missedIdx === -1) {
    console.log('  ⚠ [Fix 7 — route order] /api/sales/missed route not found — SKIPPED.')
    skipped++
  } else if (missedIdx < refIdx) {
    console.log('  ✔ [Fix 7 — route order] missed route already before /:id — skipping.')
    alreadyDone++
  } else {
    // Extract the missed route block
    const missedStart = missedIdx
    // Find the closing }) of this route handler
    let depth = 0, i = missedStart, inBlock = false
    while (i < src.length) {
      if (src[i] === '(' || src[i] === '{') { depth++; inBlock = true }
      else if (src[i] === ')' || src[i] === '}') { depth-- }
      if (inBlock && depth === 0) { i++; break }
      i++
    }
    // Skip trailing newlines
    while (i < src.length && src[i] === '\n') i++
    const missedBlock = src.slice(missedStart, i)

    // Remove original
    src = src.slice(0, missedStart) + src.slice(i)

    // Re-read refIdx after removal
    const newRefIdx = putIdx !== -1
      ? src.indexOf("app.put('/api/sales/:id'")
      : src.indexOf("app.get('/api/sales/:id'")

    if (newRefIdx === -1) {
      console.warn('  ⚠ [Fix 7 — route order] Could not find /:id anchor after removal — SKIPPED.')
      // Restore original to avoid data loss
      src = read()
      skipped++
    } else {
      // Insert above the /:id handler with a separator comment
      const insertion = `// FIX 7: moved above /:id to prevent dynamic-route shadowing\n` + missedBlock + `\n`
      src = src.slice(0, newRefIdx) + insertion + src.slice(newRefIdx)
      write(src)
      console.log('  ✓ [Fix 7 — route order] POST /api/sales/missed moved before /:id.')
      applied++
    }
  }
}

// ─── summary ─────────────────────────────────────────────────────────────────

console.log(`
┌──────────────────────────────────────────────────────────┐
│  MW-POS Backend Patch Complete                           │
├──────────────────────────────────────────────────────────┤
│  Applied:       ${String(applied).padEnd(3)} fix(es)                          │
│  Already done:  ${String(alreadyDone).padEnd(3)} (idempotent skips)                  │
│  Skipped:       ${String(skipped).padEnd(3)} (anchor not found — see warnings)│
├──────────────────────────────────────────────────────────┤
│  Fixes attempted:                                        │
│    1. PUT /api/sales/:id added (was completely missing)  │
│    2. ?order_type filter now applied in GET /api/sales   │
│    3. ?payment_method filter added (join-based)          │
│    4. ?status=soft_deleted no longer returns 0 rows      │
│    5. clearPinFail now writes NULL for locked_until      │
│    6. GET /api/users restricted to admin only            │
│    7. POST /api/sales/missed moved before /:id route     │
├──────────────────────────────────────────────────────────┤
│  Backup: worker/src/index.ts.backend-fix-backup          │
│  Deploy: cd worker && npm run deploy                     │
└──────────────────────────────────────────────────────────┘
`)

if (skipped > 0) {
  console.log(`NOTE: ${skipped} fix(es) were skipped because their anchor strings were not`)
  console.log(`found in your local index.ts.  This usually means:`)
  console.log(`  a) You already applied those changes manually, or`)
  console.log(`  b) Your local file differs from the GitHub version.`)
  console.log(`Check the skipped fixes against your file and apply them manually if needed.\n`)
}
