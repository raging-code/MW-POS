// worker/src/index.ts
// MangoWarrior POS — Complete Backend
// Hono + Drizzle ORM + Cloudflare D1

// ============================================================
// SECTION 1: IMPORTS
// ============================================================
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1'
import {
  sqliteTable, text, integer, real, primaryKey,
} from 'drizzle-orm/sqlite-core'
import { eq, and, desc, asc, gte, lte, sql, not, or } from 'drizzle-orm'

// ============================================================
// SECTION 2: ENV TYPE
// ============================================================
type Env = {
  DB: D1Database
  TIMEZONE: string
}

type Variables = {
  user: { id: string; name: string; role: 'crew' | 'admin' }
  db: DrizzleD1Database
}

// ============================================================
// SECTION 3: DRIZZLE SCHEMA
// ============================================================
const users = sqliteTable('users', {
  id:         text('id').primaryKey(),
  name:       text('name').notNull(),
  role:       text('role', { enum: ['crew', 'admin'] }).notNull(),
  pin_hash:   text('pin_hash').notNull(),
  is_active:  integer('is_active', { mode: 'boolean' }).notNull().default(true),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  created_by: text('created_by'),
})

const sessions = sqliteTable('sessions', {
  id:         text('id').primaryKey(),
  user_id:    text('user_id').notNull().references(() => users.id),
  token:      text('token').notNull().unique(),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  expires_at: text('expires_at').notNull(),
})

const pinAttempts = sqliteTable('pin_attempts', {
  identifier:   text('identifier').primaryKey(),
  attempts:     integer('attempts').notNull().default(0),
  locked_until: text('locked_until'),
  updated_at:   text('updated_at').notNull().default(sql`(datetime('now'))`),
})

const categories = sqliteTable('categories', {
  id:         text('id').primaryKey(),
  name:       text('name').notNull(),
  sort_order: integer('sort_order').notNull().default(0),
})

const menuItems = sqliteTable('menu_items', {
  id:           text('id').primaryKey(),
  name:         text('name').notNull(),
  category_id:  text('category_id').references(() => categories.id),
  is_active:    integer('is_active', { mode: 'boolean' }).notNull().default(true),
  is_available: integer('is_available', { mode: 'boolean' }).notNull().default(true),
  created_at:   text('created_at').notNull().default(sql`(datetime('now'))`),
})

const itemSizes = sqliteTable('item_sizes', {
  id:      text('id').primaryKey(),
  item_id: text('item_id').notNull().references(() => menuItems.id),
  name:    text('name').notNull(),
  price:   real('price').notNull(),
})

const addons = sqliteTable('addons', {
  id:           text('id').primaryKey(),
  name:         text('name').notNull(),
  price:        real('price').notNull(),
  is_available: integer('is_available', { mode: 'boolean' }).notNull().default(true),
})

const itemAddons = sqliteTable('item_addons', {
  item_id:  text('item_id').notNull().references(() => menuItems.id),
  addon_id: text('addon_id').notNull().references(() => addons.id),
}, (t) => ({ pk: primaryKey({ columns: [t.item_id, t.addon_id] }) }))

const shifts = sqliteTable('shifts', {
  id:             text('id').primaryKey(),
  cashier_id:     text('cashier_id').notNull().references(() => users.id),
  started_at:     text('started_at').notNull().default(sql`(datetime('now'))`),
  closed_at:      text('closed_at'),
  starting_float: real('starting_float').notNull().default(0),
  closing_cash:   real('closing_cash'),
  status:         text('status', { enum: ['open', 'closed'] }).notNull().default('open'),
  opened_by:      text('opened_by').notNull().references(() => users.id),
  closed_by:      text('closed_by').references(() => users.id),
  notes:          text('notes'),
})

const cashDrops = sqliteTable('cash_drops', {
  id:         text('id').primaryKey(),
  shift_id:   text('shift_id').notNull().references(() => shifts.id),
  user_id:    text('user_id').notNull().references(() => users.id),
  amount:     real('amount').notNull(),
  reason:     text('reason').notNull(),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
})

const heldOrders = sqliteTable('held_orders', {
  id:         text('id').primaryKey(),
  created_by: text('created_by').notNull().references(() => users.id),
  data_json:  text('data_json').notNull(),
  expires_at: text('expires_at').notNull(),
  label:      text('label'),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
})

const receiptCounters = sqliteTable('receipt_counters', {
  date_key:    text('date_key').primaryKey(),
  last_number: integer('last_number').notNull().default(0),
})

const sales = sqliteTable('sales', {
  id:               text('id').primaryKey(),
  receipt_number:   text('receipt_number').notNull().unique(),
  shift_id:         text('shift_id').references(() => shifts.id),
  cashier_id:       text('cashier_id').notNull().references(() => users.id),
  order_type:       text('order_type', { enum: ['dine_in', 'take_out'] }).notNull(),
  status:           text('status', { enum: ['completed', 'voided', 'refunded', 'soft_deleted'] }).notNull().default('completed'),
  sale_type:        text('sale_type', { enum: ['normal', 'missed'] }).notNull().default('normal'),
  note:             text('note'),
  subtotal:         real('subtotal').notNull(),
  discount_total:   real('discount_total').notNull().default(0),
  total:            real('total').notNull(),
  tendered_amount:  real('tendered_amount'),
  change_amount:    real('change_amount'),
  idempotency_key:  text('idempotency_key').notNull().unique(),
  is_reprinted:     integer('is_reprinted', { mode: 'boolean' }).notNull().default(false),
  created_at:       text('created_at').notNull().default(sql`(datetime('now'))`),
})

const saleItems = sqliteTable('sale_items', {
  id:              text('id').primaryKey(),
  sale_id:         text('sale_id').notNull().references(() => sales.id),
  item_id_ref:     text('item_id_ref'),
  item_name:       text('item_name').notNull(),
  size_name:       text('size_name'),
  base_price:      real('base_price').notNull(),
  qty:             integer('qty').notNull().default(1),
  discount_type:   text('discount_type', { enum: ['sc', 'pwd'] }),
  discount_pct:    real('discount_pct').notNull().default(0),
  discount_amount: real('discount_amount').notNull().default(0),
  addons_total:    real('addons_total').notNull().default(0),
  final_price:     real('final_price').notNull(),
})

const saleItemAddons = sqliteTable('sale_item_addons', {
  id:            text('id').primaryKey(),
  sale_item_id:  text('sale_item_id').notNull().references(() => saleItems.id),
  addon_id_ref:  text('addon_id_ref'),
  addon_name:    text('addon_name').notNull(),
  addon_price:   real('addon_price').notNull(),
  qty:           integer('qty').notNull().default(1),
})

const salePayments = sqliteTable('sale_payments', {
  id:      text('id').primaryKey(),
  sale_id: text('sale_id').notNull().references(() => sales.id),
  method:  text('method', { enum: ['cash', 'gcash', 'maya'] }).notNull(),
  amount:  real('amount').notNull(),
})

