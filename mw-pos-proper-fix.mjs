#!/usr/bin/env node
/**
 * mw-pos-proper-fix.mjs
 *
 * "Proper fix" for MW-POS sales-by-item accuracy.
 *
 * What it does
 * ------------
 * DB (new migration worker/migrations/0008_variants_stock_units.sql)
 *   item_sizes  + option_kind ('size' | 'variant' | 'addon')   <- size means only size
 *   item_sizes  + stock_units (physical units per 1 order)
 *   sale_items  + category_name, option_kind, stock_units      <- snapshot at sale time
 *   Backfills existing rows from the current menu, and fixes the duplicate
 *   "Large" on Mango Kitkat (lower-priced one becomes "Regular").
 *
 * Worker (worker/src/index.ts)
 *   - Drizzle schema updated for the new columns
 *   - /api/menu/items POST/PUT accept option_kind + stock_units per size
 *     (PUT keeps existing values when an old app version omits them)
 *   - /api/sales snapshots category / option kind / stock units per line
 *     (old app versions keep working: the server resolves them itself)
 *   - /api/reports/sales-by-item rewritten: no CATEGORY_KIND_OVERRIDES,
 *     reports orders AND physical units, standalone add-ons get own table
 *   - Fixes the chained .where() bug in /api/sales, /api/reports/sales,
 *     /api/audit-logs (a later .where() replaces the earlier one in
 *     Drizzle's dynamic mode, so date ranges / filters were being dropped)
 *
 * Frontend (src/types.ts, src/api.ts, src/App.tsx)
 *   - Menu editor: each size row gets a Size/Variant/Add-on selector and a
 *     "units" box
 *   - Sales by item: Units column / KPI when units differ from orders, and
 *     a "Add-ons sold on their own" table
 *
 * Usage
 * -----
 *   node mw-pos-proper-fix.mjs <repo-root> [--dry-run]
 *
 *   Idempotent: running it again skips edits that are already applied.
 *   It aborts BEFORE writing anything if an expected anchor isn't found.
 *
 * After running
 * -------------
 *   1. Back up D1:   cd worker && npx wrangler d1 export <DB_NAME> --remote --output backup.sql
 *   2. Migrate:      cd worker && npx wrangler d1 migrations apply <DB_NAME> --remote
 *   3. Deploy worker FIRST, then rebuild/reinstall the APK on the tablets.
 *   4. In the menu editor set "units" for items that aren't 1:1 with stock
 *      (e.g. Cheesesticks = pieces per order).
 */

import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const root = path.resolve(args.find(a => !a.startsWith('--')) ?? '.');

// ───────────────────────────────────────────────────────────────
// helpers
// ───────────────────────────────────────────────────────────────
const exists = p => access(p).then(() => true, () => false);
const count = (s, sub) => (sub ? s.split(sub).length - 1 : 0);

function plan(label, src, edits) {
  let out = src;
  const log = [];
  for (const e of edits) {
    const done = e.done ?? e.replace;
    if (out.includes(done)) { log.push(`  = ${e.name} (already applied)`); continue; }

    if (e.start !== undefined) {
      const s = out.indexOf(e.start);
      if (s < 0 || count(out, e.start) !== 1) {
        throw new Error(`[${label}] "${e.name}": start anchor found ${count(out, e.start)}x (expected 1)`);
      }
      const eIdx = out.indexOf(e.end, s + e.start.length);
      if (eIdx < 0) throw new Error(`[${label}] "${e.name}": end anchor not found after start`);
      const endPos = e.endInclusive ? eIdx + e.end.length : eIdx;
      out = out.slice(0, s) + e.replace + out.slice(endPos);
      log.push(`  + ${e.name}`);
      continue;
    }

    const expected = e.count ?? 1;
    const found = count(out, e.find);
    if (found !== expected) {
      throw new Error(`[${label}] "${e.name}": anchor found ${found}x (expected ${expected}). The file differs from what this script was written against.`);
    }
    out = out.split(e.find).join(e.replace);
    log.push(`  + ${e.name}`);
  }
  return { out, log };
}

async function patchFile(rel, edits) {
  const file = path.join(root, rel);
  const raw = await readFile(file, 'utf8');
  const crlf = raw.includes('\r\n');
  const src = raw.replace(/\r\n/g, '\n');
  const { out, log } = plan(rel, src, edits);
  return { file, rel, changed: out !== src, log, text: crlf ? out.replace(/\n/g, '\r\n') : out };
}

