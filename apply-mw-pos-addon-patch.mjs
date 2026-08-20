#!/usr/bin/env node
// apply-mw-pos-addon-patch.mjs
//
// Patches MW-POS so each menu category can have its own set of add-ons,
// and the "Add Item" / "Edit Item" forms let you pick from that
// category's add-ons instead of nothing at all.
//
// Usage:
//   node apply-mw-pos-addon-patch.mjs [path-to-repo-root]
//
// Run it from inside your cloned MW-POS folder, or pass the path to it.
// A .bak copy of every file it touches is created the first time
// (it will not overwrite an existing .bak on re-runs).

import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] || process.cwd();

const patches = [
  {
    "file": "worker/src/index.ts",
    "desc": "addons table: add category_id column",
    "old": "const addons = sqliteTable('addons', {\n  id:           text('id').primaryKey(),\n  name:         text('name').notNull(),\n  price:        real('price').notNull(),\n  is_available: integer('is_available', { mode: 'boolean' }).notNull().default(true),\n})",
    "new": "const addons = sqliteTable('addons', {\n  id:           text('id').primaryKey(),\n  name:         text('name').notNull(),\n  price:        real('price').notNull(),\n  is_available: integer('is_available', { mode: 'boolean' }).notNull().default(true),\n  category_id:  text('category_id').references(() => categories.id),\n})"
  },
  {
    "file": "worker/src/index.ts",
    "desc": "GET /api/menu: include each category's own addons",
    "old": "// GET /api/menu — full menu tree for POS\napp.get('/api/menu', async (c) => {\n  const db = c.get('db')\n  const cats = await db.select().from(categories).orderBy(asc(categories.sort_order))\n  const items = await db.select().from(menuItems).where(eq(menuItems.is_active, true))\n  const sizes = await db.select().from(itemSizes)\n  const addonsAll = await db.select().from(addons)\n  const itemAddonsAll = await db.select().from(itemAddons)\n\n  const menu = cats.map(cat => ({\n    ...cat,\n    items: items\n      .filter(i => i.category_id === cat.id)\n      .map(item => ({\n        ...item,\n        sizes: sizes.filter(s => s.item_id === item.id),\n        addons: itemAddonsAll\n          .filter(ia => ia.item_id === item.id)\n          .map(ia => addonsAll.find(a => a.id === ia.addon_id))\n          .filter(Boolean),\n      })),\n  }))\n  return jsonOk({ categories: menu, addons: addonsAll })\n})",
    "new": "// GET /api/menu — full menu tree for POS\napp.get('/api/menu', async (c) => {\n  const db = c.get('db')\n  const cats = await db.select().from(categories).orderBy(asc(categories.sort_order))\n  const items = await db.select().from(menuItems).where(eq(menuItems.is_active, true))\n  const sizes = await db.select().from(itemSizes)\n  const addonsAll = await db.select().from(addons)\n  const itemAddonsAll = await db.select().from(itemAddons)\n\n  const menu = cats.map(cat => ({\n    ...cat,\n    // NEW: this category's own add-on set (category-scoped, not global)\n    addons: addonsAll.filter(a => a.category_id === cat.id),\n    items: items\n      .filter(i => i.category_id === cat.id)\n      .map(item => ({\n        ...item,\n        sizes: sizes.filter(s => s.item_id === item.id),\n        addons: itemAddonsAll\n          .filter(ia => ia.item_id === item.id)\n          .map(ia => addonsAll.find(a => a.id === ia.addon_id))\n          .filter(Boolean),\n      })),\n  }))\n  return jsonOk({ categories: menu, addons: addonsAll })\n})"
  },
  {
    "file": "worker/src/index.ts",
    "desc": "POST /api/menu/categories: accept addons[] and create them together",
    "old": "app.post('/api/menu/categories', async (c) => {\n  const actor = c.get('user')\n  if (actor.role !== 'admin') return jsonErr('Admin only', 403)\n  const db = c.get('db')\n  const body = await c.req.json<{ name: string; sort_order?: number }>()\n  const id = uid()\n  await db.insert(categories).values({ id, name: body.name, sort_order: body.sort_order ?? 0 })\n  await createAuditLog(db, actor.id, 'create_category', 'category', id, null, body, null)\n  return jsonOk({ id })\n})",
    "new": "app.post('/api/menu/categories', async (c) => {\n  const actor = c.get('user')\n  if (actor.role !== 'admin') return jsonErr('Admin only', 403)\n  const db = c.get('db')\n  const body = await c.req.json<{\n    name: string; sort_order?: number;\n    addons?: { name: string; price: number }[];\n  }>()\n  const id = uid()\n  await db.insert(categories).values({ id, name: body.name, sort_order: body.sort_order ?? 0 })\n  // NEW: create this category's own add-on set in the same request\n  const validAddons = (body.addons ?? []).filter(a => a.name && typeof a.price === 'number' && !isNaN(a.price))\n  if (validAddons.length) {\n    await db.insert(addons).values(validAddons.map(a => ({ id: uid(), name: a.name, price: a.price, category_id: id })))\n  }\n  await createAuditLog(db, actor.id, 'create_category', 'category', id, null, { ...body, addon_count: validAddons.length }, null)\n  return jsonOk({ id })\n})"
  },
  {
    "file": "worker/src/index.ts",
    "desc": "POST /api/menu/addons: accept category_id",
    "old": "app.post('/api/menu/addons', async (c) => {\n  const actor = c.get('user')\n  if (actor.role !== 'admin') return jsonErr('Admin only', 403)\n  const db = c.get('db')\n  const body = await c.req.json<{ name: string; price: number }>()\n  const id = uid()\n  await db.insert(addons).values({ id, name: body.name, price: body.price })\n  // Bug #7 fix: missing audit log for addon creation\n  await createAuditLog(db, actor.id, 'create_addon', 'addon', id, null, { name: body.name, price: body.price }, null)\n  return jsonOk({ id })\n})",
    "new": "app.post('/api/menu/addons', async (c) => {\n  const actor = c.get('user')\n  if (actor.role !== 'admin') return jsonErr('Admin only', 403)\n  const db = c.get('db')\n  const body = await c.req.json<{ name: string; price: number; category_id?: string }>()\n  const id = uid()\n  await db.insert(addons).values({ id, name: body.name, price: body.price, category_id: body.category_id ?? null })\n  // Bug #7 fix: missing audit log for addon creation\n  await createAuditLog(db, actor.id, 'create_addon', 'addon', id, null, { name: body.name, price: body.price, category_id: body.category_id }, null)\n  return jsonOk({ id })\n})"
  },
  {
    "file": "worker/src/index.ts",
    "desc": "PUT /api/menu/addons/:id: allow re-assigning category_id",
    "old": "app.put('/api/menu/addons/:id', async (c) => {\n  const actor = c.get('user')\n  if (actor.role !== 'admin') return jsonErr('Admin only', 403)\n  const db = c.get('db')\n  const id = c.req.param('id')\n  const body = await c.req.json<{ name?: string; price?: number; is_available?: boolean }>()\n  // Bug #7 fix: whitelist fields (mirrors category/item pattern) + add audit log\n  const old = await db.select().from(addons).where(eq(addons.id, id)).get()\n  if (!old) return jsonErr('Addon not found', 404)\n  const safeFields: Partial<typeof addons.$inferInsert> = {}\n  if (body.name         !== undefined) safeFields.name         = body.name\n  if (body.price        !== undefined) safeFields.price        = body.price\n  if (body.is_available !== undefined) safeFields.is_available = body.is_available\n  await db.update(addons).set(safeFields).where(eq(addons.id, id))\n  await createAuditLog(db, actor.id, 'edit_addon', 'addon', id, old, safeFields, null)\n  return jsonOk({ ok: true })\n})",
    "new": "app.put('/api/menu/addons/:id', async (c) => {\n  const actor = c.get('user')\n  if (actor.role !== 'admin') return jsonErr('Admin only', 403)\n  const db = c.get('db')\n  const id = c.req.param('id')\n  const body = await c.req.json<{ name?: string; price?: number; is_available?: boolean; category_id?: string | null }>()\n  // Bug #7 fix: whitelist fields (mirrors category/item pattern) + add audit log\n  const old = await db.select().from(addons).where(eq(addons.id, id)).get()\n  if (!old) return jsonErr('Addon not found', 404)\n  const safeFields: Partial<typeof addons.$inferInsert> = {}\n  if (body.name         !== undefined) safeFields.name         = body.name\n  if (body.price        !== undefined) safeFields.price        = body.price\n  if (body.is_available !== undefined) safeFields.is_available = body.is_available\n  // NEW: allow re-assigning an add-on to a different category (or null to unassign)\n  if (body.category_id  !== undefined) safeFields.category_id  = body.category_id\n  await db.update(addons).set(safeFields).where(eq(addons.id, id))\n  await createAuditLog(db, actor.id, 'edit_addon', 'addon', id, old, safeFields, null)\n  return jsonOk({ ok: true })\n})"
  },
  {
    "file": "src/types.ts",
    "desc": "Addon: add category_id",
    "old": "export interface Addon {\n  id: string;\n  name: string;\n  price: number;\n  is_available: boolean;\n}",
    "new": "export interface Addon {\n  id: string;\n  name: string;\n  price: number;\n  is_available: boolean;\n  category_id: string | null;\n}"
  },
  {
    "file": "src/types.ts",
    "desc": "MenuItem: update stale comment on addons field",
    "old": "export interface MenuItem {\n  id: string;\n  name: string;\n  category_id: string;\n  sizes: ItemSize[];\n  addons: Addon[];          // still returned by API but not used in creation/editing\n  is_active: boolean;\n  is_available: boolean;\n}",
    "new": "export interface MenuItem {\n  id: string;\n  name: string;\n  category_id: string;\n  sizes: ItemSize[];\n  addons: Addon[];          // add-ons currently assigned to this item\n  is_active: boolean;\n  is_available: boolean;\n}"
  },
  {
    "file": "src/types.ts",
    "desc": "Category: add addons field",
    "old": "export interface Category {\n  id: string;\n  name: string;\n  sort_order: number;\n  items: MenuItem[];\n}",
    "new": "export interface Category {\n  id: string;\n  name: string;\n  sort_order: number;\n  items: MenuItem[];\n  addons: Addon[];           // this category's own add-on set\n}"
  },
  {
    "file": "src/api.ts",
    "desc": "useCreateCategory: accept addons[]",
    "old": "export function useCreateCategory() {\n  const api = useApi()\n  const qc = useQueryClient()\n  return useMutation({\n    mutationFn: (body: { name: string; sort_order?: number }) => api.post('/menu/categories', body),\n    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu'] }),\n  })\n}",
    "new": "export function useCreateCategory() {\n  const api = useApi()\n  const qc = useQueryClient()\n  return useMutation({\n    // NEW: addons — this category's own add-on set, created in the same request\n    mutationFn: (body: { name: string; sort_order?: number; addons?: { name: string; price: number }[] }) =>\n      api.post('/menu/categories', body),\n    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu'] }),\n  })\n}"
  },
  {
    "file": "src/api.ts",
    "desc": "useCreateMenuItem: accept addon_ids[]",
    "old": "export function useCreateMenuItem() {\n  const api = useApi()\n  const qc = useQueryClient()\n  return useMutation({\n    mutationFn: (body: { name: string; category_id?: string; sizes: { name: string; price: number }[] }) =>\n      api.post('/menu/items', body),\n    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu'] }),\n  })\n}",
    "new": "export function useCreateMenuItem() {\n  const api = useApi()\n  const qc = useQueryClient()\n  return useMutation({\n    // NEW: addon_ids — which of the category's add-ons apply to this item\n    mutationFn: (body: { name: string; category_id?: string; sizes: { name: string; price: number }[]; addon_ids?: string[] }) =>\n      api.post('/menu/items', body),\n    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu'] }),\n  })\n}"
  },
  {
    "file": "src/api.ts",
    "desc": "useUpdateMenuItem: accept addon_ids[]",
    "old": "export function useUpdateMenuItem() {\n  const api = useApi()\n  const qc = useQueryClient()\n  return useMutation({\n    // Bug #11 fix: category_id can be null to unassign a category from an item.\n    mutationFn: ({ id, ...body }: { id: string; name?: string; category_id?: string | null; is_active?: boolean; sizes?: { name: string; price: number }[] }) =>\n      api.put(`/menu/items/${id}`, body),\n    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu'] }),\n  })\n}",
    "new": "export function useUpdateMenuItem() {\n  const api = useApi()\n  const qc = useQueryClient()\n  return useMutation({\n    // Bug #11 fix: category_id can be null to unassign a category from an item.\n    // NEW: addon_ids — replaces this item's assigned add-ons when provided.\n    mutationFn: ({ id, ...body }: { id: string; name?: string; category_id?: string | null; is_active?: boolean; sizes?: { name: string; price: number }[]; addon_ids?: string[] }) =>\n      api.put(`/menu/items/${id}`, body),\n    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu'] }),\n  })\n}"
  },
  {
    "file": "src/api.ts",
    "desc": "useCreateAddon: accept category_id",
    "old": "export function useCreateAddon() {\n  const api = useApi()\n  const qc = useQueryClient()\n  return useMutation({\n    mutationFn: (body: { name: string; price: number }) => api.post('/menu/addons', body),\n    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu'] }),\n  })\n}",
    "new": "export function useCreateAddon() {\n  const api = useApi()\n  const qc = useQueryClient()\n  return useMutation({\n    mutationFn: (body: { name: string; price: number; category_id?: string }) => api.post('/menu/addons', body),\n    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu'] }),\n  })\n}"
  },
  {
    "file": "src/App.tsx",
    "desc": "AdminMenuPage state: add showAddCategory, newCatAddons, addon_ids on newItem, category_id on newAddon",
    "old": "  const [tab, setTab] = useState<'items' | 'addons'>('items');\n  const [newCatName, setNewCatName] = useState('');\n  const [showAddItem, setShowAddItem] = useState(false);\n  const [showAddAddon, setShowAddAddon] = useState(false);\n  const [editItem, setEditItem] = useState<MenuItem | null>(null);\n  const [newItem, setNewItem] = useState({ name: '', category_id: '', sizes: [{ name: 'Regular', price: '' }] });\n  const [newAddon, setNewAddon] = useState({ name: '', price: '' });",
    "new": "  const [tab, setTab] = useState<'items' | 'addons'>('items');\n  const [showAddCategory, setShowAddCategory] = useState(false);\n  const [newCatName, setNewCatName] = useState('');\n  const [newCatAddons, setNewCatAddons] = useState<{ name: string; price: string }[]>([{ name: '', price: '' }]);\n  const [showAddItem, setShowAddItem] = useState(false);\n  const [showAddAddon, setShowAddAddon] = useState(false);\n  const [editItem, setEditItem] = useState<MenuItem | null>(null);\n  const [newItem, setNewItem] = useState({ name: '', category_id: '', sizes: [{ name: 'Regular', price: '' }], addon_ids: [] as string[] });\n  const [newAddon, setNewAddon] = useState({ name: '', price: '', category_id: '' });"
  },
  {
    "file": "src/App.tsx",
    "desc": "handleAddCategory: send the category's add-ons, open via modal state",
    "old": "  const handleAddCategory = useCallback(async () => {\n    if (!newCatName.trim()) return;\n    // FIX [F]: surface API errors (e.g. duplicate name) instead of swallowing them\n    try {\n      await createCategory.mutateAsync({ name: newCatName, sort_order: categories.length });\n      setNewCatName('');\n      toast('Category added');\n    } catch (e: unknown) {\n      toast(e instanceof Error ? e.message : 'Failed to add category', 'error');\n    }\n  }, [createCategory, newCatName, categories.length]);",
    "new": "  const handleAddCategory = useCallback(async () => {\n    if (!newCatName.trim()) return;\n    // NEW: this category's add-on set, created together with the category\n    const catAddons = newCatAddons\n      .filter(a => a.name.trim() && a.price)\n      .map(a => ({ name: a.name.trim(), price: parseFloat(a.price) }));\n    // FIX [F]: surface API errors (e.g. duplicate name) instead of swallowing them\n    try {\n      await createCategory.mutateAsync({ name: newCatName, sort_order: categories.length, addons: catAddons });\n      setNewCatName('');\n      setNewCatAddons([{ name: '', price: '' }]);\n      setShowAddCategory(false);\n      toast('Category added');\n    } catch (e: unknown) {\n      toast(e instanceof Error ? e.message : 'Failed to add category', 'error');\n    }\n  }, [createCategory, newCatName, newCatAddons, categories.length]);"
  },
  {
    "file": "src/App.tsx",
    "desc": "handleAddItem: send selected addon_ids",
    "old": "  const handleAddItem = useCallback(async () => {\n    const sizes = newItem.sizes.filter(s => s.name && s.price).map(s => ({ name: s.name, price: parseFloat(s.price) }));\n    if (!newItem.name || !sizes.length) return;\n    // FIX [G]: catch API errors so the form stays open and user sees the problem\n    try {\n      await createItem.mutateAsync({ name: newItem.name, category_id: newItem.category_id || undefined, sizes });\n      setNewItem({ name: '', category_id: '', sizes: [{ name: 'Regular', price: '' }] });\n      setShowAddItem(false);\n      toast('Item added');\n    } catch (e: unknown) {\n      toast(e instanceof Error ? e.message : 'Failed to add item', 'error');\n    }\n  }, [createItem, newItem]);",
    "new": "  const handleAddItem = useCallback(async () => {\n    const sizes = newItem.sizes.filter(s => s.name && s.price).map(s => ({ name: s.name, price: parseFloat(s.price) }));\n    if (!newItem.name || !sizes.length) return;\n    // FIX [G]: catch API errors so the form stays open and user sees the problem\n    try {\n      await createItem.mutateAsync({ name: newItem.name, category_id: newItem.category_id || undefined, sizes, addon_ids: newItem.addon_ids });\n      setNewItem({ name: '', category_id: '', sizes: [{ name: 'Regular', price: '' }], addon_ids: [] });\n      setShowAddItem(false);\n      toast('Item added');\n    } catch (e: unknown) {\n      toast(e instanceof Error ? e.message : 'Failed to add item', 'error');\n    }\n  }, [createItem, newItem]);"
  },
  {
    "file": "src/App.tsx",
    "desc": "handleAddAddon: send category_id",
    "old": "  const handleAddAddon = useCallback(async () => {\n    if (!newAddon.name || !newAddon.price) return;\n    // FIX [H]: catch API errors (e.g. duplicate add-on name)\n    try {\n      await createAddon.mutateAsync({ name: newAddon.name, price: parseFloat(newAddon.price) });\n      setNewAddon({ name: '', price: '' });\n      setShowAddAddon(false);\n      toast('Add-on added');\n    } catch (e: unknown) {\n      toast(e instanceof Error ? e.message : 'Failed to add add-on', 'error');\n    }\n  }, [createAddon, newAddon]);",
    "new": "  const handleAddAddon = useCallback(async () => {\n    if (!newAddon.name || !newAddon.price) return;\n    // FIX [H]: catch API errors (e.g. duplicate add-on name)\n    try {\n      await createAddon.mutateAsync({ name: newAddon.name, price: parseFloat(newAddon.price), category_id: newAddon.category_id || undefined });\n      setNewAddon({ name: '', price: '', category_id: '' });\n      setShowAddAddon(false);\n      toast('Add-on added');\n    } catch (e: unknown) {\n      toast(e instanceof Error ? e.message : 'Failed to add add-on', 'error');\n    }\n  }, [createAddon, newAddon]);"
  },
  {
    "file": "src/App.tsx",
    "desc": "editForm/openEditItem/handleEditItem: track and send addon_ids",
    "old": "  const [editForm, setEditForm] = useState<{\n    name: string; category_id: string;\n    sizes: { id?: string; name: string; price: string }[];\n  } | null>(null);\n\n  const openEditItem = useCallback((item: MenuItem) => {\n    setEditItem(item);\n    setEditForm({ name: item.name, category_id: item.category_id ?? '', sizes: item.sizes.map(s => ({ id: s.id, name: s.name, price: String(s.price) })) });\n  }, []);\n\n  const handleEditItem = useCallback(async () => {\n    if (!editItem || !editForm) return;\n    const sizes = editForm.sizes.filter(s => s.name && s.price).map(s => ({ ...(s.id ? { id: s.id } : {}), name: s.name, price: parseFloat(s.price) }));\n    if (!editForm.name || !sizes.length) return;\n    // FIX [I]: keep form open and show error instead of silently failing\n    try {\n      // Bug #11 fix: send null instead of undefined when category_id is cleared.\n      // undefined is silently omitted by Drizzle's SET clause, leaving the item\n      // in its current category. null produces SET category_id = NULL as intended.\n      await updateItem.mutateAsync({ id: editItem.id, name: editForm.name, category_id: editForm.category_id || null, sizes });\n      setEditItem(null); setEditForm(null);\n      toast('Item updated');\n    } catch (e: unknown) {\n      toast(e instanceof Error ? e.message : 'Failed to update item', 'error');\n    }\n  }, [updateItem, editItem, editForm]);",
    "new": "  const [editForm, setEditForm] = useState<{\n    name: string; category_id: string;\n    sizes: { id?: string; name: string; price: string }[];\n    addon_ids: string[];\n  } | null>(null);\n\n  const openEditItem = useCallback((item: MenuItem) => {\n    setEditItem(item);\n    setEditForm({\n      name: item.name, category_id: item.category_id ?? '',\n      sizes: item.sizes.map(s => ({ id: s.id, name: s.name, price: String(s.price) })),\n      addon_ids: item.addons.map(a => a.id),\n    });\n  }, []);\n\n  const handleEditItem = useCallback(async () => {\n    if (!editItem || !editForm) return;\n    const sizes = editForm.sizes.filter(s => s.name && s.price).map(s => ({ ...(s.id ? { id: s.id } : {}), name: s.name, price: parseFloat(s.price) }));\n    if (!editForm.name || !sizes.length) return;\n    // FIX [I]: keep form open and show error instead of silently failing\n    try {\n      // Bug #11 fix: send null instead of undefined when category_id is cleared.\n      // undefined is silently omitted by Drizzle's SET clause, leaving the item\n      // in its current category. null produces SET category_id = NULL as intended.\n      await updateItem.mutateAsync({ id: editItem.id, name: editForm.name, category_id: editForm.category_id || null, sizes, addon_ids: editForm.addon_ids });\n      setEditItem(null); setEditForm(null);\n      toast('Item updated');\n    } catch (e: unknown) {\n      toast(e instanceof Error ? e.message : 'Failed to update item', 'error');\n    }\n  }, [updateItem, editItem, editForm]);"
  },
  {
    "file": "src/App.tsx",
    "desc": "Replace inline category name field with an Add Category button that opens a modal",
    "old": "            <div className=\"flex gap-2\">\n              <Input value={newCatName} onChange={setNewCatName} placeholder=\"New category name…\" className=\"flex-1\" />\n              <Btn variant=\"leaf\" onClick={handleAddCategory} disabled={!newCatName.trim()} loading={createCategory.isPending}>\n                <Plus size={14} /> Add Category\n              </Btn>\n            </div>",
    "new": "            <div className=\"flex gap-2\">\n              <Btn variant=\"leaf\" onClick={() => setShowAddCategory(true)}>\n                <Plus size={14} /> Add Category\n              </Btn>\n            </div>"
  },
  {
    "file": "src/App.tsx",
    "desc": "Add Category modal (new) + addon picker in Add Item modal",
    "old": "      <Modal open={showAddItem} onClose={() => setShowAddItem(false)} title=\"Add Menu Item\" maxWidth=\"max-w-md\">\n        <div className=\"flex flex-col gap-4\">\n          <Input label=\"Item Name\" value={newItem.name} onChange={v => setNewItem(p => ({ ...p, name: v }))} autoFocus />\n          <Select label=\"Category\" value={newItem.category_id}\n            onChange={v => setNewItem(p => ({ ...p, category_id: v }))}\n            options={[{ value: '', label: '— No category —' }, ...categories.map((c: Category) => ({ value: c.id, label: c.name }))]} />\n          <div>\n            <div className=\"text-xs font-800 text-gray-500 uppercase tracking-widest mb-2.5\"\n              style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>Sizes & Prices</div>\n            {newItem.sizes.map((s, i) => (\n              <div key={i} className=\"flex gap-2 mb-2 items-start\">\n                <Input value={s.name} onChange={v => setNewItem(p => ({ ...p, sizes: p.sizes.map((sz, j) => j === i ? { ...sz, name: v } : sz) }))}\n                  placeholder=\"Size name\" className=\"flex-1\" />\n                <Input type=\"number\" value={s.price}\n                  onChange={v => setNewItem(p => ({ ...p, sizes: p.sizes.map((sz, j) => j === i ? { ...sz, price: v } : sz) }))}\n                  placeholder=\"Price\" className=\"w-24\" />\n                {newItem.sizes.length > 1 && (\n                  <button onClick={() => setNewItem(p => ({ ...p, sizes: p.sizes.filter((_, j) => j !== i) }))}\n                    className=\"text-gray-400 hover:text-red-500 mt-2.5 p-1.5 rounded-lg hover:bg-red-50 transition-colors\">\n                    <X size={14} />\n                  </button>\n                )}\n              </div>\n            ))}\n            <Btn size=\"sm\" variant=\"ghost\" onClick={() => setNewItem(p => ({ ...p, sizes: [...p.sizes, { name: '', price: '' }] }))}>\n              <Plus size={12} /> Add Size\n            </Btn>\n          </div>\n          <Divider />\n          <div className=\"flex gap-2\">\n            <Btn variant=\"secondary\" onClick={() => setShowAddItem(false)} className=\"flex-1\">Cancel</Btn>\n            <Btn variant=\"mango\" onClick={handleAddItem} loading={createItem.isPending}\n              disabled={!newItem.name || newItem.sizes.every(s => !s.price)} className=\"flex-1\">Add Item</Btn>\n          </div>\n        </div>\n      </Modal>",
    "new": "      <Modal open={showAddCategory} onClose={() => setShowAddCategory(false)} title=\"Add Category\" maxWidth=\"max-w-md\">\n        <div className=\"flex flex-col gap-4\">\n          <Input label=\"Category Name\" value={newCatName} onChange={setNewCatName} placeholder=\"e.g. Milk Tea\" autoFocus />\n          <div>\n            <div className=\"text-xs font-800 text-gray-500 uppercase tracking-widest mb-2.5\"\n              style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>Add-ons for this category</div>\n            {newCatAddons.map((a, i) => (\n              <div key={i} className=\"flex gap-2 mb-2 items-start\">\n                <Input value={a.name} onChange={v => setNewCatAddons(p => p.map((ad, j) => j === i ? { ...ad, name: v } : ad))}\n                  placeholder=\"Add-on name\" className=\"flex-1\" />\n                <Input type=\"number\" value={a.price}\n                  onChange={v => setNewCatAddons(p => p.map((ad, j) => j === i ? { ...ad, price: v } : ad))}\n                  placeholder=\"Price\" className=\"w-24\" />\n                {newCatAddons.length > 1 && (\n                  <button onClick={() => setNewCatAddons(p => p.filter((_, j) => j !== i))}\n                    className=\"text-gray-400 hover:text-red-500 mt-2.5 p-1.5 rounded-lg hover:bg-red-50 transition-colors\">\n                    <X size={14} />\n                  </button>\n                )}\n              </div>\n            ))}\n            <Btn size=\"sm\" variant=\"ghost\" onClick={() => setNewCatAddons(p => [...p, { name: '', price: '' }])}>\n              <Plus size={12} /> Add Add-on\n            </Btn>\n          </div>\n          <Divider />\n          <div className=\"flex gap-2\">\n            <Btn variant=\"secondary\" onClick={() => setShowAddCategory(false)} className=\"flex-1\">Cancel</Btn>\n            <Btn variant=\"mango\" onClick={handleAddCategory} loading={createCategory.isPending}\n              disabled={!newCatName.trim()} className=\"flex-1\">Add Category</Btn>\n          </div>\n        </div>\n      </Modal>\n\n      <Modal open={showAddItem} onClose={() => setShowAddItem(false)} title=\"Add Menu Item\" maxWidth=\"max-w-md\">\n        <div className=\"flex flex-col gap-4\">\n          <Input label=\"Item Name\" value={newItem.name} onChange={v => setNewItem(p => ({ ...p, name: v }))} autoFocus />\n          <Select label=\"Category\" value={newItem.category_id}\n            onChange={v => setNewItem(p => ({ ...p, category_id: v, addon_ids: [] }))}\n            options={[{ value: '', label: '— No category —' }, ...categories.map((c: Category) => ({ value: c.id, label: c.name }))]} />\n          <div>\n            <div className=\"text-xs font-800 text-gray-500 uppercase tracking-widest mb-2.5\"\n              style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>Sizes & Prices</div>\n            {newItem.sizes.map((s, i) => (\n              <div key={i} className=\"flex gap-2 mb-2 items-start\">\n                <Input value={s.name} onChange={v => setNewItem(p => ({ ...p, sizes: p.sizes.map((sz, j) => j === i ? { ...sz, name: v } : sz) }))}\n                  placeholder=\"Size name\" className=\"flex-1\" />\n                <Input type=\"number\" value={s.price}\n                  onChange={v => setNewItem(p => ({ ...p, sizes: p.sizes.map((sz, j) => j === i ? { ...sz, price: v } : sz) }))}\n                  placeholder=\"Price\" className=\"w-24\" />\n                {newItem.sizes.length > 1 && (\n                  <button onClick={() => setNewItem(p => ({ ...p, sizes: p.sizes.filter((_, j) => j !== i) }))}\n                    className=\"text-gray-400 hover:text-red-500 mt-2.5 p-1.5 rounded-lg hover:bg-red-50 transition-colors\">\n                    <X size={14} />\n                  </button>\n                )}\n              </div>\n            ))}\n            <Btn size=\"sm\" variant=\"ghost\" onClick={() => setNewItem(p => ({ ...p, sizes: [...p.sizes, { name: '', price: '' }] }))}>\n              <Plus size={12} /> Add Size\n            </Btn>\n          </div>\n          {newItem.category_id && (categories.find((c: Category) => c.id === newItem.category_id)?.addons?.length ?? 0) > 0 && (\n            <div>\n              <div className=\"text-xs font-800 text-gray-500 uppercase tracking-widest mb-2.5\"\n                style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>Add-ons (optional)</div>\n              <div className=\"flex flex-wrap gap-1.5\">\n                {categories.find((c: Category) => c.id === newItem.category_id)?.addons.map((a: Addon) => {\n                  const selected = newItem.addon_ids.includes(a.id);\n                  return (\n                    <button key={a.id} type=\"button\"\n                      onClick={() => setNewItem(p => ({\n                        ...p,\n                        addon_ids: selected ? p.addon_ids.filter(id => id !== a.id) : [...p.addon_ids, a.id],\n                      }))}\n                      className={clsx('px-3 py-1.5 rounded-xl text-xs font-700 transition-colors border',\n                        selected\n                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'\n                          : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'\n                      )}\n                      style={{ fontWeight: 700 }}>\n                      {a.name} (+{fmt(a.price)})\n                    </button>\n                  );\n                })}\n              </div>\n            </div>\n          )}\n          <Divider />\n          <div className=\"flex gap-2\">\n            <Btn variant=\"secondary\" onClick={() => setShowAddItem(false)} className=\"flex-1\">Cancel</Btn>\n            <Btn variant=\"mango\" onClick={handleAddItem} loading={createItem.isPending}\n              disabled={!newItem.name || newItem.sizes.every(s => !s.price)} className=\"flex-1\">Add Item</Btn>\n          </div>\n        </div>\n      </Modal>"
  },
  {
    "file": "src/App.tsx",
    "desc": "Edit Item modal: add addon picker scoped to the item's category",
    "old": "      <Modal open={!!editItem} onClose={() => { setEditItem(null); setEditForm(null); }} title={`Edit: ${editItem?.name}`} maxWidth=\"max-w-md\">\n        {editForm && (\n          <div className=\"flex flex-col gap-4\">\n            <Input label=\"Item Name\" value={editForm.name} onChange={v => setEditForm(p => p ? { ...p, name: v } : null)} />\n            <Select label=\"Category\" value={editForm.category_id}\n              onChange={v => setEditForm(p => p ? { ...p, category_id: v } : null)}\n              options={[{ value: '', label: '— No category —' }, ...categories.map((c: Category) => ({ value: c.id, label: c.name }))]} />\n            <div>\n              <div className=\"text-xs font-800 text-gray-500 uppercase tracking-widest mb-2.5\"\n                style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>Sizes & Prices</div>\n              {editForm.sizes.map((s, i) => (\n                <div key={i} className=\"flex gap-2 mb-2 items-start\">\n                  <Input value={s.name}\n                    onChange={v => setEditForm(p => p ? { ...p, sizes: p.sizes.map((sz, j) => j === i ? { ...sz, name: v } : sz) } : null)}\n                    placeholder=\"Size name\" className=\"flex-1\" />\n                  <Input type=\"number\" value={s.price}\n                    onChange={v => setEditForm(p => p ? { ...p, sizes: p.sizes.map((sz, j) => j === i ? { ...sz, price: v } : sz) } : null)}\n                    placeholder=\"Price\" className=\"w-24\" />\n                  {editForm.sizes.length > 1 && (\n                    <button onClick={() => setEditForm(p => p ? { ...p, sizes: p.sizes.filter((_, j) => j !== i) } : null)}\n                      className=\"text-gray-400 hover:text-red-500 mt-2.5 p-1.5 rounded-lg hover:bg-red-50 transition-colors\">\n                      <X size={14} />\n                    </button>\n                  )}\n                </div>\n              ))}\n              <Btn size=\"sm\" variant=\"ghost\" onClick={() => setEditForm(p => p ? { ...p, sizes: [...p.sizes, { name: '', price: '' }] } : null)}>\n                <Plus size={12} /> Add Size\n              </Btn>\n            </div>\n            <Divider />\n            <div className=\"flex gap-2\">\n              <Btn variant=\"secondary\" onClick={() => { setEditItem(null); setEditForm(null); }} className=\"flex-1\">Cancel</Btn>\n              <Btn variant=\"mango\" onClick={handleEditItem} loading={updateItem.isPending}\n                disabled={!editForm.name || editForm.sizes.every(s => !s.price)} className=\"flex-1\">\n                <Save size={14} /> Save Changes\n              </Btn>\n            </div>\n          </div>\n        )}\n      </Modal>",
    "new": "      <Modal open={!!editItem} onClose={() => { setEditItem(null); setEditForm(null); }} title={`Edit: ${editItem?.name}`} maxWidth=\"max-w-md\">\n        {editForm && (\n          <div className=\"flex flex-col gap-4\">\n            <Input label=\"Item Name\" value={editForm.name} onChange={v => setEditForm(p => p ? { ...p, name: v } : null)} />\n            <Select label=\"Category\" value={editForm.category_id}\n              onChange={v => setEditForm(p => p ? { ...p, category_id: v, addon_ids: [] } : null)}\n              options={[{ value: '', label: '— No category —' }, ...categories.map((c: Category) => ({ value: c.id, label: c.name }))]} />\n            <div>\n              <div className=\"text-xs font-800 text-gray-500 uppercase tracking-widest mb-2.5\"\n                style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>Sizes & Prices</div>\n              {editForm.sizes.map((s, i) => (\n                <div key={i} className=\"flex gap-2 mb-2 items-start\">\n                  <Input value={s.name}\n                    onChange={v => setEditForm(p => p ? { ...p, sizes: p.sizes.map((sz, j) => j === i ? { ...sz, name: v } : sz) } : null)}\n                    placeholder=\"Size name\" className=\"flex-1\" />\n                  <Input type=\"number\" value={s.price}\n                    onChange={v => setEditForm(p => p ? { ...p, sizes: p.sizes.map((sz, j) => j === i ? { ...sz, price: v } : sz) } : null)}\n                    placeholder=\"Price\" className=\"w-24\" />\n                  {editForm.sizes.length > 1 && (\n                    <button onClick={() => setEditForm(p => p ? { ...p, sizes: p.sizes.filter((_, j) => j !== i) } : null)}\n                      className=\"text-gray-400 hover:text-red-500 mt-2.5 p-1.5 rounded-lg hover:bg-red-50 transition-colors\">\n                      <X size={14} />\n                    </button>\n                  )}\n                </div>\n              ))}\n              <Btn size=\"sm\" variant=\"ghost\" onClick={() => setEditForm(p => p ? { ...p, sizes: [...p.sizes, { name: '', price: '' }] } : null)}>\n                <Plus size={12} /> Add Size\n              </Btn>\n            </div>\n            {editForm.category_id && (categories.find((c: Category) => c.id === editForm.category_id)?.addons?.length ?? 0) > 0 && (\n              <div>\n                <div className=\"text-xs font-800 text-gray-500 uppercase tracking-widest mb-2.5\"\n                  style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>Add-ons (optional)</div>\n                <div className=\"flex flex-wrap gap-1.5\">\n                  {categories.find((c: Category) => c.id === editForm.category_id)?.addons.map((a: Addon) => {\n                    const selected = editForm.addon_ids.includes(a.id);\n                    return (\n                      <button key={a.id} type=\"button\"\n                        onClick={() => setEditForm(p => p ? {\n                          ...p,\n                          addon_ids: selected ? p.addon_ids.filter(id => id !== a.id) : [...p.addon_ids, a.id],\n                        } : null)}\n                        className={clsx('px-3 py-1.5 rounded-xl text-xs font-700 transition-colors border',\n                          selected\n                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'\n                            : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'\n                        )}\n                        style={{ fontWeight: 700 }}>\n                        {a.name} (+{fmt(a.price)})\n                      </button>\n                    );\n                  })}\n                </div>\n              </div>\n            )}\n            <Divider />\n            <div className=\"flex gap-2\">\n              <Btn variant=\"secondary\" onClick={() => { setEditItem(null); setEditForm(null); }} className=\"flex-1\">Cancel</Btn>\n              <Btn variant=\"mango\" onClick={handleEditItem} loading={updateItem.isPending}\n                disabled={!editForm.name || editForm.sizes.every(s => !s.price)} className=\"flex-1\">\n                <Save size={14} /> Save Changes\n              </Btn>\n            </div>\n          </div>\n        )}\n      </Modal>"
  },
  {
    "file": "src/App.tsx",
    "desc": "Add Add-on modal: pick which category this add-on belongs to",
    "old": "      <Modal open={showAddAddon} onClose={() => setShowAddAddon(false)} title=\"Add Add-on\">\n        <div className=\"flex flex-col gap-4\">\n          <Input label=\"Add-on Name\" value={newAddon.name} onChange={v => setNewAddon(p => ({ ...p, name: v }))} autoFocus />\n          <Input label=\"Price (₱)\" type=\"number\" value={newAddon.price} onChange={v => setNewAddon(p => ({ ...p, price: v }))} min={0} step={0.01} />\n          <div className=\"flex gap-2\">\n            <Btn variant=\"secondary\" onClick={() => setShowAddAddon(false)} className=\"flex-1\">Cancel</Btn>\n            <Btn variant=\"mango\" onClick={handleAddAddon} loading={createAddon.isPending}\n              disabled={!newAddon.name || !newAddon.price} className=\"flex-1\">Add</Btn>\n          </div>\n        </div>\n      </Modal>",
    "new": "      <Modal open={showAddAddon} onClose={() => setShowAddAddon(false)} title=\"Add Add-on\">\n        <div className=\"flex flex-col gap-4\">\n          <Input label=\"Add-on Name\" value={newAddon.name} onChange={v => setNewAddon(p => ({ ...p, name: v }))} autoFocus />\n          <Input label=\"Price (₱)\" type=\"number\" value={newAddon.price} onChange={v => setNewAddon(p => ({ ...p, price: v }))} min={0} step={0.01} />\n          <Select label=\"Category\" value={newAddon.category_id}\n            onChange={v => setNewAddon(p => ({ ...p, category_id: v }))}\n            options={[{ value: '', label: '— No category (global) —' }, ...categories.map((c: Category) => ({ value: c.id, label: c.name }))]} />\n          <div className=\"flex gap-2\">\n            <Btn variant=\"secondary\" onClick={() => setShowAddAddon(false)} className=\"flex-1\">Cancel</Btn>\n            <Btn variant=\"mango\" onClick={handleAddAddon} loading={createAddon.isPending}\n              disabled={!newAddon.name || !newAddon.price} className=\"flex-1\">Add</Btn>\n          </div>\n        </div>\n      </Modal>"
  },
  {
    "file": "src/App.tsx",
    "desc": "Addons tab: show which category each add-on belongs to",
    "old": "              {allAddons.map((addon: Addon) => (\n                <div key={addon.id}\n                  className=\"flex items-center justify-between bg-white border border-gray-150 rounded-2xl px-4 py-3.5 shadow-sm\">\n                  <div>\n                    <div className=\"text-gray-900 font-700 text-sm\" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{addon.name}</div>\n                    <div className=\"text-xs font-800 mt-0.5 text-amber-700\" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>\n                      +{fmt(addon.price)}\n                    </div>\n                  </div>",
    "new": "              {allAddons.map((addon: Addon) => (\n                <div key={addon.id}\n                  className=\"flex items-center justify-between bg-white border border-gray-150 rounded-2xl px-4 py-3.5 shadow-sm\">\n                  <div>\n                    <div className=\"flex items-center gap-1.5\">\n                      <div className=\"text-gray-900 font-700 text-sm\" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{addon.name}</div>\n                      {addon.category_id && (\n                        <Badge color=\"gray\">{categories.find((c: Category) => c.id === addon.category_id)?.name ?? 'unknown'}</Badge>\n                      )}\n                    </div>\n                    <div className=\"text-xs font-800 mt-0.5 text-amber-700\" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>\n                      +{fmt(addon.price)}\n                    </div>\n                  </div>"
  }
];