const auditLogs = sqliteTable('audit_logs', {
  id:           text('id').primaryKey(),
  user_id:      text('user_id').notNull().references(() => users.id),
  action:       text('action').notNull(),
  entity_type:  text('entity_type').notNull(),
  entity_id:    text('entity_id'),
  old_value:    text('old_value'),
  new_value:    text('new_value'),
  reason:       text('reason'),
  created_at:   text('created_at').notNull().default(sql`(datetime('now'))`),
})

const systemSettings = sqliteTable('system_settings', {
  key:        text('key').primaryKey(),
  value:      text('value').notNull(),
  updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

const inventoryItems = sqliteTable('inventory_items', {
  id:            text('id').primaryKey(),
  name:          text('name').notNull(),
  unit:          text('unit').notNull(),
  current_stock: real('current_stock').notNull().default(0),
  created_at:    text('created_at').notNull().default(sql`(datetime('now'))`),
})

const inventoryTransactions = sqliteTable('inventory_transactions', {
  id:         text('id').primaryKey(),
  item_id:    text('item_id').notNull().references(() => inventoryItems.id),
  type:       text('type', { enum: ['stock_in', 'stock_out', 'wastage'] }).notNull(),
  qty:        real('qty').notNull(),
  cost:       real('cost'),
  reason:     text('reason'),
  user_id:    text('user_id').notNull().references(() => users.id),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// ============================================================
// SECTION 4: UTILITY HELPERS
// ============================================================
function uid(): string {
  return crypto.randomUUID()
}

function token(): string {
  return crypto.randomUUID() + '-' + crypto.randomUUID()
}

async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 },
    key, 256
  )
  const saltHex = [...salt].map(b => b.toString(16).padStart(2, '0')).join('')
  const hashHex = [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('')
  return `${saltHex}:${hashHex}`
}

async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [saltHex, storedHash] = stored.split(':')
  if (!saltHex || !storedHash) return false
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(h => parseInt(h, 16)))
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 },
    key, 256
  )
  const hashHex = [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('')
  return hashHex === storedHash
}

function nowISO(): string {
  return new Date().toISOString()
}

function addHours(h: number): string {
  return new Date(Date.now() + h * 3_600_000).toISOString()
}

// FIX E: convert a Manila (UTC+8) calendar date string ("YYYY-MM-DD") to a
// UTC ISO boundary suitable for comparing against stored created_at values.
// Without this, date-range queries miss the first 8 h of each day (00:00–07:59
// Manila time) and may include the first 8 h of the following day.
function manilaToUTC(dateStr: string, boundary: 'start' | 'end'): string {
  const time = boundary === 'start' ? 'T00:00:00.000+08:00' : 'T23:59:59.999+08:00'
  return new Date(dateStr + time).toISOString()
}

function jsonOk(data: unknown, status = 200): Response {
  return Response.json({ data, error: null }, { status })
}

function jsonErr(msg: string, status = 400): Response {
  return Response.json({ data: null, error: msg }, { status })
}

// Generate unique receipt number: MW-YYYYMMDD-NNNN
// Uses INSERT ... ON CONFLICT DO UPDATE to atomically increment
async function generateReceiptNumber(d1: D1Database): Promise<string> {
  // FIX D: Manila is UTC+8. Shift by 8 h before slicing the ISO string so
  // receipts before 08:00 Manila time don't carry yesterday's date.
  const manilaDate = new Date(Date.now() + 8 * 3_600_000)
  const dateKey = manilaDate.toISOString().slice(0, 10).replace(/-/g, '')
  const result = await d1.prepare(`
    INSERT INTO receipt_counters (date_key, last_number) VALUES (?, 1)
    ON CONFLICT(date_key) DO UPDATE SET last_number = last_number + 1
    RETURNING last_number
  `).bind(dateKey).first<{ last_number: number }>()
  const num = result?.last_number ?? 1
  return `MW-${dateKey}-${String(num).padStart(4, '0')}`
}

async function createAuditLog(
  db: DrizzleD1Database,
  userId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  oldValue: unknown,
  newValue: unknown,
  reason: string | null,
) {
  await db.insert(auditLogs).values({
    id:          uid(),
    user_id:     userId,
    action,
    entity_type: entityType,
    entity_id:   entityId ?? undefined,
    old_value:   oldValue != null ? JSON.stringify(oldValue) : undefined,
    new_value:   newValue != null ? JSON.stringify(newValue) : undefined,
    reason:      reason ?? undefined,
    created_at:  nowISO(),
  })
}

// Check & update PIN brute-force lockout
async function checkPinLock(db: DrizzleD1Database, identifier: string): Promise<string | null> {
  const rec = await db.select().from(pinAttempts).where(eq(pinAttempts.identifier, identifier)).get()
  if (!rec) return null
  if (rec.locked_until && new Date(rec.locked_until) > new Date()) {
    return `Too many attempts. Try again after ${rec.locked_until}`
  }
  return null
}

async function recordPinFail(db: DrizzleD1Database, identifier: string) {
  const rec = await db.select().from(pinAttempts).where(eq(pinAttempts.identifier, identifier)).get()
  const attempts = (rec?.attempts ?? 0) + 1
  const locked_until = attempts >= 5 ? addHours(0.25) : null // 15-min lockout after 5 fails
  // FIX H: pass locked_until directly (null when attempts < 5).
  // null ?? undefined = undefined which Drizzle drops from SET, leaving a
  // stale locked_until in place. Passing null generates SET locked_until = NULL.
  await db.insert(pinAttempts).values({
    identifier, attempts, locked_until: locked_until, updated_at: nowISO(),
  }).onConflictDoUpdate({
    target: pinAttempts.identifier,
    set: { attempts, locked_until: locked_until, updated_at: nowISO() },
  })
}

async function clearPinFail(db: DrizzleD1Database, identifier: string) {
  await db.update(pinAttempts)
    // FIX: use null (not undefined) so Drizzle emits SET locked_until = NULL.
    // undefined is silently omitted from the SET clause, leaving the column
    // at its old value and keeping the account locked even after successful login.
    .set({ attempts: 0, locked_until: null, updated_at: nowISO() })
    .where(eq(pinAttempts.identifier, identifier))
}

// ============================================================
// SECTION 5: HONO APP + MIDDLEWARE
// ============================================================
const app = new Hono<{ Bindings: Env; Variables: Variables }>()

app.use('*', cors({ origin: '*' }))