// ───────────────────────────────────────────────────────────────
// 1. MIGRATION
// ───────────────────────────────────────────────────────────────
const MIGRATION_REL = 'worker/migrations/0008_variants_stock_units.sql';
const MIGRATION_SQL = `-- 0008: size means size; variants/add-ons get their own kind; stock units;
-- sale lines snapshot category + kind + units at sale time.
--
-- All plain ADD COLUMNs (no table rebuilds), so existing rows and FKs are safe.
-- BACK UP FIRST:  npx wrangler d1 export <DB_NAME> --remote --output backup.sql

-- ── item_sizes: what is this option, and how many physical units is one order?
ALTER TABLE item_sizes ADD COLUMN option_kind TEXT NOT NULL DEFAULT 'size'
  CHECK(option_kind IN ('size','variant','addon'));
ALTER TABLE item_sizes ADD COLUMN stock_units REAL NOT NULL DEFAULT 1;

-- ── sale_items: snapshot so later menu edits can't shift old reports
ALTER TABLE sale_items ADD COLUMN category_name TEXT;
ALTER TABLE sale_items ADD COLUMN option_kind TEXT;
ALTER TABLE sale_items ADD COLUMN stock_units REAL;

-- ── Backfill item_sizes from the categories that used size_name as a
--    flavor / add-on name (this replaces the old CATEGORY_KIND_OVERRIDES).
UPDATE item_sizes SET option_kind = 'variant'
 WHERE item_id IN (
   SELECT mi.id FROM menu_items mi JOIN categories c ON c.id = mi.category_id
    WHERE c.name IN ('Rice Meals', 'Snacks'));

UPDATE item_sizes SET option_kind = 'addon'
 WHERE item_id IN (
   SELECT mi.id FROM menu_items mi JOIN categories c ON c.id = mi.category_id
    WHERE c.name = 'Add-ons');

-- ── Backfill sale_items from the CURRENT menu (best available for history).
--    Lines whose menu item was deleted stay NULL on purpose, so the report
--    keeps them under "Uncategorized / Deleted Items" instead of guessing.
UPDATE sale_items SET category_name = (
  SELECT c.name FROM menu_items mi JOIN categories c ON c.id = mi.category_id
   WHERE mi.id = sale_items.item_id_ref)
 WHERE category_name IS NULL AND item_id_ref IS NOT NULL;

UPDATE sale_items SET option_kind = CASE
    WHEN category_name IN ('Rice Meals', 'Snacks') THEN 'variant'
    WHEN category_name = 'Add-ons' THEN 'addon'
    ELSE 'size' END
 WHERE option_kind IS NULL AND category_name IS NOT NULL;

UPDATE sale_items SET stock_units = 1
 WHERE stock_units IS NULL AND item_id_ref IS NOT NULL;

-- ── Mango Kitkat has two sizes both called "Large". Only touched when the
--    two have different prices: the cheaper one becomes "Regular".
UPDATE item_sizes SET name = 'Regular'
 WHERE name = 'Large'
   AND item_id IN (SELECT id FROM menu_items WHERE name = 'Mango Kitkat')
   AND price = (SELECT MIN(s2.price) FROM item_sizes s2
                 WHERE s2.item_id = item_sizes.item_id AND s2.name = 'Large')
   AND (SELECT COUNT(DISTINCT s3.price) FROM item_sizes s3
         WHERE s3.item_id = item_sizes.item_id AND s3.name = 'Large') > 1;
`;

// ───────────────────────────────────────────────────────────────
// 2. WORKER  (worker/src/index.ts)
// ───────────────────────────────────────────────────────────────
const MENU_HELPERS = String.raw`// [proper-fix] size means size; variants/add-ons are their own kind
const OPTION_KINDS = ['size', 'variant', 'addon'] as const
type OptionKind = typeof OPTION_KINDS[number]
function normOptionKind(k: unknown): OptionKind {
  return (OPTION_KINDS as readonly string[]).includes(k as string) ? (k as OptionKind) : 'size'
}
function normStockUnits(u: unknown): number {
  const n = typeof u === 'number' ? u : parseFloat(String(u))
  return Number.isFinite(n) && n > 0 ? n : 1
}

app.post('/api/menu/items', async (c) => {`;

const PUT_SIZES_NEW = String.raw`    const existingSizes = await db.select().from(itemSizes).where(eq(itemSizes.item_id, id))
    const existingSizeById = new Map(existingSizes.map(s => [s.id, s]))
    await db.delete(itemSizes).where(eq(itemSizes.item_id, id))
    await db.insert(itemSizes).values(body.sizes.map(s => {
      // Older app versions don't send option_kind/stock_units: keep what is stored.
      const prev = s.id ? existingSizeById.get(s.id) : undefined
      return {
        id: s.id ?? uid(), item_id: id, name: s.name, price: s.price,
        option_kind: normOptionKind(s.option_kind ?? prev?.option_kind),
        stock_units: normStockUnits(s.stock_units ?? prev?.stock_units),
      }
    }))`;

