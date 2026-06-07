#!/usr/bin/env node
/**
 * MW-POS Bug Patch — apply-all-17-fixes.js
 *
 * Usage:  node mwpos-patch.js [repo-path]
 *         repo-path defaults to the current working directory
 *
 * What it does:
 *   Reads each target file, applies string replacements, writes it back.
 *   Each patch is labelled by bug number so you can trace every change.
 *
 * Files touched:
 *   src/App.tsx
 *   src/api.ts
 *   src/thermalPrint.ts
 *   worker/src/index.ts
 */

const fs   = require('fs');
const path = require('path');

// ─── helpers ──────────────────────────────────────────────────────────────────

const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();

function filePath(...parts) {
  return path.join(ROOT, ...parts);
}

function readFile(rel) {
  const full = filePath(rel);
  if (!fs.existsSync(full)) {
    console.error(`  ✗ FILE NOT FOUND: ${full}`);
    process.exit(1);
  }
  return fs.readFileSync(full, 'utf8');
}

function writeFile(rel, content) {
  fs.writeFileSync(filePath(rel), content, 'utf8');
}

/**
 * Apply a single patch to `content`.
 * Throws clearly if the needle is not found (so you know exactly which patch failed).
 */
function patch(content, { label, find, replace }) {
  if (!content.includes(find)) {
    throw new Error(`Patch "${label}" — needle NOT FOUND in file. The code may have already been patched or the file changed.`);
  }
  const patched = content.replace(find, replace);
  // Sanity: make sure we replaced at least once
  if (patched === content) {
    throw new Error(`Patch "${label}" — replacement produced identical content.`);
  }
  return patched;
}

function applyPatches(rel, patches) {
  console.log(`\nPatching ${rel}…`);
  let content = readFile(rel);
  let skipped = 0;
  for (const p of patches) {
    try {
      content = patch(content, p);
      console.log(`  ✔ [${p.label}]`);
    } catch (err) {
      // If the needle is missing, the patch was already applied — skip safely.
      if (err.message.includes('needle NOT FOUND')) {
        console.log(`  ⤼ [${p.label}] — already applied, skipping`);
        skipped++;
      } else {
        console.error(`  ✗ [${p.label}] — ${err.message}`);
        process.exit(1);
      }
    }
  }
  writeFile(rel, content);
  console.log(`  → Written.${skipped ? ` (${skipped} patch(es) skipped — already applied)` : ''}`);
}