// Auth middleware: attach db + validate Bearer token
app.use('/api/*', async (c, next) => {
  const db = drizzle(c.env.DB)
  c.set('db', db)

  // Housekeeping: silently purge expired sessions on every request.
  // Expired rows are harmless but accumulate forever without this.
  // fire-and-forget — don't await so it never delays the response.
  db.delete(sessions).where(lte(sessions.expires_at, nowISO())).run().catch(() => {})

  // Public routes skip auth
  const publicPaths = ['/api/auth/login', '/api/auth/users', '/api/init']
  if (publicPaths.some(p => c.req.path.startsWith(p))) {
    return next()
  }

  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonErr('Unauthorized', 401)
  }
  const tok = authHeader.slice(7)
  const session = await db.select({ user_id: sessions.user_id, expires_at: sessions.expires_at })
    .from(sessions).where(eq(sessions.token, tok)).get()

  if (!session || new Date(session.expires_at) < new Date()) {
    return jsonErr('Session expired', 401)
  }

  const user = await db.select({ id: users.id, name: users.name, role: users.role, is_active: users.is_active })
    .from(users).where(eq(users.id, session.user_id)).get()

  if (!user || !user.is_active) return jsonErr('User inactive', 401)

  c.set('user', { id: user.id, name: user.name, role: user.role })
  return next()
})

// ============================================================
// SECTION 6: AUTH ROUTES
// ============================================================

// GET /api/auth/users — public list for login screen (names only, no PIN)
app.get('/api/auth/users', async (c) => {
  const db = drizzle(c.env.DB)
  const list = await db.select({ id: users.id, name: users.name, role: users.role })
    .from(users).where(eq(users.is_active, true)).orderBy(asc(users.name))
  return jsonOk(list)
})

// POST /api/auth/login  { user_id, pin }
app.post('/api/auth/login', async (c) => {
  const db = drizzle(c.env.DB)
  const body = await c.req.json<{ user_id: string; pin: string }>()

  const lockMsg = await checkPinLock(db, `login:${body.user_id}`)
  if (lockMsg) return jsonErr(lockMsg, 429)

  const user = await db.select().from(users)
    .where(and(eq(users.id, body.user_id), eq(users.is_active, true))).get()
  if (!user) return jsonErr('User not found', 404)

  const ok = await verifyPin(body.pin, user.pin_hash)
  if (!ok) {
    await recordPinFail(db, `login:${body.user_id}`)
    return jsonErr('Invalid PIN', 401)
  }
  await clearPinFail(db, `login:${body.user_id}`)

  // Create session (12-hour expiry)
  const tok = token()
  await db.insert(sessions).values({
    id: uid(), user_id: user.id, token: tok, expires_at: addHours(12), created_at: nowISO(),
  })

  return jsonOk({ token: tok, user: { id: user.id, name: user.name, role: user.role } })
})

// POST /api/auth/logout
app.post('/api/auth/logout', async (c) => {
  const authHeader = c.req.header('Authorization') ?? ''
  const tok = authHeader.slice(7)
  const db = c.get('db')
  if (tok) await db.delete(sessions).where(eq(sessions.token, tok))
  return jsonOk({ ok: true })
})

// GET /api/auth/me
app.get('/api/auth/me', (c) => {
  return jsonOk(c.get('user'))
})

// POST /api/auth/verify-pin  { user_id, pin }  — for sensitive actions
app.post('/api/auth/verify-pin', async (c) => {
  const db = c.get('db')
  const body = await c.req.json<{ user_id: string; pin: string; required_role?: 'admin' }>()

  const lockMsg = await checkPinLock(db, `pin:${body.user_id}`)
  if (lockMsg) return jsonErr(lockMsg, 429)

  const user = await db.select().from(users)
    .where(and(eq(users.id, body.user_id), eq(users.is_active, true))).get()
  if (!user) return jsonErr('User not found', 404)

  if (body.required_role === 'admin' && user.role !== 'admin') {
    return jsonErr('Admin PIN required', 403)
  }

  const ok = await verifyPin(body.pin, user.pin_hash)
  if (!ok) {
    await recordPinFail(db, `pin:${body.user_id}`)
    return jsonErr('Invalid PIN', 401)
  }
  await clearPinFail(db, `pin:${body.user_id}`)
  return jsonOk({ verified: true, role: user.role, user_id: user.id, user_name: user.name })
})

// ============================================================
// SECTION 7: USER MANAGEMENT ROUTES (Admin)
// ============================================================

app.get('/api/users', async (c) => {
  // FIX: crew should not be able to enumerate all users, roles, and IDs.
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const list = await db.select({ id: users.id, name: users.name, role: users.role, is_active: users.is_active, created_at: users.created_at })
    .from(users).orderBy(asc(users.name))
  return jsonOk(list)
})

app.post('/api/users', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const body = await c.req.json<{ name: string; role: 'crew' | 'admin'; pin: string }>()
  // FIX F: require exactly 6 decimal digits — pure-length check allows "ABCDEF"
  if (!body.name || !body.pin || !/^\d{6}$/.test(body.pin)) return jsonErr('Name and 6-digit numeric PIN required')
  const hash = await hashPin(body.pin)
  const id = uid()
  await db.insert(users).values({ id, name: body.name, role: body.role, pin_hash: hash, created_by: actor.id, created_at: nowISO() })
  await createAuditLog(db, actor.id, 'create_user', 'user', id, null, { name: body.name, role: body.role }, null)
  return jsonOk({ id, name: body.name, role: body.role })
})

app.put('/api/users/:id', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{ name?: string; role?: 'crew' | 'admin'; is_active?: boolean }>()
  const existing = await db.select().from(users).where(eq(users.id, id)).get()
  if (!existing) return jsonErr('User not found', 404)
  // FIX C: whitelist — only name, role, is_active may be updated.
  // Spreading the raw body could let a caller overwrite pin_hash or created_by.
  const safeFields: Partial<typeof users.$inferInsert> = {}
  if (body.name      !== undefined) safeFields.name      = body.name
  if (body.role      !== undefined) safeFields.role      = body.role
  if (body.is_active !== undefined) safeFields.is_active = body.is_active
  await db.update(users).set(safeFields).where(eq(users.id, id))
  await createAuditLog(db, actor.id, 'update_user', 'user', id, existing, body, null)
  if (body.is_active === false) {
    // Invalidate all sessions for this user
    await db.delete(sessions).where(eq(sessions.user_id, id))
  }
  return jsonOk({ ok: true })
})

app.delete('/api/users/:id', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')
  if (id === actor.id) return jsonErr('Cannot remove yourself')
  const existing = await db.select({ name: users.name }).from(users).where(eq(users.id, id)).get()
  if (!existing) return jsonErr('User not found', 404)
  await db.update(users).set({ is_active: false }).where(eq(users.id, id))
  await db.delete(sessions).where(eq(sessions.user_id, id))
  await createAuditLog(db, actor.id, 'remove_user', 'user', id, existing, null, null)
  return jsonOk({ ok: true })
})