const SNAPSHOT_HELPER = String.raw`const addonRows: typeof saleItemAddons.$inferInsert[] = []

  // [proper-fix] Snapshot category / option kind / stock units onto each line.
  // Resolved server-side so old app versions (which only send size_name) work.
  const sizeRowsForOrder = orderedItemIds.length
    ? await db.select().from(itemSizes).where(inArray(itemSizes.item_id, orderedItemIds))
    : []
  const snapshotFor = (item: CheckoutItem) => {
    const named = sizeRowsForOrder.filter(s =>
      s.item_id === item.item_id && (item.size_name == null || s.name === item.size_name))
    // Duplicate names (or no size sent): disambiguate by price, never guess.
    const match = named.length === 1 ? named[0] : (named.find(s => s.price === item.base_price) ?? null)
    return {
      category_name: categoryNameByItemId.get(item.item_id) ?? null,
      option_kind: match?.option_kind ?? null,
      stock_units: match?.stock_units ?? 1,
    }
  }`;

const REPORT_NEW = String.raw`// [proper-fix] GET /api/reports/sales-by-item
// Reports orders rung up (qty) AND physical units (qty x stock_units) per item.
// What a size_name means comes from the data (sale_items.option_kind, set from
// item_sizes.option_kind when the sale was made), not from category names.
// Category is the snapshot taken at sale time, falling back to the live menu
// for sales made before the snapshot existed. Only 'completed' sales count.
//
//   option_kind 'size'    -> drink: summed by size label into size_totals
//   option_kind 'variant' -> flavor/variant: flat per-item qty + units
//   option_kind 'addon'   -> standalone add-on sold on its own -> standalone_addons
//   option_kind null      -> unknown (menu item deleted): "Uncategorized / Deleted Items"
type ReportKind = 'drink' | 'flavor_qty' | 'other'
function reportKind(optionKind: string | null, hasCategory: boolean): ReportKind {
  if (optionKind === 'size') return 'drink'
  if (optionKind === 'variant') return 'flavor_qty'
  if (optionKind === 'addon') return 'other'
  return hasCategory ? 'drink' : 'other'
}
const round2 = (n: number) => Math.round(n * 100) / 100

app.get('/api/reports/sales-by-item', async (c) => {
  const db = c.get('db')
  const date_from = c.req.query('date_from')
  const date_to = c.req.query('date_to')

  let from: string | undefined
  let to: string | undefined
  try {
    if (date_from) from = manilaToUTC(date_from, 'start')
    if (date_to) to = manilaToUTC(date_to, 'end')
  } catch (err) {
    return jsonErr(err instanceof Error ? err.message : 'Invalid date parameter', 400)
  }

  const whereClauses = [eq(sales.status, 'completed')]
  if (from) whereClauses.push(gte(sales.created_at, from))
  if (to) whereClauses.push(lte(sales.created_at, to))

  const rows = await db.select({
    sale_item_id: saleItems.id,
    item_name: saleItems.item_name,
    size_name: saleItems.size_name,
    qty: saleItems.qty,
    snap_category: saleItems.category_name,
    snap_kind: saleItems.option_kind,
    snap_units: saleItems.stock_units,
    live_category: categories.name,
  }).from(saleItems)
    .innerJoin(sales, eq(saleItems.sale_id, sales.id))
    .leftJoin(menuItems, eq(saleItems.item_id_ref, menuItems.id))
    .leftJoin(categories, eq(menuItems.category_id, categories.id))
    .where(and(...whereClauses))

  const addonRows = rows.length
    ? await db.select({
        addon_name: saleItemAddons.addon_name,
        qty: saleItemAddons.qty,
      }).from(saleItemAddons)
        .innerJoin(saleItems, eq(saleItemAddons.sale_item_id, saleItems.id))
        .innerJoin(sales, eq(saleItems.sale_id, sales.id))
        .where(and(...whereClauses))
    : []

  type ItemBucket = { item_name: string; sizes: Record<string, number>; flat_qty: number; units: number }
  type CategoryBucket = { category_name: string; kind: ReportKind; items: Map<string, ItemBucket> }

  const UNCATEGORIZED = 'Uncategorized / Deleted Items'
  const categoryMap = new Map<string, CategoryBucket>()
  const sizeTotals: Record<string, number> = {}
  const flavorQtyTotals: Record<string, number> = {}
  const unitTotals: Record<string, number> = {}
  const standaloneAddonTotals: Record<string, number> = {}

  for (const r of rows) {
    const catName = r.snap_category ?? r.live_category ?? UNCATEGORIZED
    const kind = reportKind(r.snap_kind, catName !== UNCATEGORIZED)
    const units = r.qty * (r.snap_units ?? 1)

    // Standalone add-ons (Rice, Egg, Sauce, ...) sold as their own line:
    // their own table, never mixed into drink sizes or item categories.
    if (r.snap_kind === 'addon') {
      const label = r.size_name ?? r.item_name
      standaloneAddonTotals[label] = (standaloneAddonTotals[label] ?? 0) + r.qty
      continue
    }

    if (!categoryMap.has(catName)) {
      categoryMap.set(catName, { category_name: catName, kind, items: new Map() })
    }
    const cat = categoryMap.get(catName)!
    if (kind === 'flavor_qty') cat.kind = 'flavor_qty' // variant wins: size columns would be meaningless
    if (!cat.items.has(r.item_name)) {
      cat.items.set(r.item_name, { item_name: r.item_name, sizes: {}, flat_qty: 0, units: 0 })
    }
    const item = cat.items.get(r.item_name)!
    const label = r.size_name ?? 'None'
    item.sizes[label] = (item.sizes[label] ?? 0) + r.qty
    item.flat_qty += r.qty
    item.units += units

    if (kind === 'drink') {
      sizeTotals[label] = (sizeTotals[label] ?? 0) + r.qty
    } else if (kind === 'flavor_qty') {
      flavorQtyTotals[catName] = (flavorQtyTotals[catName] ?? 0) + r.qty
      unitTotals[catName] = (unitTotals[catName] ?? 0) + units
    }
  }

  const categoriesOut = [...categoryMap.values()].map(cat => ({
    category_name: cat.category_name,
    kind: cat.kind,
    items: [...cat.items.values()].map(i => ({
      item_name: i.item_name,
      sizes: i.sizes,
      flat_qty: i.flat_qty,
      units: round2(i.units),
    })),
  }))
  for (const k of Object.keys(unitTotals)) unitTotals[k] = round2(unitTotals[k])

  const addonTotals: Record<string, number> = {}
  for (const a of addonRows) {
    addonTotals[a.addon_name] = (addonTotals[a.addon_name] ?? 0) + a.qty
  }
  const toSortedList = (m: Record<string, number>) =>
    Object.entries(m).map(([addon_name, qty]) => ({ addon_name, qty })).sort((a, b) => b.qty - a.qty)

  return jsonOk({
    size_totals: sizeTotals,
    flavor_qty_totals: flavorQtyTotals,
    unit_totals: unitTotals,
    categories: categoriesOut,
    addons: toSortedList(addonTotals),                    // add-ons attached to other items
    standalone_addons: toSortedList(standaloneAddonTotals), // add-ons sold on their own
  })
})

`;