const migrationPath = path.join(root, 'worker', 'migrations', '0002_add_addon_categories.sql');
const migrationContent = "-- ============================================================\n-- ADD CATEGORY-SCOPED ADD-ONS\n-- ============================================================\n-- Adds a nullable category_id to addons so each category can have\n-- its own add-on set. Existing add-ons keep category_id = NULL\n-- (treated as unassigned/global) until reassigned via the UI.\nALTER TABLE addons ADD COLUMN category_id TEXT REFERENCES categories(id);\n";

function log(msg) { console.log(msg); }

function applyPatchesToFile(file, filePatches) {
  const abs = path.join(root, file);
  if (!fs.existsSync(abs)) {
    log(`  [SKIP] ${file} not found at ${abs}`);
    return { applied: 0, skipped: filePatches.length, failed: 0 };
  }

  let content = fs.readFileSync(abs, 'utf8');
  const bak = abs + '.bak';
  if (!fs.existsSync(bak)) {
    fs.writeFileSync(bak, content, 'utf8');
  }

  let applied = 0, skipped = 0, failed = 0;

  for (const p of filePatches) {
    const count = content.split(p.old).length - 1;
    if (count === 0) {
      // Might already be applied (new text present instead)
      const alreadyApplied = content.includes(p.new);
      if (alreadyApplied) {
        log(`  [SKIP] ${p.desc} (already applied)`);
        skipped++;
      } else {
        log(`  [FAIL] ${p.desc} \u2014 anchor text not found. File may have changed since this patch was written; apply this one manually.`);
        failed++;
      }
      continue;
    }
    if (count > 1) {
      log(`  [FAIL] ${p.desc} \u2014 anchor text matched ${count} times, expected exactly 1. Skipping to avoid corrupting the file \u2014 apply this one manually.`);
      failed++;
      continue;
    }
    content = content.replace(p.old, p.new);
    log(`  [OK]   ${p.desc}`);
    applied++;
  }

  if (applied > 0) {
    fs.writeFileSync(abs, content, 'utf8');
  }

  return { applied, skipped, failed };
}