app.post('/api/users/:id/reset-pin', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{ new_pin: string }>()
  // FIX F: require exactly 6 decimal digits
  if (!body.new_pin || !/^\d{6}$/.test(body.new_pin)) return jsonErr('6-digit numeric PIN required')
  const hash = await hashPin(body.new_pin)
  await db.update(users).set({ pin_hash: hash }).where(eq(users.id, id))
  await createAuditLog(db, actor.id, 'reset_pin', 'user', id, null, null, null)
  return jsonOk({ ok: true })
})

// ============================================================
// SECTION 8: MENU ROUTES
// ============================================================

// GET /api/menu — full menu tree for POS
app.get('/api/menu', async (c) => {
  const db = c.get('db')
  const cats = await db.select().from(categories).orderBy(asc(categories.sort_order))
  const items = await db.select().from(menuItems).where(eq(menuItems.is_active, true))
  const sizes = await db.select().from(itemSizes)
  const addonsAll = await db.select().from(addons)
  const itemAddonsAll = await db.select().from(itemAddons)

  const menu = cats.map(cat => ({
    ...cat,
    items: items
      .filter(i => i.category_id === cat.id)
      .map(item => ({
        ...item,
        sizes: sizes.filter(s => s.item_id === item.id),
        addons: itemAddonsAll
          .filter(ia => ia.item_id === item.id)
          .map(ia => addonsAll.find(a => a.id === ia.addon_id))
          .filter(Boolean),
      })),
  }))
  return jsonOk({ categories: menu, addons: addonsAll })
})

app.post('/api/menu/categories', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const body = await c.req.json<{ name: string; sort_order?: number }>()
  const id = uid()
  await db.insert(categories).values({ id, name: body.name, sort_order: body.sort_order ?? 0 })
  await createAuditLog(db, actor.id, 'create_category', 'category', id, null, body, null)
  return jsonOk({ id })
})

app.put('/api/menu/categories/:id', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{ name?: string; sort_order?: number }>()
  await db.update(categories).set(body).where(eq(categories.id, id))
  return jsonOk({ ok: true })
})

// NEW: PUT /api/menu/categories/:id/reorder  -- move category up/down
app.put('/api/menu/categories/:id/reorder', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{ direction: 'up' | 'down' }>()

  // Get current category
  const cat = await db.select().from(categories).where(eq(categories.id, id)).get()
  if (!cat) return jsonErr('Category not found', 404)

  // Find the adjacent category to swap with
  const targetSort = body.direction === 'up' ? cat.sort_order - 1 : cat.sort_order + 1
  const adjacent = await db.select().from(categories).where(eq(categories.sort_order, targetSort)).get()

  if (!adjacent) return jsonErr('Cannot move further', 400)

  // Swap sort_orders
  await db.batch([
    db.update(categories).set({ sort_order: adjacent.sort_order }).where(eq(categories.id, id)),
    db.update(categories).set({ sort_order: cat.sort_order }).where(eq(categories.id, adjacent.id)),
  ])

  await createAuditLog(db, actor.id, 'reorder_category', 'category', id, null, { direction: body.direction }, null)
  return jsonOk({ ok: true })
})

app.delete('/api/menu/categories/:id', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')

  // FIXED: guard against missing category and capture name for the audit log
  const cat = await db.select({ name: categories.name }).from(categories).where(eq(categories.id, id)).get()
  if (!cat) return jsonErr('Category not found', 404)

  // FIXED: reassign all items in this category to NULL (uncategorized) so they
  // remain visible and manageable in the admin menu instead of disappearing.
  // FIX A: use null so Drizzle emits SET category_id = NULL.
  // undefined is omitted from the SET clause, leaving items with a dangling
  // FK reference that makes them invisible in every menu query.
  await db.update(menuItems).set({ category_id: null }).where(eq(menuItems.category_id, id))

  await db.delete(categories).where(eq(categories.id, id))

  // FIXED: create the missing audit log entry
  await createAuditLog(db, actor.id, 'delete_category', 'category', id, { name: cat.name }, null, null)

  return jsonOk({ ok: true })
})

app.post('/api/menu/items', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const body = await c.req.json<{
    name: string; category_id?: string;
    sizes: { name: string; price: number }[];
    addon_ids?: string[];
  }>()
  const id = uid()
  await db.insert(menuItems).values({ id, name: body.name, category_id: body.category_id, created_at: nowISO() })
  if (body.sizes?.length) {
    await db.insert(itemSizes).values(body.sizes.map(s => ({ id: uid(), item_id: id, name: s.name, price: s.price })))
  }
  if (body.addon_ids?.length) {
    await db.insert(itemAddons).values(body.addon_ids.map(aid => ({ item_id: id, addon_id: aid })))
  }
  await createAuditLog(db, actor.id, 'create_item', 'menu_item', id, null, body, null)
  return jsonOk({ id })
})

app.put('/api/menu/items/:id', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{
    name?: string; category_id?: string; is_active?: boolean;
    sizes?: { id?: string; name: string; price: number }[];
    addon_ids?: string[];
  }>()
  const old = await db.select().from(menuItems).where(eq(menuItems.id, id)).get()
  if (!old) return jsonErr('Item not found', 404)
  await db.update(menuItems).set({ name: body.name, category_id: body.category_id, is_active: body.is_active }).where(eq(menuItems.id, id))
  if (body.sizes) {
    await db.delete(itemSizes).where(eq(itemSizes.item_id, id))
    await db.insert(itemSizes).values(body.sizes.map(s => ({ id: s.id ?? uid(), item_id: id, name: s.name, price: s.price })))
  }
  if (body.addon_ids !== undefined) {
    await db.delete(itemAddons).where(eq(itemAddons.item_id, id))
    if (body.addon_ids.length) {
      await db.insert(itemAddons).values(body.addon_ids.map(aid => ({ item_id: id, addon_id: aid })))
    }
  }
  await createAuditLog(db, actor.id, 'edit_item', 'menu_item', id, old, body, null)
  return jsonOk({ ok: true })
})

app.delete('/api/menu/items/:id', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')
  await db.update(menuItems).set({ is_active: false }).where(eq(menuItems.id, id))
  await createAuditLog(db, actor.id, 'delete_item', 'menu_item', id, null, null, null)
  return jsonOk({ ok: true })
})

app.put('/api/menu/items/:id/availability', async (c) => {
  const actor = c.get('user')
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{ is_available: boolean }>()
  const old = await db.select({ is_available: menuItems.is_available }).from(menuItems).where(eq(menuItems.id, id)).get()
  await db.update(menuItems).set({ is_available: body.is_available }).where(eq(menuItems.id, id))
  await createAuditLog(db, actor.id, 'toggle_availability', 'menu_item', id, old, body, null)
  return jsonOk({ ok: true })
})

app.get('/api/menu/addons', async (c) => {
  const db = c.get('db')
  const list = await db.select().from(addons).orderBy(asc(addons.name))
  return jsonOk(list)
})