const workerEdits = [
  {
    name: 'import SQL type',
    find: "import { eq, and, desc, asc, gte, lte, sql, not, or, inArray } from 'drizzle-orm'",
    replace: "import { eq, and, desc, asc, gte, lte, sql, not, or, inArray, type SQL } from 'drizzle-orm'",
  },
  {
    name: 'schema: item_sizes columns',
    find: "  name:    text('name').notNull(),\n  price:   real('price').notNull(),\n})",
    replace:
      "  name:    text('name').notNull(),\n  price:   real('price').notNull(),\n" +
      "  // [proper-fix] what this option means, and physical units used per 1 order\n" +
      "  option_kind: text('option_kind', { enum: ['size', 'variant', 'addon'] }).notNull().default('size'),\n" +
      "  stock_units: real('stock_units').notNull().default(1),\n})",
  },
  {
    name: 'schema: sale_items snapshot columns',
    find: "  final_price:     real('final_price').notNull(),\n})",
    replace:
      "  final_price:     real('final_price').notNull(),\n" +
      "  // [proper-fix] snapshot at sale time so menu edits can't shift old reports\n" +
      "  category_name:   text('category_name'),\n" +
      "  option_kind:     text('option_kind', { enum: ['size', 'variant', 'addon'] }),\n" +
      "  stock_units:     real('stock_units'),\n})",
  },
  {
    name: 'menu POST: body type',
    find: "    sizes: { name: string; price: number }[];\n    addon_ids?: string[];\n  }>()\n  const id = uid()",
    replace:
      "    sizes: { name: string; price: number; option_kind?: string; stock_units?: number }[];\n" +
      "    addon_ids?: string[];\n  }>()\n  const id = uid()",
  },
  {
    name: 'menu POST: insert sizes',
    find: "await db.insert(itemSizes).values(body.sizes.map(s => ({ id: uid(), item_id: id, name: s.name, price: s.price })))",
    replace:
      "await db.insert(itemSizes).values(body.sizes.map(s => ({\n" +
      "      id: uid(), item_id: id, name: s.name, price: s.price,\n" +
      "      option_kind: normOptionKind(s.option_kind), stock_units: normStockUnits(s.stock_units),\n" +
      "    })))",
  },
  {
    name: 'menu helpers',
    find: "app.post('/api/menu/items', async (c) => {",
    replace: MENU_HELPERS,
    done: '// [proper-fix] size means size',
  },
  {
    name: 'menu PUT: body type',
    find: "    sizes?: { id?: string; name: string; price: number }[];",
    replace: "    sizes?: { id?: string; name: string; price: number; option_kind?: string; stock_units?: number }[];",
  },
  {
    name: 'menu PUT: keep kind/units on update',
    find:
      "    await db.delete(itemSizes).where(eq(itemSizes.item_id, id))\n" +
      "    await db.insert(itemSizes).values(body.sizes.map(s => ({ id: s.id ?? uid(), item_id: id, name: s.name, price: s.price })))",
    replace: PUT_SIZES_NEW,
  },
  {
    name: 'checkout: category name lookup',
    find: "db.select({ itemId: menuItems.id, discountDisabled: categories.discount_disabled })",
    replace: "db.select({ itemId: menuItems.id, discountDisabled: categories.discount_disabled, categoryName: categories.name })",
  },
  {
    name: 'checkout: category name map',
    find: "  const discountDisabledByItemId = new Map(itemCategoryRows.map(r => [r.itemId, !!r.discountDisabled]))",
    replace:
      "  const discountDisabledByItemId = new Map(itemCategoryRows.map(r => [r.itemId, !!r.discountDisabled]))\n" +
      "  const categoryNameByItemId = new Map(itemCategoryRows.map(r => [r.itemId, r.categoryName ?? null]))",
  },
  {
    name: 'checkout: snapshot helper',
    find: "const addonRows: typeof saleItemAddons.$inferInsert[] = []",
    replace: SNAPSHOT_HELPER,
    done: '// [proper-fix] Snapshot category',
  },
  {
    name: 'checkout: write snapshot on each line',
    find: "      size_name: item.size_name,\n      base_price: item.base_price,\n      qty: item.qty,",
    replace:
      "      size_name: item.size_name,\n      ...snapshotFor(item), // [proper-fix] category_name, option_kind, stock_units\n" +
      "      base_price: item.base_price,\n      qty: item.qty,",
    done: '...snapshotFor(item)',
  },

  // ── chained .where() fixes ─────────────────────────────────
  {
    name: 'GET /api/sales: single combined where()',
    start: '  // FIX 3: Only exclude soft_deleted when no explicit status filter is given.',
    end: '  const list = await query\n  return jsonOk(list)',
    endInclusive: true,
    replace: String.raw`  // [proper-fix] Drizzle's dynamic .where() REPLACES the previous clause, so
  // chaining dropped filters (e.g. date_from was lost whenever date_to was set).
  // Collect every condition and apply ONE .where(and(...)).
  // Only exclude soft_deleted when no explicit status filter is given.
  const conditions: SQL[] = [
    status
      ? eq(sales.status, status as typeof sales.status._.data)
      : not(eq(sales.status, 'soft_deleted')),
  ]
  try {
    if (date_from) conditions.push(gte(sales.created_at, manilaToUTC(date_from, 'start')))
    if (date_to)   conditions.push(lte(sales.created_at, manilaToUTC(date_to,   'end')))
  } catch (err) {
    return jsonErr(err instanceof Error ? err.message : 'Invalid date parameter', 400)
  }
  if (order_type) conditions.push(eq(sales.order_type, order_type as typeof sales.order_type._.data))
  if (receipt)    conditions.push(eq(sales.receipt_number, receipt))

  // payment_method filter — requires a lookup in sale_payments
  if (payment_method) {
    const matchingSaleIds = await db
      .selectDistinct({ sale_id: salePayments.sale_id })
      .from(salePayments)
      .where(eq(salePayments.method, payment_method as typeof salePayments.method._.data))
    const ids = matchingSaleIds.map(r => r.sale_id)
    if (!ids.length) return jsonOk([])
    conditions.push(inArray(sales.id, ids))
  }

  const list = await baseSelect.where(and(...conditions)).orderBy(desc(sales.created_at))
  return jsonOk(list)`,
    done: '// [proper-fix] Drizzle\'s dynamic .where() REPLACES',
  },
  {
    name: 'GET /api/reports/sales: combined where (part 1)',
    find:
      "  }).from(sales).where(\n    not(eq(sales.status, 'soft_deleted'))\n  ).$dynamic()\n\n  try {\n" +
      "    if (date_from) salesQuery = salesQuery.where(gte(sales.created_at, manilaToUTC(date_from, 'start')))\n" +
      "    if (date_to) salesQuery = salesQuery.where(lte(sales.created_at, manilaToUTC(date_to, 'end')))\n  } catch (err) {",
    replace:
      "  }).from(sales).$dynamic()\n\n  // [proper-fix] one combined where(): chained .where() calls replace each other\n" +
      "  const salesConditions: SQL[] = [not(eq(sales.status, 'soft_deleted'))]\n  try {\n" +
      "    if (date_from) salesConditions.push(gte(sales.created_at, manilaToUTC(date_from, 'start')))\n" +
      "    if (date_to) salesConditions.push(lte(sales.created_at, manilaToUTC(date_to, 'end')))\n  } catch (err) {",
  },
  {
    name: 'GET /api/reports/sales: combined where (part 2)',
    find: "  const salesList = await salesQuery\n",
    replace: "  salesQuery = salesQuery.where(and(...salesConditions))\n  const salesList = await salesQuery\n",
    done: 'salesQuery.where(and(...salesConditions))',
  },
  {
    name: 'GET /api/audit-logs: combined where',
    start: "  if (entity_type) query = query.where(eq(auditLogs.entity_type, entity_type))",
    end: "  const logs = await query.limit(500)",
    endInclusive: true,
    replace: String.raw`  // [proper-fix] one combined where(): chained .where() calls replace each other
  const auditConditions: SQL[] = []
  if (entity_type) auditConditions.push(eq(auditLogs.entity_type, entity_type))
  if (entity_id) auditConditions.push(eq(auditLogs.entity_id, entity_id))
  try {
    if (date_from) auditConditions.push(gte(auditLogs.created_at, manilaToUTC(date_from, 'start')))
    if (date_to) auditConditions.push(lte(auditLogs.created_at, manilaToUTC(date_to, 'end')))
  } catch (err) {
    return jsonErr(err instanceof Error ? err.message : 'Invalid date parameter', 400)
  }

  const logs = await query.where(and(...auditConditions)).limit(500)`,
    done: 'const auditConditions: SQL[] = []',
  },

  // ── report rewrite (removes CATEGORY_KIND_OVERRIDES) ──────
  {
    name: 'sales-by-item report rewrite',
    start: '// NEW: GET /api/reports/sales-by-item',
    end: '// ============================================================\n// SECTION 14: SETTINGS ROUTES',
    replace: REPORT_NEW,
    done: '// [proper-fix] GET /api/reports/sales-by-item',
  },
];