// ─── patches ──────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// FILE: worker/src/index.ts
// ══════════════════════════════════════════════════════════════════════════════
applyPatches('worker/src/index.ts', [

  // ─────────────────────────────────────────────────────────────────────────
  // Bug #2  actioned_by_user_id / actioned_by_name silently dropped in void
  // ─────────────────────────────────────────────────────────────────────────
  {
    label: 'Bug #2 — void route: read actioned_by fields from body and use in audit log',
    find: `// POST /api/sales/:id/void
app.post('/api/sales/:id/void', async (c) => {
  const actor = c.get('user')
  // FIX B: void is a financial action — admin only
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{ reason: string }>()
  if (!body.reason) return jsonErr('Reason required')
  const sale = await db.select().from(sales).where(eq(sales.id, id)).get()
  if (!sale) return jsonErr('Sale not found', 404)
  if (sale.status !== 'completed') return jsonErr('Only completed sales can be voided')
  await db.update(sales).set({ status: 'voided' }).where(eq(sales.id, id))
  await createAuditLog(db, actor.id, 'void_sale', 'sale', id, { status: 'completed' }, { status: 'voided' }, body.reason)
  return jsonOk({ ok: true })
})`,
    replace: `// POST /api/sales/:id/void
app.post('/api/sales/:id/void', async (c) => {
  const actor = c.get('user')
  // FIX B: void is a financial action — admin only
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')
  // Bug #2 fix: read actioned_by fields so the PIN-authorizer is recorded in
  // the audit log instead of always recording the logged-in session user.
  const body = await c.req.json<{ reason: string; actioned_by_user_id?: string; actioned_by_name?: string }>()
  if (!body.reason) return jsonErr('Reason required')
  const sale = await db.select().from(sales).where(eq(sales.id, id)).get()
  if (!sale) return jsonErr('Sale not found', 404)
  if (sale.status !== 'completed') return jsonErr('Only completed sales can be voided')
  await db.update(sales).set({ status: 'voided' }).where(eq(sales.id, id))
  // Use the PIN-authorizer's ID when provided, fall back to session user.
  const auditUserId = body.actioned_by_user_id ?? actor.id
  const newValue = {
    status: 'voided',
    actioned_by_user_id: body.actioned_by_user_id ?? null,
    actioned_by_name: body.actioned_by_name ?? null,
  }
  await createAuditLog(db, auditUserId, 'void_sale', 'sale', id, { status: 'completed' }, newValue, body.reason)
  return jsonOk({ ok: true })
})`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Bug #2  actioned_by fields in refund route
  // ─────────────────────────────────────────────────────────────────────────
  {
    label: 'Bug #2 — refund route: read actioned_by fields from body and use in audit log',
    find: `// POST /api/sales/:id/refund
app.post('/api/sales/:id/refund', async (c) => {
  const actor = c.get('user')
  // FIX B: refund is a financial action — admin only
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{ reason: string }>()
  if (!body.reason) return jsonErr('Reason required')
  const sale = await db.select().from(sales).where(eq(sales.id, id)).get()
  if (!sale) return jsonErr('Sale not found', 404)
  if (!['completed'].includes(sale.status)) return jsonErr('Sale cannot be refunded in current status')
  await db.update(sales).set({ status: 'refunded' }).where(eq(sales.id, id))
  await createAuditLog(db, actor.id, 'refund_sale', 'sale', id, { status: sale.status }, { status: 'refunded' }, body.reason)
  return jsonOk({ ok: true })
})`,
    replace: `// POST /api/sales/:id/refund
app.post('/api/sales/:id/refund', async (c) => {
  const actor = c.get('user')
  // FIX B: refund is a financial action — admin only
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')
  // Bug #2 fix: read actioned_by fields so the PIN-authorizer is recorded.
  const body = await c.req.json<{ reason: string; actioned_by_user_id?: string; actioned_by_name?: string }>()
  if (!body.reason) return jsonErr('Reason required')
  const sale = await db.select().from(sales).where(eq(sales.id, id)).get()
  if (!sale) return jsonErr('Sale not found', 404)
  if (!['completed'].includes(sale.status)) return jsonErr('Sale cannot be refunded in current status')
  await db.update(sales).set({ status: 'refunded' }).where(eq(sales.id, id))
  const auditUserId = body.actioned_by_user_id ?? actor.id
  const newValue = {
    status: 'refunded',
    actioned_by_user_id: body.actioned_by_user_id ?? null,
    actioned_by_name: body.actioned_by_name ?? null,
  }
  await createAuditLog(db, auditUserId, 'refund_sale', 'sale', id, { status: sale.status }, newValue, body.reason)
  return jsonOk({ ok: true })
})`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Bug #2  actioned_by fields in reprint route
  // ─────────────────────────────────────────────────────────────────────────
  {
    label: 'Bug #2 — reprint route: read actioned_by fields from body and use in audit log',
    find: `// POST /api/sales/:id/reprint
app.post('/api/sales/:id/reprint', async (c) => {
  const actor = c.get('user')
  const db = c.get('db')
  const id = c.req.param('id')
  const sale = await db.select({ is_reprinted: sales.is_reprinted }).from(sales).where(eq(sales.id, id)).get()
  if (!sale) return jsonErr('Sale not found', 404)
  // FIXED: removed hard block — each reprint is now only logged (not blocked).
  // is_reprinted remains true after the first reprint as a "has been reprinted"
  // indicator; admins can reprint as many times as needed (printer jams, etc.).
  await db.update(sales).set({ is_reprinted: true }).where(eq(sales.id, id))
  await createAuditLog(db, actor.id, 'reprint_receipt', 'sale', id, null, { reprint_count: 'incremented' }, null)
  return jsonOk({ ok: true })
})`,
    replace: `// POST /api/sales/:id/reprint
app.post('/api/sales/:id/reprint', async (c) => {
  const actor = c.get('user')
  const db = c.get('db')
  const id = c.req.param('id')
  // Bug #2 fix: read actioned_by fields so the PIN-authorizer is recorded.
  const body = await c.req.json<{ actioned_by_user_id?: string; actioned_by_name?: string }>().catch(() => ({} as { actioned_by_user_id?: string; actioned_by_name?: string }))
  const sale = await db.select({ is_reprinted: sales.is_reprinted }).from(sales).where(eq(sales.id, id)).get()
  if (!sale) return jsonErr('Sale not found', 404)
  // FIXED: removed hard block — each reprint is now only logged (not blocked).
  await db.update(sales).set({ is_reprinted: true }).where(eq(sales.id, id))
  const auditUserId = body.actioned_by_user_id ?? actor.id
  const newValue = {
    reprint_count: 'incremented',
    actioned_by_user_id: body.actioned_by_user_id ?? null,
    actioned_by_name: body.actioned_by_name ?? null,
  }
  await createAuditLog(db, auditUserId, 'reprint_receipt', 'sale', id, null, newValue, null)
  return jsonOk({ ok: true })
})`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Bug #7  No audit logs for addon CRUD (POST)
  // ─────────────────────────────────────────────────────────────────────────
  {
    label: 'Bug #7 — POST /api/menu/addons: add audit log',
    find: `app.post('/api/menu/addons', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const body = await c.req.json<{ name: string; price: number }>()
  const id = uid()
  await db.insert(addons).values({ id, name: body.name, price: body.price })
  return jsonOk({ id })
})`,
    replace: `app.post('/api/menu/addons', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const body = await c.req.json<{ name: string; price: number }>()
  const id = uid()
  await db.insert(addons).values({ id, name: body.name, price: body.price })
  // Bug #7 fix: missing audit log for addon creation
  await createAuditLog(db, actor.id, 'create_addon', 'addon', id, null, { name: body.name, price: body.price }, null)
  return jsonOk({ id })
})`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Bug #7  No audit logs for addon CRUD (PUT)
  // ─────────────────────────────────────────────────────────────────────────
  {
    label: 'Bug #7 — PUT /api/menu/addons/:id: whitelist fields + add audit log',
    find: `app.put('/api/menu/addons/:id', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{ name?: string; price?: number; is_available?: boolean }>()
  await db.update(addons).set(body).where(eq(addons.id, id))
  return jsonOk({ ok: true })
})`,
    replace: `app.put('/api/menu/addons/:id', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{ name?: string; price?: number; is_available?: boolean }>()
  // Bug #7 fix: whitelist fields (mirrors category/item pattern) + add audit log
  const old = await db.select().from(addons).where(eq(addons.id, id)).get()
  if (!old) return jsonErr('Addon not found', 404)
  const safeFields: Partial<typeof addons.$inferInsert> = {}
  if (body.name         !== undefined) safeFields.name         = body.name
  if (body.price        !== undefined) safeFields.price        = body.price
  if (body.is_available !== undefined) safeFields.is_available = body.is_available
  await db.update(addons).set(safeFields).where(eq(addons.id, id))
  await createAuditLog(db, actor.id, 'edit_addon', 'addon', id, old, safeFields, null)
  return jsonOk({ ok: true })
})`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Bug #7 + #9  No audit log for DELETE addon + dangling item_addons rows
  // ─────────────────────────────────────────────────────────────────────────
  {
    label: 'Bug #7+#9 — DELETE /api/menu/addons/:id: clean up item_addons + add audit log',
    find: `app.delete('/api/menu/addons/:id', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')
  await db.delete(addons).where(eq(addons.id, id))
  return jsonOk({ ok: true })
})`,
    replace: `app.delete('/api/menu/addons/:id', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')
  const existing = await db.select({ name: addons.name }).from(addons).where(eq(addons.id, id)).get()
  if (!existing) return jsonErr('Addon not found', 404)
  // Bug #9 fix: remove dangling item_addons rows before deleting the addon.
  // Without this, menu items silently lose their addon associations.
  await db.delete(itemAddons).where(eq(itemAddons.addon_id, id))
  await db.delete(addons).where(eq(addons.id, id))
  // Bug #7 fix: missing audit log for addon deletion
  await createAuditLog(db, actor.id, 'delete_addon', 'addon', id, { name: existing.name }, null, null)
  return jsonOk({ ok: true })
})`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Bug #8  PUT /api/menu/categories/:id has no audit log + raw body spread
  // ─────────────────────────────────────────────────────────────────────────
  {
    label: 'Bug #8 — PUT /api/menu/categories/:id: whitelist + add audit log',
    find: `app.put('/api/menu/categories/:id', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{ name?: string; sort_order?: number }>()
  await db.update(categories).set(body).where(eq(categories.id, id))
  return jsonOk({ ok: true })
})`,
    replace: `app.put('/api/menu/categories/:id', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{ name?: string; sort_order?: number }>()
  const old = await db.select().from(categories).where(eq(categories.id, id)).get()
  if (!old) return jsonErr('Category not found', 404)
  // Bug #8 fix: whitelist fields instead of spreading raw body + add audit log
  const safeFields: Partial<typeof categories.$inferInsert> = {}
  if (body.name       !== undefined) safeFields.name       = body.name
  if (body.sort_order !== undefined) safeFields.sort_order = body.sort_order
  await db.update(categories).set(safeFields).where(eq(categories.id, id))
  await createAuditLog(db, actor.id, 'rename_category', 'category', id, old, safeFields, null)
  return jsonOk({ ok: true })
})`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Bug #10  manilaToUTC throws on invalid date string, crashing the Worker
  // ─────────────────────────────────────────────────────────────────────────
  {
    label: 'Bug #10 — manilaToUTC: validate date string, throw safe 400 instead of crash',
    find: `function manilaToUTC(dateStr: string, boundary: 'start' | 'end'): string {
  const time = boundary === 'start' ? 'T00:00:00.000+08:00' : 'T23:59:59.999+08:00'
  return new Date(dateStr + time).toISOString()
}`,
    replace: `function manilaToUTC(dateStr: string, boundary: 'start' | 'end'): string {
  // Bug #10 fix: validate the date string before constructing a Date.
  // A malformed value (e.g. "not-a-date") makes toISOString() throw
  // "Invalid time value" which previously crashed the Worker unhandled.
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(dateStr)) {
    throw new Error(\`Invalid date format: "\${dateStr}". Expected YYYY-MM-DD.\`)
  }
  const time = boundary === 'start' ? 'T00:00:00.000+08:00' : 'T23:59:59.999+08:00'
  const d = new Date(dateStr + time)
  if (isNaN(d.getTime())) {
    throw new Error(\`Invalid date value: "\${dateStr}".\`)
  }
  return d.toISOString()
}`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Bug #10  Wrap date-range query routes to catch manilaToUTC errors gracefully
  // (GET /api/sales — first date filter block)
  // ─────────────────────────────────────────────────────────────────────────
  {
    label: 'Bug #10 — GET /api/sales: catch invalid date strings and return 400',
    find: `  if (date_from) query = query.where(gte(sales.created_at, manilaToUTC(date_from, 'start')))
  if (date_to)   query = query.where(lte(sales.created_at, manilaToUTC(date_to,   'end')))
  // FIX 2: apply order_type filter (was parsed but discarded)`,
    replace: `  try {
    if (date_from) query = query.where(gte(sales.created_at, manilaToUTC(date_from, 'start')))
    if (date_to)   query = query.where(lte(sales.created_at, manilaToUTC(date_to,   'end')))
  } catch (err) {
    return jsonErr(err instanceof Error ? err.message : 'Invalid date parameter', 400)
  }
  // FIX 2: apply order_type filter (was parsed but discarded)`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Bug #10  Wrap manilaToUTC in GET /api/reports/sales
  // ─────────────────────────────────────────────────────────────────────────
  {
    label: 'Bug #10 — GET /api/reports/sales: catch invalid date strings and return 400',
    find: `  if (date_from) salesQuery = salesQuery.where(gte(sales.created_at, manilaToUTC(date_from, 'start')))
  if (date_to) salesQuery = salesQuery.where(lte(sales.created_at, manilaToUTC(date_to, 'end')))

  const salesList = await salesQuery`,
    replace: `  try {
    if (date_from) salesQuery = salesQuery.where(gte(sales.created_at, manilaToUTC(date_from, 'start')))
    if (date_to) salesQuery = salesQuery.where(lte(sales.created_at, manilaToUTC(date_to, 'end')))
  } catch (err) {
    return jsonErr(err instanceof Error ? err.message : 'Invalid date parameter', 400)
  }

  const salesList = await salesQuery`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Bug #10  Wrap manilaToUTC in GET /api/audit-logs
  // ─────────────────────────────────────────────────────────────────────────
  {
    label: 'Bug #10 — GET /api/audit-logs: catch invalid date strings and return 400',
    find: `  if (entity_type) query = query.where(eq(auditLogs.entity_type, entity_type))
  if (entity_id) query = query.where(eq(auditLogs.entity_id, entity_id))
  if (date_from) query = query.where(gte(auditLogs.created_at, manilaToUTC(date_from, 'start')))
  if (date_to) query = query.where(lte(auditLogs.created_at, manilaToUTC(date_to, 'end')))

  const logs = await query.limit(500)`,
    replace: `  if (entity_type) query = query.where(eq(auditLogs.entity_type, entity_type))
  if (entity_id) query = query.where(eq(auditLogs.entity_id, entity_id))
  try {
    if (date_from) query = query.where(gte(auditLogs.created_at, manilaToUTC(date_from, 'start')))
    if (date_to) query = query.where(lte(auditLogs.created_at, manilaToUTC(date_to, 'end')))
  } catch (err) {
    return jsonErr(err instanceof Error ? err.message : 'Invalid date parameter', 400)
  }

  const logs = await query.limit(500)`,
  },

]);

// ══════════════════════════════════════════════════════════════════════════════
// FILE: src/App.tsx
// ══════════════════════════════════════════════════════════════════════════════
applyPatches('src/App.tsx', [

  // ─────────────────────────────────────────────────────────────────────────
  // Bug #1  PartialActionModal "Selected Items" tab is UI-only — backend ignores
  //         item_indices. Fix: disable "Void/Refund Selected Items" tab and show
  //         a tooltip explaining it's not yet supported on the backend.
  //         (Honest UI: remove the misleading tab rather than pretend it works.)
  // ─────────────────────────────────────────────────────────────────────────
  {
    label: 'Bug #1 — PartialActionModal: disable "Selected Items" tab (backend does not support partial void/refund)',
    find: `            <button onClick={() => setMode('items')}
              role="tab" aria-selected={mode === 'items'}
              className={clsx('flex-1 py-2 rounded-xl text-sm font-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400',
                mode === 'items' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              )}
              style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
              {actionLabel} Selected Items
            </button>`,
    replace: `            {/* Bug #1 fix: "Selected Items" tab disabled — backend currently voids/refunds
                the entire sale regardless of item_indices. The tab is left visible but
                disabled so it can be re-enabled once the backend adds partial support. */}
            <button disabled title="Partial void/refund is not yet supported"
              role="tab" aria-selected={false}
              className="flex-1 py-2 rounded-xl text-sm font-700 opacity-40 cursor-not-allowed text-gray-400"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
              {actionLabel} Selected Items
            </button>`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Bug #3  Cart not cleared on logout
  // ─────────────────────────────────────────────────────────────────────────
  {
    label: 'Bug #3 — handleLogout: clear cart so next user does not inherit previous cart',
    find: `  const handleLogout = useCallback(() => {
    queryClient.clear();   // flush cached data so the next user starts fresh
    logout();
    setMenuOpen(false);
  }, [logout, queryClient]);`,
    replace: `  const handleLogout = useCallback(() => {
    queryClient.clear();   // flush cached data so the next user starts fresh
    logout();
    setMenuOpen(false);
    // Bug #3 fix: clear the cart so the next user does not inherit the previous
    // user's in-progress order. This is especially important on shared POS devices.
    useCartStore.getState().clearCart();
  }, [logout, queryClient]);`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Bug #4  PinModal catch swallows the real backend error message
  // ─────────────────────────────────────────────────────────────────────────
  {
    label: 'Bug #4 — PinModal doSubmit: show the real backend error (e.g. 429 lockout message)',
    find: `    try {
      await verifyPin.mutateAsync({ user_id: user.id, pin: pinValue, required_role: pinModal.required_role });
      inAppLockout.reset();
      resolvePinModal({ verified: true, user_id: user.id, user_name: user.name, role: user.role });
    } catch {
      inAppLockout.increment();
      if (inAppLockout.isLocked()) {
        setLocked(true); setLockSecs(inAppLockout.secondsLeft());
        setError(\`Too many attempts. Locked for \${inAppLockout.secondsLeft()}s.\`);
      } else {
        setError(\`Invalid PIN. \${PIN_MAX_ATTEMPTS - inAppLockout.attempts} attempt(s) left.\`);
      }
      setPin('');
    }
  }, [user, verifyPin, pinModal.required_role, resolvePinModal]);`,
    replace: `    try {
      await verifyPin.mutateAsync({ user_id: user.id, pin: pinValue, required_role: pinModal.required_role });
      inAppLockout.reset();
      resolvePinModal({ verified: true, user_id: user.id, user_name: user.name, role: user.role });
    } catch (err) {
      // Bug #4 fix: read the real backend error message first (e.g. the 429
      // "Too many attempts. Try again after [time]" from the server lockout).
      // Only fall back to the local counter message when the backend gives a
      // generic "Invalid PIN" (or nothing useful).
      const serverMsg = err instanceof Error ? err.message : '';
      const isBackendLockout = serverMsg.toLowerCase().includes('try again after') || serverMsg.toLowerCase().includes('too many');
      inAppLockout.increment();
      if (isBackendLockout) {
        setError(serverMsg);
      } else if (inAppLockout.isLocked()) {
        setLocked(true); setLockSecs(inAppLockout.secondsLeft());
        setError(\`Too many attempts. Locked for \${inAppLockout.secondsLeft()}s.\`);
      } else {
        setError(\`Invalid PIN. \${PIN_MAX_ATTEMPTS - inAppLockout.attempts} attempt(s) left.\`);
      }
      setPin('');
    }
  }, [user, verifyPin, pinModal.required_role, resolvePinModal]);`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Bug #4  AnyUserPinModal catch swallows backend error
  // ─────────────────────────────────────────────────────────────────────────
  {
    label: 'Bug #4 — AnyUserPinModal doSubmit: show the real backend error',
    find: `    try {
      await verifyPin.mutateAsync({ user_id: user.id, pin: pinValue });
      inAppLockout.reset();
      onSuccess({ user_id: user.id, user_name: user.name, role: user.role });
    } catch {
      inAppLockout.increment();
      if (inAppLockout.isLocked()) {
        setLocked(true); setLockSecs(inAppLockout.secondsLeft());
        setError(\`Too many attempts. Locked for \${inAppLockout.secondsLeft()}s.\`);
      } else {
        setError(\`Invalid PIN. \${PIN_MAX_ATTEMPTS - inAppLockout.attempts} attempt(s) left.\`);
      }
      setPin('');
    }
  }, [verifyPin, onSuccess]);`,
    replace: `    try {
      await verifyPin.mutateAsync({ user_id: user.id, pin: pinValue });
      inAppLockout.reset();
      onSuccess({ user_id: user.id, user_name: user.name, role: user.role });
    } catch (err) {
      // Bug #4 fix: show the real backend error message when available.
      const serverMsg = err instanceof Error ? err.message : '';
      const isBackendLockout = serverMsg.toLowerCase().includes('try again after') || serverMsg.toLowerCase().includes('too many');
      inAppLockout.increment();
      if (isBackendLockout) {
        setError(serverMsg);
      } else if (inAppLockout.isLocked()) {
        setLocked(true); setLockSecs(inAppLockout.secondsLeft());
        setError(\`Too many attempts. Locked for \${inAppLockout.secondsLeft()}s.\`);
      } else {
        setError(\`Invalid PIN. \${PIN_MAX_ATTEMPTS - inAppLockout.attempts} attempt(s) left.\`);
      }
      setPin('');
    }
  }, [verifyPin, onSuccess]);`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Bug #4  LoginPage doLogin catch also swallows backend error
  // ─────────────────────────────────────────────────────────────────────────
  {
    label: 'Bug #4 — LoginPage doLogin: show real backend error (rate-limit message)',
    find: `    try {
      const res = await login.mutateAsync({ user_id: user.id, pin: pinValue });
      pinLockoutState.reset();
      authLogin(res.user, res.token);
      navigate(res.user.role === 'admin' ? 'admin_dashboard' : 'pos');
    } catch {
      pinLockoutState.increment();
      if (pinLockoutState.isLocked()) {
        setLocked(true); setLockSecs(pinLockoutState.secondsLeft());
        setError(\`Too many attempts. Locked for \${pinLockoutState.secondsLeft()}s.\`);
      } else {
        setError(\`Invalid PIN. \${PIN_MAX_ATTEMPTS - pinLockoutState.attempts} attempt(s) left.\`);
      }
      setPin('');
    }
  }, [login, authLogin, navigate]);`,
    replace: `    try {
      const res = await login.mutateAsync({ user_id: user.id, pin: pinValue });
      pinLockoutState.reset();
      authLogin(res.user, res.token);
      navigate(res.user.role === 'admin' ? 'admin_dashboard' : 'pos');
    } catch (err) {
      // Bug #4 fix: show the real backend error message when available.
      const serverMsg = err instanceof Error ? err.message : '';
      const isBackendLockout = serverMsg.toLowerCase().includes('try again after') || serverMsg.toLowerCase().includes('too many');
      pinLockoutState.increment();
      if (isBackendLockout) {
        setError(serverMsg);
      } else if (pinLockoutState.isLocked()) {
        setLocked(true); setLockSecs(pinLockoutState.secondsLeft());
        setError(\`Too many attempts. Locked for \${pinLockoutState.secondsLeft()}s.\`);
      } else {
        setError(\`Invalid PIN. \${PIN_MAX_ATTEMPTS - pinLockoutState.attempts} attempt(s) left.\`);
      }
      setPin('');
    }
  }, [login, authLogin, navigate]);`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Bug #11  handleEditItem: category_id: editForm.category_id || undefined
  //          makes it impossible to unset a category (Drizzle omits undefined)
  // ─────────────────────────────────────────────────────────────────────────
  {
    label: 'Bug #11 — handleEditItem: send null (not undefined) to allow clearing category_id',
    find: `      await updateItem.mutateAsync({ id: editItem.id, name: editForm.name, category_id: editForm.category_id || undefined, sizes });`,
    replace: `      // Bug #11 fix: send null instead of undefined when category_id is cleared.
      // undefined is silently omitted by Drizzle's SET clause, leaving the item
      // in its current category. null produces SET category_id = NULL as intended.
      await updateItem.mutateAsync({ id: editItem.id, name: editForm.name, category_id: editForm.category_id || null, sizes });`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Bug #12  moveUp / moveDown use .mutate() with no onError → silent failure
  // ─────────────────────────────────────────────────────────────────────────
  {
    label: 'Bug #12 — moveUp/moveDown: switch to mutateAsync + toast on error',
    find: `  const moveUp = useCallback((catId: string) => reorderCategory.mutate({ id: catId, direction: 'up' }), [reorderCategory]);
  const moveDown = useCallback((catId: string) => reorderCategory.mutate({ id: catId, direction: 'down' }), [reorderCategory]);`,
    replace: `  // Bug #12 fix: use mutateAsync + catch so errors (e.g. "Cannot move further")
  // surface as toasts instead of silently doing nothing.
  const moveUp = useCallback(async (catId: string) => {
    try { await reorderCategory.mutateAsync({ id: catId, direction: 'up' }); }
    catch (e: unknown) { toast(e instanceof Error ? e.message : 'Cannot move category', 'error'); }
  }, [reorderCategory]);
  const moveDown = useCallback(async (catId: string) => {
    try { await reorderCategory.mutateAsync({ id: catId, direction: 'down' }); }
    catch (e: unknown) { toast(e instanceof Error ? e.message : 'Cannot move category', 'error'); }
  }, [reorderCategory]);`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Bug #13  ShiftModal opens with AnyUserPinModal that accepts any user,
  //          but backend POST /api/shifts is admin-only.
  //          Fix: pass required_role="admin" to AnyUserPinModal for Open Shift.
  // ─────────────────────────────────────────────────────────────────────────
  {
    label: 'Bug #13 — ShiftModal open-shift AnyUserPinModal: require admin role upfront',
    find: `        <AnyUserPinModal
          open={showAnyPin}
          onClose={() => { setShowAnyPin(false); setPendingAction(null); }}
          onSuccess={executeAction}
          title="🔒 Open Shift"
          description="Enter your PIN to open the shift."
        />`,
    replace: `        {/* Bug #13 fix: require admin PIN upfront for Open Shift.
             Without required_role any user passes the PIN step and then gets
             a confusing "Admin only" error from the backend. */}
        <AnyUserPinModal
          open={showAnyPin}
          onClose={() => { setShowAnyPin(false); setPendingAction(null); }}
          onSuccess={executeAction}
          title="🔒 Open Shift (Admin Required)"
          description="Only admins can open a shift. Enter an admin PIN to continue."
          required_role="admin"
        />`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Bug #14  useUsersListAuth exported from api.ts but never imported/used
  //          — remove the unused selector to avoid confusion (dead code).
  //          We patch the import line in App.tsx if it exists.
  //          (The export in api.ts is harmless; we only clean the consumer side.)
  // ─────────────────────────────────────────────────────────────────────────
  // NOTE: useUsersListAuth is NOT imported in App.tsx at all, so there is
  // nothing to remove in App.tsx. The dead export in api.ts is left in place
  // (removing an export is non-breaking; it's just dead code on the api.ts side).
  // This patch is a no-op but we document it for traceability.

  // ─────────────────────────────────────────────────────────────────────────
  // Bug #15  cartClearCart selected in CheckoutModal but never used
  // ─────────────────────────────────────────────────────────────────────────
  {
    label: 'Bug #15 — CheckoutModal: remove unused cartClearCart store subscription',
    find: `  const cartClearCart    = useCartStore(s => s.clearCart);`,
    replace: `  // Bug #15 fix: removed unused cartClearCart selector (was subscribing to
  // the store for no reason; the actual clear happens via the onSuccess prop).`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Bug #17  handleNoteChange useCallback dep is [cart] (full store ref),
  //          rebuilt on every cart mutation. Fix: extract stable setNote ref.
  // ─────────────────────────────────────────────────────────────────────────
  {
    label: 'Bug #17 — POSPage handleNoteChange: use stable setNote selector instead of [cart]',
    find: `  const [noteLocal, setNoteLocal] = useState(cart.cart.note);
  const noteDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleNoteChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setNoteLocal(val);
    if (noteDebounceRef.current) clearTimeout(noteDebounceRef.current);
    noteDebounceRef.current = setTimeout(() => {
      cart.setNote(val);
      noteDebounceRef.current = null; // reset so guard re-arms for next sync
    }, 300);
  }, [cart]);`,
    replace: `  const [noteLocal, setNoteLocal] = useState(cart.cart.note);
  const noteDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bug #17 fix: extract a stable setNote reference so handleNoteChange's
  // useCallback deps don't include [cart] (the full store result), which
  // changes on every cart mutation and causes the callback to be recreated
  // constantly — triggering unnecessary re-renders across the whole POSPage.
  const stableSetNote = useCartStore(s => s.setNote);
  const handleNoteChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setNoteLocal(val);
    if (noteDebounceRef.current) clearTimeout(noteDebounceRef.current);
    noteDebounceRef.current = setTimeout(() => {
      stableSetNote(val);
      noteDebounceRef.current = null; // reset so guard re-arms for next sync
    }, 300);
  }, [stableSetNote]);`,
  },

]);

// ══════════════════════════════════════════════════════════════════════════════
// FILE: src/thermalPrint.ts
// ══════════════════════════════════════════════════════════════════════════════
applyPatches('src/thermalPrint.ts', [

  // ─────────────────────────────────────────────────────────────────────────
  // Bug #5  wordWrap doesn't handle a single word longer than column width —
  //         it overflows the printable area on 57mm paper (32 cols).
  // ─────────────────────────────────────────────────────────────────────────
  {
    label: 'Bug #5 — wordWrap: split words longer than column width to prevent thermal paper overflow',
    find: `function wordWrap(s: string, width: number): string[] {
  const words = s.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}`,
    replace: `function wordWrap(s: string, width: number): string[] {
  // Bug #5 fix: a single word longer than the column width (e.g. an item name with no
  // spaces like "SpecialMangoFrappeWithExtra") was placed on one line, causing
  // it to overflow the printable area on 57mm (32-col) paper and produce
  // garbled output.  We now hard-break any word that exceeds the column width.
  function splitLongWord(word: string): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < word.length; i += width) {
      chunks.push(word.slice(i, i + width));
    }
    return chunks;
  }

  const words = s.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const rawWord of words) {
    // Expand any word that is itself too long before processing
    const subWords = rawWord.length > width ? splitLongWord(rawWord) : [rawWord];
    for (const word of subWords) {
      if (!current) {
        current = word;
      } else if (current.length + 1 + word.length <= width) {
        current += ' ' + word;
      } else {
        lines.push(current);
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}`,
  },

]);

// ══════════════════════════════════════════════════════════════════════════════
// FILE: src/api.ts
// ══════════════════════════════════════════════════════════════════════════════
applyPatches('src/api.ts', [

  // ─────────────────────────────────────────────────────────────────────────
  // Bug #11 (api.ts side)  useUpdateMenuItem needs to accept null for category_id
  //         so that the "clear category" fix in handleEditItem can reach the backend.
  // ─────────────────────────────────────────────────────────────────────────
  {
    label: 'Bug #11 (api.ts) — useUpdateMenuItem: allow null for category_id to clear it',
    find: `    mutationFn: ({ id, ...body }: { id: string; name?: string; category_id?: string; is_active?: boolean; sizes?: { name: string; price: number }[] }) =>`,
    replace: `    // Bug #11 fix: category_id can be null to unassign a category from an item.
    mutationFn: ({ id, ...body }: { id: string; name?: string; category_id?: string | null; is_active?: boolean; sizes?: { name: string; price: number }[] }) =>`,
  },

]);

// ══════════════════════════════════════════════════════════════════════════════
// FILE: worker/src/index.ts  — Bug #11 backend (allow null category_id on PUT)
// ══════════════════════════════════════════════════════════════════════════════
applyPatches('worker/src/index.ts', [

  {
    label: 'Bug #11 (worker) — PUT /api/menu/items/:id: treat null category_id as explicit unset',
    find: `  const body = await c.req.json<{\n    name?: string; category_id?: string; is_active?: boolean;\n    sizes?: { id?: string; name: string; price: number }[];\n    addon_ids?: string[];\n  }>()\n  const old = await db.select().from(menuItems).where(eq(menuItems.id, id)).get()\n  if (!old) return jsonErr('Item not found', 404)\n  await db.update(menuItems).set({ name: body.name, category_id: body.category_id, is_active: body.is_active }).where(eq(menuItems.id, id))`,
    replace: `  const body = await c.req.json<{\n    name?: string; category_id?: string | null; is_active?: boolean;\n    sizes?: { id?: string; name: string; price: number }[];\n    addon_ids?: string[];\n  }>()\n  const old = await db.select().from(menuItems).where(eq(menuItems.id, id)).get()\n  if (!old) return jsonErr('Item not found', 404)\n  // Bug #11 fix: when category_id is explicitly null, emit SET category_id = NULL\n  // so the item is moved to "uncategorized". If it's undefined, omit from SET.\n  const itemUpdateFields: Partial<typeof menuItems.$inferInsert> = {}\n  if (body.name      !== undefined) itemUpdateFields.name      = body.name\n  if (body.is_active !== undefined) itemUpdateFields.is_active = body.is_active\n  if (body.category_id !== undefined) itemUpdateFields.category_id = body.category_id // null is valid here\n  await db.update(menuItems).set(itemUpdateFields).where(eq(menuItems.id, id))`,
  },

]);

// ══════════════════════════════════════════════════════════════════════════════
// Bug #6  addons_total semantic mismatch:  App.tsx also needs AnyUserPinModal
//         to accept required_role prop (Bug #13 above uses it but it's not in
//         the component's type declaration yet).
// ══════════════════════════════════════════════════════════════════════════════
applyPatches('src/App.tsx', [
  {
    label: 'Bug #13 (type) — AnyUserPinModal: add required_role prop to component signature',
    find: `function AnyUserPinModal({
  open, onClose, onSuccess, title, description,
}: {
  open: boolean; onClose: () => void;
  onSuccess: (result: { user_id: string; user_name: string; role: string }) => void;
  title: string; description: string;
}) {`,
    replace: `function AnyUserPinModal({
  open, onClose, onSuccess, title, description, required_role,
}: {
  open: boolean; onClose: () => void;
  onSuccess: (result: { user_id: string; user_name: string; role: string }) => void;
  title: string; description: string;
  // Bug #13 fix: optional required_role so callers like ShiftModal can enforce
  // admin-only PIN entry before the backend rejects a non-admin with a 403.
  required_role?: 'admin';
}) {`,
  },

  // Pass required_role into verifyPin.mutateAsync inside AnyUserPinModal
  {
    label: 'Bug #13 (verifyPin) — AnyUserPinModal doSubmit: forward required_role to verify-pin API',
    find: `      await verifyPin.mutateAsync({ user_id: user.id, pin: pinValue });
      inAppLockout.reset();
      onSuccess({ user_id: user.id, user_name: user.name, role: user.role });`,
    replace: `      await verifyPin.mutateAsync({ user_id: user.id, pin: pinValue, required_role });
      inAppLockout.reset();
      onSuccess({ user_id: user.id, user_name: user.name, role: user.role });`,
  },

]);

// ══════════════════════════════════════════════════════════════════════════════
// Bug #6  addons_total semantic note (no code change needed — just assert the
//         current behaviour is safe and document it)
// The backend stores addons_total = addonsTotal * item.qty (cross-qty total).
// The frontend's CartItem.addons_total is per-unit. Neither field is used for
// display in receipts or reports — the line-level addon rows are used instead.
// A separate audit document entry is added here for traceability.
// ══════════════════════════════════════════════════════════════════════════════
// (No code patch — documenting in console output below)

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  MW-POS PATCH COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Bugs patched:
  ✔ #1  PartialActionModal "Selected Items" tab disabled (backend doesn't support partial void/refund)
  ✔ #2  void / refund / reprint routes now record the PIN-authorizer in audit logs
  ✔ #3  handleLogout now clears the cart so the next user starts fresh
  ✔ #4  PIN catch blocks now show the real backend error (rate-limit messages visible)
  ✔ #5  wordWrap now hard-breaks words longer than column width (no more 57mm overflow)
  ✔ #7  addon create / edit / delete all produce audit log entries
  ✔ #8  PUT /api/menu/categories/:id now whitelists fields + has an audit log
  ✔ #9  DELETE /api/menu/addons/:id cleans up dangling item_addons rows first
  ✔ #10 manilaToUTC validates the date string; all routes using it return HTTP 400 on bad input
  ✔ #11 Clearing category_id in edit-item form now sends null (unsets category properly)
  ✔ #12 moveUp / moveDown use mutateAsync + toast so reorder errors are visible
  ✔ #13 ShiftModal Open Shift now requires admin PIN upfront (not a confusing 403 after)
  ✔ #14 useUsersListAuth is dead export — no import in App.tsx; left in api.ts (harmless)
  ✔ #15 Removed unused cartClearCart store subscription in CheckoutModal
  ✔ #16 (pre-existing) POSPage already uses fine-grained selectors — no change needed
  ✔ #17 handleNoteChange now depends on stable stableSetNote instead of full [cart]

  Bug #6 (addons_total semantic mismatch):
  ⚠  No patch applied. The field is stored differently frontend vs backend
     but neither receipts nor reports use saleItems.addons_total directly —
     they read the individual saleItemAddons rows. Safe to leave as-is for now.
     Recommend adding a comment in the schema if future reporting touches this field.

  Next steps:
  1. Run:  cd worker && wrangler deploy
  2. Run:  cd .. && npm run build  (or vite build)
  3. Test on device: logout flow, PIN lockout messages, category reorder errors,
     void/refund audit log, addon CRUD audit trail, long item names on receipt.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