app.post('/api/menu/addons', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const body = await c.req.json<{ name: string; price: number }>()
  const id = uid()
  await db.insert(addons).values({ id, name: body.name, price: body.price })
  return jsonOk({ id })
})

app.put('/api/menu/addons/:id', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{ name?: string; price?: number; is_available?: boolean }>()
  await db.update(addons).set(body).where(eq(addons.id, id))
  return jsonOk({ ok: true })
})

app.delete('/api/menu/addons/:id', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')
  await db.delete(addons).where(eq(addons.id, id))
  return jsonOk({ ok: true })
})

// ============================================================
// SECTION 9: SHIFT ROUTES
// ============================================================

app.get('/api/shifts/current', async (c) => {
  const db = c.get('db')
  const shift = await db.select().from(shifts).where(eq(shifts.status, 'open')).orderBy(desc(shifts.started_at)).get()
  if (!shift) return jsonOk(null)
  const drops = await db.select().from(cashDrops).where(eq(cashDrops.shift_id, shift.id))
  const payments = await db.select({ method: salePayments.method, amount: salePayments.amount })
    .from(salePayments)
    .innerJoin(sales, eq(sales.id, salePayments.sale_id))
    .where(and(eq(sales.shift_id, shift.id), eq(sales.status, 'completed')))
  const totals: Record<string, number> = {}
  for (const p of payments) {
    totals[p.method] = (totals[p.method] ?? 0) + p.amount
  }
  return jsonOk({ ...shift, cash_drops: drops, payment_totals: totals })
})

app.post('/api/shifts', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const body = await c.req.json<{ starting_float: number }>()
  const existing = await db.select({ id: shifts.id }).from(shifts).where(eq(shifts.status, 'open')).get()
  if (existing) return jsonErr('A shift is already open')
  const id = uid()
  await db.insert(shifts).values({
    id, cashier_id: actor.id, starting_float: body.starting_float,
    opened_by: actor.id, status: 'open', started_at: nowISO(),
  })
  await createAuditLog(db, actor.id, 'open_shift', 'shift', id, null, { starting_float: body.starting_float }, null)
  return jsonOk({ id })
})

app.put('/api/shifts/:id/close', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{ closing_cash: number; notes?: string }>()

  // Prevent closing if there are unpaid/incomplete sales
  const shift = await db.select().from(shifts).where(eq(shifts.id, id)).get()
  if (!shift || shift.status === 'closed') return jsonErr('Shift not found or already closed')

  await db.update(shifts).set({
    status: 'closed', closed_at: nowISO(), closing_cash: body.closing_cash,
    closed_by: actor.id, notes: body.notes,
  }).where(eq(shifts.id, id))
  await createAuditLog(db, actor.id, 'close_shift', 'shift', id, shift, { closing_cash: body.closing_cash }, null)
  return jsonOk({ ok: true })
})

app.post('/api/shifts/:id/cash-drop', async (c) => {
  const actor = c.get('user')
  const db = c.get('db')
  const shift_id = c.req.param('id')
  const body = await c.req.json<{ amount: number; reason: string }>()
  if (!body.reason) return jsonErr('Reason required')
  // FIX G: validate amount is a positive finite number
  if (!body.amount || body.amount <= 0 || !isFinite(body.amount)) return jsonErr('Amount must be a positive number')
  // FIX G: validate shift exists and is still open
  const shiftRec = await db.select({ status: shifts.status }).from(shifts).where(eq(shifts.id, shift_id)).get()
  if (!shiftRec) return jsonErr('Shift not found', 404)
  if (shiftRec.status !== 'open') return jsonErr('Cannot add a cash drop to a closed shift')
  const id = uid()
  await db.insert(cashDrops).values({ id, shift_id, user_id: actor.id, amount: body.amount, reason: body.reason, created_at: nowISO() })
  await createAuditLog(db, actor.id, 'cash_drop', 'shift', shift_id, null, { amount: body.amount, reason: body.reason }, body.reason)
  return jsonOk({ id })
})

// ============================================================
// SECTION 10: HELD ORDER ROUTES
// ============================================================

app.get('/api/held-orders', async (c) => {
  const db = c.get('db')
  // Clean up expired orders first
  await db.delete(heldOrders).where(lte(heldOrders.expires_at, nowISO()))
  const list = await db.select().from(heldOrders).orderBy(desc(heldOrders.created_at))
  return jsonOk(list.map(o => ({ ...o, data: JSON.parse(o.data_json) })))
})

app.post('/api/held-orders', async (c) => {
  const actor = c.get('user')
  const db = c.get('db')
  const body = await c.req.json<{ data: unknown; label?: string }>()
  const id = uid()
  await db.insert(heldOrders).values({
    id, created_by: actor.id, data_json: JSON.stringify(body.data),
    expires_at: addHours(1), label: body.label, created_at: nowISO(),
  })
  return jsonOk({ id })
})

app.put('/api/held-orders/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{ data: unknown; label?: string }>()
  await db.update(heldOrders).set({
    data_json: JSON.stringify(body.data),
    label: body.label,
    expires_at: addHours(1),
  }).where(eq(heldOrders.id, id))
  return jsonOk({ ok: true })
})

app.delete('/api/held-orders/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  await db.delete(heldOrders).where(eq(heldOrders.id, id))
  return jsonOk({ ok: true })
})

// ============================================================
// SECTION 11: CHECKOUT / SALES ROUTES
// ============================================================

type CheckoutItem = {
  item_id: string
  item_name: string
  size_name?: string
  base_price: number
  qty: number
  discount_type?: 'sc' | 'pwd'
  discount_pct: number
  addons: { addon_id: string; addon_name: string; addon_price: number; qty: number }[]
}
type CheckoutPayment = { method: 'cash' | 'gcash' | 'maya'; amount: number }
type CheckoutBody = {
  idempotency_key: string
  shift_id?: string
  order_type: 'dine_in' | 'take_out'
  note?: string
  tendered_amount?: number
  items: CheckoutItem[]
  payments: CheckoutPayment[]
}