// ───────────────────────────────────────────────────────────────
// 3. FRONTEND
// ───────────────────────────────────────────────────────────────
const typesEdits = [{
  name: 'ItemSize: option_kind + stock_units',
  find: 'export interface ItemSize {\n  id: string;\n  name: string;\n  price: number;\n}',
  replace:
    "export interface ItemSize {\n  id: string;\n  name: string;\n  price: number;\n" +
    "  option_kind?: 'size' | 'variant' | 'addon'; // what `name` means\n" +
    "  stock_units?: number;                       // physical units used per 1 order\n}",
}];

const apiEdits = [
  {
    name: 'create item body',
    find: 'sizes: { name: string; price: number }[]',
    replace: 'sizes: { name: string; price: number; option_kind?: string; stock_units?: number }[]',
  },
  {
    name: 'update item body',
    find: 'sizes?: { name: string; price: number }[]',
    replace: 'sizes?: { name: string; price: number; option_kind?: string; stock_units?: number }[]',
  },
  {
    name: 'report: item units',
    find: '    flat_qty: number;\n  }[];',
    replace: '    flat_qty: number;\n    units?: number; // physical units used (qty x stock_units)\n  }[];',
  },
  {
    name: 'report: unit_totals + standalone_addons',
    find: '  addons: { addon_name: string; qty: number }[];\n}',
    replace:
      '  addons: { addon_name: string; qty: number }[];\n' +
      '  unit_totals?: Record<string, number>;\n' +
      '  standalone_addons?: { addon_name: string; qty: number }[];\n}',
  },
];