log(`MW-POS category add-ons patch \u2014 root: ${root}\n`);

const byFile = {};
for (const p of patches) {
  (byFile[p.file] ||= []).push(p);
}

let totals = { applied: 0, skipped: 0, failed: 0 };
for (const [file, filePatches] of Object.entries(byFile)) {
  log(`${file}`);
  const r = applyPatchesToFile(file, filePatches);
  totals.applied += r.applied;
  totals.skipped += r.skipped;
  totals.failed += r.failed;
  log('');
}

// Migration file (new file, not a patch)
if (fs.existsSync(migrationPath)) {
  log(`worker/migrations/0002_add_addon_categories.sql\n  [SKIP] already exists\n`);
} else {
  fs.mkdirSync(path.dirname(migrationPath), { recursive: true });
  fs.writeFileSync(migrationPath, migrationContent, 'utf8');
  log(`worker/migrations/0002_add_addon_categories.sql\n  [OK]   created\n`);
}

log(`Done. Applied ${totals.applied}, skipped ${totals.skipped}, failed ${totals.failed}.`);
if (totals.failed > 0) {
  log(`\nSome patches could not be applied automatically (see [FAIL] lines above).`);
  log(`Original files were backed up as *.bak before any changes \u2014 restore with:`);
  log(`  cp <file>.bak <file>`);
  process.exitCode = 1;
} else {
  log(`\nNext: run the DB migration, then restart your dev server. See the step-by-step guide.`);
}