// POST /api/sales — atomic checkout
app.post('/api/sales', async (c) => {
  const actor = c.get('user')
  const db = c.get('db')
  const body = await c.req.json<CheckoutBody>()

  if (!body.idempotency_key) return jsonErr('idempotency_key required')
  if (!body.items?.length) return jsonErr('Order has no items')
  if (!body.payments?.length) return jsonErr('Payment required')

  // Idempotency: return existing sale if same key.
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
  })

  // Compute totals from snapshot prices (never re-read menu prices)
  let subtotal = 0
  let discount_total = 0
  const settings = await db.select().from(systemSettings).where(
    or(eq(systemSettings.key, 'sc_discount_pct'), eq(systemSettings.key, 'pwd_discount_pct'))
  )
  const scPct = parseFloat(settings.find(s => s.key === 'sc_discount_pct')?.value ?? '20') / 100
  const pwdPct = parseFloat(settings.find(s => s.key === 'pwd_discount_pct')?.value ?? '20') / 100

  const saleItemRows: typeof saleItems.$inferInsert[] = []
  const addonRows: typeof saleItemAddons.$inferInsert[] = []

  for (const item of body.items) {
    const addonsTotal = item.addons.reduce((s, a) => s + a.addon_price * a.qty, 0)
    const itemBase = (item.base_price + addonsTotal) * item.qty
    let discPct = 0
    if (item.discount_type === 'sc') discPct = scPct
    else if (item.discount_type === 'pwd') discPct = pwdPct
    else if (item.discount_pct > 0) discPct = item.discount_pct / 100
    const discAmt = Math.round(itemBase * discPct * 100) / 100
    const finalPrice = Math.round((itemBase - discAmt) * 100) / 100
    subtotal += finalPrice + discAmt
    discount_total += discAmt

    const saleItemId = uid()
    saleItemRows.push({
      id: saleItemId,
      sale_id: '', // will fill below
      item_id_ref: item.item_id,
      item_name: item.item_name,
      size_name: item.size_name,
      base_price: item.base_price,
      qty: item.qty,
      discount_type: item.discount_type,
      discount_pct: discPct * 100,
      discount_amount: discAmt,
      addons_total: addonsTotal * item.qty,
      final_price: finalPrice,
    })

    for (const a of item.addons) {
      addonRows.push({
        id: uid(), sale_item_id: saleItemId,
        addon_id_ref: a.addon_id, addon_name: a.addon_name,
        addon_price: a.addon_price, qty: a.qty,
      })
    }
  }

  const total = Math.round((subtotal - discount_total) * 100) / 100
  const paymentTotal = body.payments.reduce((s, p) => s + p.amount, 0)

  // Validate payment math
  const cashPayments = body.payments.filter(p => p.method === 'cash')
  const hasCash = cashPayments.length > 0
  if (Math.round(paymentTotal * 100) !== Math.round(total * 100)) {
    return jsonErr(`Payment total (${paymentTotal}) does not match order total (${total})`)
  }
  if (hasCash && body.tendered_amount !== undefined && body.tendered_amount < cashPayments.reduce((s,p)=>s+p.amount,0)) {
    return jsonErr('Tendered amount less than cash portion')
  }

  const receiptNumber = await generateReceiptNumber(c.env.DB)
  const saleId = uid()
const cashTotal = cashPayments.reduce((s, p) => s + p.amount, 0)
const change = hasCash && body.tendered_amount != null
  ? Math.round((body.tendered_amount - cashTotal) * 100) / 100
  : 0
  // Bind sale_id into item rows
  saleItemRows.forEach(r => { r.sale_id = saleId })

  // Atomic batch insert
  const paymentRows = body.payments.map(p => ({
    id: uid(), sale_id: saleId, method: p.method, amount: p.amount,
  }))

  await db.batch([
    db.insert(sales).values({
      id: saleId, receipt_number: receiptNumber, shift_id: body.shift_id,
      cashier_id: actor.id, order_type: body.order_type, status: 'completed',
      sale_type: 'normal', note: body.note, subtotal,
      discount_total, total, tendered_amount: body.tendered_amount,
      change_amount: change, idempotency_key: body.idempotency_key,
      created_at: nowISO(),
    }),
    db.insert(saleItems).values(saleItemRows),
    ...(addonRows.length ? [db.insert(saleItemAddons).values(addonRows)] : []),
    db.insert(salePayments).values(paymentRows),
  ])

  return jsonOk({ id: saleId, receipt_number: receiptNumber, total, change })
})

// GET /api/sales — list with filters
app.get('/api/sales', async (c) => {
  const db = c.get('db')
  // FIX 2: extract payment_method and order_type (were destructured but never used).
  // FIX 3: soft_deleted handling — when ?status=soft_deleted is requested,
  //         the old base clause (status != 'soft_deleted') AND the status filter
  //         combined to always return 0 rows.  Rebuilt conditionally below.
  const { date_from, date_to, status, order_type, payment_method, receipt } = c.req.query()

  // Base select — columns returned to the frontend
  const baseSelect = db.select({
    id: sales.id, receipt_number: sales.receipt_number,
    cashier_id: sales.cashier_id, order_type: sales.order_type,
    status: sales.status, sale_type: sales.sale_type,
    total: sales.total, discount_total: sales.discount_total,
    subtotal: sales.subtotal, created_at: sales.created_at,
    is_reprinted: sales.is_reprinted,
  }).from(sales)

  // FIX 3: Only exclude soft_deleted when no explicit status filter is given.
  //         When ?status=soft_deleted is passed we WANT those rows.
  let query = (
    status
      ? baseSelect.where(eq(sales.status, status as typeof sales.status._.data))
      : baseSelect.where(not(eq(sales.status, 'soft_deleted')))
  ).orderBy(desc(sales.created_at)).$dynamic()

  if (date_from) query = query.where(gte(sales.created_at, manilaToUTC(date_from, 'start')))
  if (date_to)   query = query.where(lte(sales.created_at, manilaToUTC(date_to,   'end')))
  // FIX 2: apply order_type filter (was parsed but discarded)
  if (order_type) query = query.where(eq(sales.order_type, order_type as typeof sales.order_type._.data))
  if (receipt)   query = query.where(eq(sales.receipt_number, receipt))

  // FIX 2: payment_method filter — requires a join with sale_payments
  if (payment_method) {
    const matchingSaleIds = await db
      .selectDistinct({ sale_id: salePayments.sale_id })
      .from(salePayments)
      .where(eq(salePayments.method, payment_method as typeof salePayments.method._.data))
    const ids = matchingSaleIds.map(r => r.sale_id)
    if (!ids.length) return jsonOk([])
    query = query.where(sql`${sales.id} IN (${sql.join(ids.map(i => sql`${i}`), sql`,`)})`)
  }

  const list = await query
  return jsonOk(list)
})

// ── FIX: POST /api/sales/missed moved here so it's registered before the
//        dynamic /:id route (prevents potential future route-shadowing).
app.post('/api/sales/missed', async (c) => {
  const actor = c.get('user')
  const db = c.get('db')
  const body = await c.req.json<{
    order_type: 'dine_in' | 'take_out'
    note: string; reason: string
    total: number; items: CheckoutItem[]
    idempotency_key: string
  }>()
  if (!body.reason) return jsonErr('Reason required')

  const existing = await db.select({ id: sales.id }).from(sales).where(eq(sales.idempotency_key, body.idempotency_key)).get()
  if (existing) return jsonOk({ id: existing.id, duplicate: true })

  const receiptNumber = await generateReceiptNumber(c.env.DB)
  const saleId = uid()

  await db.insert(sales).values({
    id: saleId, receipt_number: receiptNumber,
    cashier_id: actor.id, order_type: body.order_type,
    status: 'completed', sale_type: 'missed',
    note: body.note ?? body.reason, subtotal: body.total,
    discount_total: 0, total: body.total,
    idempotency_key: body.idempotency_key, created_at: nowISO(),
  })
  await createAuditLog(db, actor.id, 'record_missed_sale', 'sale', saleId, null, { total: body.total }, body.reason)
  return jsonOk({ id: saleId, receipt_number: receiptNumber })
})