const UNITS_KPI =
  "{Object.entries(report.unit_totals ?? {}).filter(([k, u]) => u !== report.flavor_qty_totals[k]).map(([catName, units]) => (\n" +
  "            <KpiCard key={catName + '-units'} icon={<Package size={18} />} label={catName + ' units used'} value={String(units)} color=\"yellow\" />\n" +
  "          ))}\n" +
  "          {flavorQtyEntries.map(([catName, qty]) => (";

const STANDALONE_CARD = String.raw`{(report.standalone_addons?.length ?? 0) > 0 && (
        <div className="bg-white border border-gray-150 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: SALES_BY_ITEM_CATEGORY_DOTS['Add-ons'] }} />
            <h3 className="text-sm font-800 text-gray-800" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>
              Add-ons sold on their own
            </h3>
          </div>
          <table className="w-full text-sm border-collapse">
            <tbody>
              {report.standalone_addons!.map(a => (
                <tr key={a.addon_name} className="border-t border-gray-100">
                  <td className="py-2 text-gray-800 font-medium">{a.addon_name}</td>
                  <td className="text-right py-2 font-700">{a.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report.addons.length > 0 && (`;

const kindSelect = (setter) => String.raw`<select value={s.option_kind} title="What this option is: a real size, a flavor/variant, or an add-on"
                  onChange={e => ${setter}(p => ${setter === 'setNewItem' ? '({ ...p, sizes: p.sizes.map((sz, j) => j === i ? { ...sz, option_kind: e.target.value } : sz) })' : 'p ? { ...p, sizes: p.sizes.map((sz, j) => j === i ? { ...sz, option_kind: e.target.value } : sz) } : null'})}
                  className="w-24 h-10 rounded-xl border border-gray-200 bg-white text-xs px-1.5">
                  <option value="size">Size</option>
                  <option value="variant">Variant</option>
                  <option value="addon">Add-on</option>
                </select>
                <Input type="number" value={s.stock_units}
                  onChange={v => ${setter}(p => ${setter === 'setNewItem' ? '({ ...p, sizes: p.sizes.map((sz, j) => j === i ? { ...sz, stock_units: v } : sz) })' : 'p ? { ...p, sizes: p.sizes.map((sz, j) => j === i ? { ...sz, stock_units: v } : sz) } : null'})}
                  placeholder="Units" className="w-16" />
                `;

const appEdits = [
  {
    name: 'new-item default size row (x2)',
    find: "sizes: [{ name: 'Regular', price: '' }]",
    replace: "sizes: [{ name: 'Regular', price: '', option_kind: 'size', stock_units: '1' }]",
    count: 2,
    done: "option_kind: 'size', stock_units: '1' }]",
  },
  {
    name: 'add-size button default row (x2)',
    find: '[...p.sizes, { name: \'\', price: \'\' }]',
    replace: "[...p.sizes, { name: '', price: '', option_kind: 'size', stock_units: '1' }]",
    count: 2,
    done: "{ name: '', price: '', option_kind: 'size', stock_units: '1' }]",
  },
  {
    name: 'create item payload',
    find: '.map(s => ({ name: s.name, price: parseFloat(s.price) }))',
    replace: '.map(s => ({ name: s.name, price: parseFloat(s.price), option_kind: s.option_kind, stock_units: parseFloat(s.stock_units) || 1 }))',
  },
  {
    name: 'editForm type',
    find: 'sizes: { id?: string; name: string; price: string }[];',
    replace: 'sizes: { id?: string; name: string; price: string; option_kind: string; stock_units: string }[];',
  },
  {
    name: 'openEditItem mapping',
    find: 'sizes: item.sizes.map(s => ({ id: s.id, name: s.name, price: String(s.price) })),',
    replace: "sizes: item.sizes.map(s => ({ id: s.id, name: s.name, price: String(s.price), option_kind: s.option_kind ?? 'size', stock_units: String(s.stock_units ?? 1) })),",
  },
  {
    name: 'update item payload',
    find: '.map(s => ({ ...(s.id ? { id: s.id } : {}), name: s.name, price: parseFloat(s.price) }))',
    replace: '.map(s => ({ ...(s.id ? { id: s.id } : {}), name: s.name, price: parseFloat(s.price), option_kind: s.option_kind, stock_units: parseFloat(s.stock_units) || 1 }))',
  },
  {
    name: 'new-item row: kind + units controls',
    find: '{newItem.sizes.length > 1 && (',
    replace: kindSelect('setNewItem') + '{newItem.sizes.length > 1 && (',
    done: 'onChange={e => setNewItem(p => ({ ...p, sizes: p.sizes.map((sz, j) => j === i ? { ...sz, option_kind',
  },
  {
    name: 'edit-item row: kind + units controls',
    find: '{editForm.sizes.length > 1 && (',
    replace: kindSelect('setEditForm') + '{editForm.sizes.length > 1 && (',
    done: 'onChange={e => setEditForm(p => p ? { ...p, sizes: p.sizes.map((sz, j) => j === i ? { ...sz, option_kind',
  },
  {
    name: 'report: empty check includes standalone add-ons',
    find: 'if (!report || (!report.categories.length && !report.addons.length)) {',
    replace: 'if (!report || (!report.categories.length && !report.addons.length && !(report.standalone_addons?.length))) {',
  },
  {
    name: 'report: units KPI',
    find: '{flavorQtyEntries.map(([catName, qty]) => (',
    replace: UNITS_KPI,
    done: "label={catName + ' units used'}",
  },
  {
    name: 'report: showUnits flag',
    find: "const showColumns = cat.kind !== 'flavor_qty';",
    replace: "const showColumns = cat.kind !== 'flavor_qty';\n        const showUnits = cat.items.some(i => (i.units ?? i.flat_qty) !== i.flat_qty);",
  },
  {
    name: 'report: units header',
    find: ': <th className="text-right font-semibold py-1.5 pl-3">Total</th>}',
    replace:
      ': <th className="text-right font-semibold py-1.5 pl-3">Total</th>}\n' +
      '                  {showUnits && <th className="text-right font-semibold py-1.5 pl-3">Units</th>}',
  },
  {
    name: 'report: units cell',
    find: ': <td className="text-right py-2 pl-3 font-700">{item.flat_qty}</td>}',
    replace:
      ': <td className="text-right py-2 pl-3 font-700">{item.flat_qty}</td>}\n' +
      '                    {showUnits && <td className="text-right py-2 pl-3 font-700">{item.units ?? item.flat_qty}</td>}',
  },
  {
    name: 'report: standalone add-ons table',
    find: '{report.addons.length > 0 && (',
    replace: STANDALONE_CARD,
    done: 'Add-ons sold on their own',
  },
];