// FIX 1: PUT /api/sales/:id — was completely missing.
// The frontend useEditSale() calls this to patch note, payments, and
// tendered_amount on a completed sale. Without this route every edit 404'd.
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

  // Build the update payload — only touch fields that were sent
  const updateSet: Partial<typeof sales.$inferInsert> = {}
  if (body.note !== undefined) updateSet.note = body.note

  // If payments are being replaced, validate totals first
  if (body.payments !== undefined) {
    if (!body.payments.length) return jsonErr('At least one payment required')
    const newPaymentTotal = body.payments.reduce((s, p) => s + p.amount, 0)
    if (Math.round(newPaymentTotal * 100) !== Math.round(sale.total * 100)) {
      return jsonErr(
        `Payment total (${newPaymentTotal}) does not match sale total (${sale.total})`
      )
    }
    // Recompute change
    const cashPayments = body.payments.filter(p => p.method === 'cash')
    const cashTotal = cashPayments.reduce((s, p) => s + p.amount, 0)
    const tendered = body.tendered_amount ?? sale.tendered_amount ?? cashTotal
    if (cashPayments.length && tendered < cashTotal) {
      return jsonErr('Tendered amount is less than cash portion')
    }
    updateSet.tendered_amount = cashPayments.length ? tendered : null
    updateSet.change_amount   = cashPayments.length
      ? Math.round((tendered - cashTotal) * 100) / 100
      : null
  } else if (body.tendered_amount !== undefined) {
    updateSet.tendered_amount = body.tendered_amount
    // Recompute change from existing payments
    const existingPayments = await db.select().from(salePayments).where(eq(salePayments.sale_id, id))
    const cashTotal = existingPayments
      .filter(p => p.method === 'cash')
      .reduce((s, p) => s + p.amount, 0)
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
app.get('/api/sales/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const sale = await db.select().from(sales).where(eq(sales.id, id)).get()
  if (!sale) return jsonErr('Sale not found', 404)
  const items = await db.select().from(saleItems).where(eq(saleItems.sale_id, id))
  const itemIds = items.map(i => i.id)
  const addonList = itemIds.length
    ? await db.select().from(saleItemAddons).where(sql`sale_item_id IN (${sql.join(itemIds.map(i => sql`${i}`), sql`,`)})`)
    : []
  const payments = await db.select().from(salePayments).where(eq(salePayments.sale_id, id))
  const cashier = await db.select({ name: users.name }).from(users).where(eq(users.id, sale.cashier_id)).get()

  return jsonOk({
    ...sale,
    cashier_name: cashier?.name ?? '',
    items: items.map(item => ({ ...item, addons: addonList.filter(a => a.sale_item_id === item.id) })),
    payments,
  })
})

// POST /api/sales/:id/void
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
})

// POST /api/sales/:id/refund
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
})

// DELETE /api/sales/:id — soft delete (admin only)
app.delete('/api/sales/:id', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{ reason: string }>()
  if (!body.reason) return jsonErr('Reason required')
  const sale = await db.select().from(sales).where(eq(sales.id, id)).get()
  if (!sale) return jsonErr('Sale not found', 404)
  await db.update(sales).set({ status: 'soft_deleted' }).where(eq(sales.id, id))
  await createAuditLog(db, actor.id, 'soft_delete_sale', 'sale', id, sale, { status: 'soft_deleted' }, body.reason)
  return jsonOk({ ok: true })
})

// POST /api/sales/:id/reprint
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
})


// ============================================================
// SECTION 13: REPORT ROUTES
// ============================================================

app.get('/api/reports/sales', async (c) => {
  const db = c.get('db')
  const { date_from, date_to } = c.req.query()

  let salesQuery = db.select({
    id: sales.id, receipt_number: sales.receipt_number,
    total: sales.total, discount_total: sales.discount_total,
    subtotal: sales.subtotal, status: sales.status,
    sale_type: sales.sale_type, order_type: sales.order_type,
    created_at: sales.created_at, cashier_id: sales.cashier_id,
  }).from(sales).where(
    not(eq(sales.status, 'soft_deleted'))
  ).$dynamic()

  if (date_from) salesQuery = salesQuery.where(gte(sales.created_at, manilaToUTC(date_from, 'start')))
  if (date_to) salesQuery = salesQuery.where(lte(sales.created_at, manilaToUTC(date_to, 'end')))

  const salesList = await salesQuery
  const completedSales = salesList.filter(s => s.status === 'completed')
  const totalRevenue = completedSales.reduce((s, sale) => s + sale.total, 0)
  const totalDiscount = completedSales.reduce((s, sale) => s + sale.discount_total, 0)

  // Payment method breakdown
  const saleIds = completedSales.map(s => s.id)
  let paymentBreakdown: Record<string, number> = {}
  if (saleIds.length) {
    const payments = await db.select().from(salePayments)
      .where(sql`sale_id IN (${sql.join(saleIds.map(i => sql`${i}`), sql`,`)})`)
    for (const p of payments) {
      paymentBreakdown[p.method] = (paymentBreakdown[p.method] ?? 0) + p.amount
    }
  }

  return jsonOk({
    total_revenue: Math.round(totalRevenue * 100) / 100,
    total_discount: Math.round(totalDiscount * 100) / 100,
    transaction_count: completedSales.length,
    payment_breakdown: paymentBreakdown,
    sales: salesList,
  })
})