// ───────────────────────────────────────────────────────────────
// main
// ───────────────────────────────────────────────────────────────
async function main() {
  for (const rel of ['worker/src/index.ts', 'src/App.tsx', 'src/api.ts', 'src/types.ts']) {
    if (!(await exists(path.join(root, rel)))) {
      console.error(`Not an MW-POS repo root (missing ${rel}). Usage: node mw-pos-proper-fix.mjs <repo-root> [--dry-run]`);
      process.exit(1);
    }
  }

  // Plan everything first: if any anchor is missing we abort with nothing written.
  const results = [
    await patchFile('worker/src/index.ts', workerEdits),
    await patchFile('src/types.ts', typesEdits),
    await patchFile('src/api.ts', apiEdits),
    await patchFile('src/App.tsx', appEdits),
  ];

  const migPath = path.join(root, MIGRATION_REL);
  const migExists = await exists(migPath);

  for (const r of results) { console.log(r.rel); r.log.forEach(l => console.log(l)); }
  console.log(MIGRATION_REL + (migExists ? '\n  = already exists (left untouched)' : '\n  + will be created'));

  if (DRY) { console.log('\n--dry-run: nothing written.'); return; }

  for (const r of results) if (r.changed) await writeFile(r.file, r.text, 'utf8');
  if (!migExists) {
    await mkdir(path.dirname(migPath), { recursive: true });
    await writeFile(migPath, MIGRATION_SQL, 'utf8');
  }

  console.log(`
Done. Next steps:
  1. cd worker && npx wrangler d1 export <DB_NAME> --remote --output backup.sql   (BACKUP)
  2. cd worker && npx wrangler d1 migrations apply <DB_NAME> --remote
  3. Deploy the worker first, then rebuild/reinstall the APK on the tablets.
  4. Menu editor: set "units" on items that aren't 1:1 with stock (e.g. Cheesesticks).
  5. Spot-check: sales with a NULL option_kind are menu items that were deleted;
     they stay under "Uncategorized / Deleted Items" on purpose.
`);
}

main().catch(err => { console.error('\nABORTED, nothing was written:\n' + err.message); process.exit(1); });