// NEW: GET /api/reports/sales-detailed — daily/weekly/monthly/yearly with void/refund/edit/delete counts
app.get('/api/reports/sales-detailed', async (c) => {
  const db = c.get('db')
  // Read parameters explicitly (safer than destructuring)
  const period = c.req.query('period')
  const date = c.req.query('date')
  const date_from = c.req.query('date_from')
  const date_to = c.req.query('date_to')
  const year = c.req.query('year')
  const month = c.req.query('month')

  let startDate: string, endDate: string

  if (period === 'daily' && date) {
    startDate = date
    endDate = date
  } else if (period === 'weekly' && date_from && date_to) {
    startDate = date_from
    endDate = date_to
  } else if (period === 'monthly' && year && month) {
    startDate = `${year}-${String(month).padStart(2, '0')}-01`
    const lastDay = new Date(Number(year), Number(month), 0).getDate()
    endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  } else if (period === 'yearly' && year) {
    startDate = `${year}-01-01`
    endDate = `${year}-12-31`
  } else {
    return jsonErr(`Invalid parameters: period=${period}, date=${date}, year=${year}, month=${month}`, 400)
  }

  // FIX E: use Manila→UTC conversion so daily periods cover 00:00–23:59 Manila time
  const from = manilaToUTC(startDate, 'start')
  const to   = manilaToUTC(endDate,   'end')

  const salesList = await db.select({
    id: sales.id,
    status: sales.status,
    total: sales.total,
    discount_total: sales.discount_total,
    subtotal: sales.subtotal,
  }).from(sales)
    .where(and(
      gte(sales.created_at, from),
      lte(sales.created_at, to),
    ))

  const completedSales = salesList.filter(s => s.status === 'completed')
  const totalSales = completedSales.reduce((sum, s) => sum + s.total, 0)
  const totalDiscount = completedSales.reduce((sum, s) => sum + s.discount_total, 0)
  const transactionCount = completedSales.length
  const avgSale = transactionCount > 0 ? totalSales / transactionCount : 0

  const voidedCount = salesList.filter(s => s.status === 'voided').length
  const refundedCount = salesList.filter(s => s.status === 'refunded').length
  const deletedCount = salesList.filter(s => s.status === 'soft_deleted').length

  let editedCount = 0
  const editedAudits = await db.select({ entity_id: auditLogs.entity_id })
    .from(auditLogs)
    .where(and(
      eq(auditLogs.entity_type, 'sale'),
      sql`${auditLogs.action} LIKE '%edit_sale%'`,
      gte(auditLogs.created_at, from),
      lte(auditLogs.created_at, to),
    ))
    .groupBy(auditLogs.entity_id)
  editedCount = editedAudits.length

  const completedIds = completedSales.map(s => s.id)
  let paymentBreakdown: Record<string, number> = {}
  if (completedIds.length) {
    const payments = await db.select().from(salePayments)
      .where(sql`sale_id IN (${sql.join(completedIds.map(i => sql`${i}`), sql`,`)})`)
    for (const p of payments) {
      paymentBreakdown[p.method] = (paymentBreakdown[p.method] ?? 0) + p.amount
    }
  }

  return jsonOk({
    total_sales: Math.round(totalSales * 100) / 100,
    transaction_count: transactionCount,
    avg_sale: Math.round(avgSale * 100) / 100,
    total_discount: Math.round(totalDiscount * 100) / 100,
    voided_count: voidedCount,
    refunded_count: refundedCount,
    edited_count: editedCount,
    deleted_count: deletedCount,
    payment_breakdown: paymentBreakdown,
  })
})

// ============================================================
// SECTION 14: SETTINGS ROUTES
// ============================================================

app.get('/api/settings', async (c) => {
  const db = c.get('db')
  const list = await db.select().from(systemSettings)
  const obj: Record<string, string> = {}
  for (const s of list) obj[s.key] = s.value
  return jsonOk(obj)
})

app.put('/api/settings', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const body = await c.req.json<Record<string, string>>()
  for (const [key, value] of Object.entries(body)) {
    await db.insert(systemSettings).values({ key, value, updated_at: nowISO() })
      .onConflictDoUpdate({ target: systemSettings.key, set: { value, updated_at: nowISO() } })
  }
  await createAuditLog(db, actor.id, 'update_settings', 'settings', null, null, body, null)
  return jsonOk({ ok: true })
})

// ============================================================
// SECTION 15: INVENTORY ROUTES
// ============================================================

app.get('/api/inventory', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const items = await db.select().from(inventoryItems).orderBy(asc(inventoryItems.name))
  const transactions = await db.select({
    id: inventoryTransactions.id,
    item_id: inventoryTransactions.item_id,
    type: inventoryTransactions.type,
    qty: inventoryTransactions.qty,
    cost: inventoryTransactions.cost,
    reason: inventoryTransactions.reason,
    created_at: inventoryTransactions.created_at,
    user_name: users.name,
  }).from(inventoryTransactions)
    .innerJoin(users, eq(users.id, inventoryTransactions.user_id))
    .orderBy(desc(inventoryTransactions.created_at))
  return jsonOk({ items, transactions })
})

app.post('/api/inventory/items', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const body = await c.req.json<{ name: string; unit: string }>()
  const id = uid()
  await db.insert(inventoryItems).values({ id, name: body.name, unit: body.unit, created_at: nowISO() })
  return jsonOk({ id })
})

app.post('/api/inventory/transactions', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const body = await c.req.json<{ item_id: string; type: 'stock_in' | 'stock_out' | 'wastage'; qty: number; cost?: number; reason?: string }>()
  const id = uid()
  await db.insert(inventoryTransactions).values({ id, ...body, user_id: actor.id, created_at: nowISO() })
  // Update stock
  const delta = body.type === 'stock_in' ? body.qty : -body.qty
  await db.update(inventoryItems)
    .set({ current_stock: sql`current_stock + ${delta}` })
    .where(eq(inventoryItems.id, body.item_id))
  return jsonOk({ id })
})

// ============================================================
// SECTION 16: AUDIT LOG ROUTES
// ============================================================

app.get('/api/audit-logs', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const { entity_type, entity_id, date_from, date_to } = c.req.query()
  let query = db.select({
    id: auditLogs.id, action: auditLogs.action,
    entity_type: auditLogs.entity_type, entity_id: auditLogs.entity_id,
    old_value: auditLogs.old_value, new_value: auditLogs.new_value,
    reason: auditLogs.reason, created_at: auditLogs.created_at,
    user_name: users.name,
  }).from(auditLogs)
    .innerJoin(users, eq(users.id, auditLogs.user_id))
    .orderBy(desc(auditLogs.created_at)).$dynamic()

  if (entity_type) query = query.where(eq(auditLogs.entity_type, entity_type))
  if (entity_id) query = query.where(eq(auditLogs.entity_id, entity_id))
  if (date_from) query = query.where(gte(auditLogs.created_at, manilaToUTC(date_from, 'start')))
  if (date_to) query = query.where(lte(auditLogs.created_at, manilaToUTC(date_to, 'end')))

  const logs = await query.limit(500)
  return jsonOk(logs)
})

// ============================================================
// SECTION 17: SEED DEFAULT ADMIN ON FIRST RUN
// ============================================================

// GET /api/init — creates default admin if no users exist
app.get('/api/init', async (c) => {
  const db = drizzle(c.env.DB)
  const existing = await db.select({ id: users.id }).from(users).limit(1)
  if (existing.length > 0) return jsonOk({ already_initialized: true })
  const hash = await hashPin('123456')
  await db.insert(users).values({
    id: uid(), name: 'Admin', role: 'admin', pin_hash: hash,
    is_active: true, created_at: nowISO(),
  })
  return jsonOk({ initialized: true, note: 'Default admin created. PIN: 123456. Change immediately.' })
})

export default app