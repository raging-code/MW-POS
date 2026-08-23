#!/usr/bin/env node
// apply-delete-all-sales.mjs
//
// Adds a "Delete All Sales Data" admin feature to MW-POS:
//   - Backend: POST /api/sales/purge-all (admin only, hard delete)
//     Wipes: sales, sale_items, sale_item_addons, sale_payments,
//            cash_drops, shifts. Resets receipt_counters.
//     Writes ONE audit_log row (with row counts) before deleting.
//     NOT touched: users, menu/categories/addons, held_orders,
//     inventory, system_settings, audit_logs.
//   - Frontend: new hook `usePurgeAllSales` in src/api.ts, and a
//     "Danger Zone" card in the Admin Settings page with a reason
//     field, a type-to-confirm input, and the existing PIN-modal
//     re-authorization flow (same pattern as sale delete/void).
//
// Usage:
//   node apply-delete-all-sales.mjs            (run from repo root)
//   node apply-delete-all-sales.mjs --dry-run   (show what would change)
//
// Idempotent: safe to run multiple times; already-applied changes
// are detected and skipped.

import fs from 'node:fs'
import path from 'node:path'

const DRY_RUN = process.argv.includes('--dry-run')
const ROOT = process.cwd()

const WORKER_FILE = path.join(ROOT, 'worker', 'src', 'index.ts')
const API_FILE = path.join(ROOT, 'src', 'api.ts')
const APP_FILE = path.join(ROOT, 'src', 'App.tsx')

let anyChange = false

// Track which files use CRLF so we can restore it on write — Windows
// checkouts (core.autocrlf=true) commonly have CRLF line endings, but all
// anchors/inserts in this script are written with plain \n. We normalize
// to \n on read and convert back to the file's original ending on write.
const crlfFiles = new Set()

function readFile(p) {
  if (!fs.existsSync(p)) {
    console.error(`✗ Required file not found: ${p}`)
    console.error(`  Make sure you're running this from the MW-POS repo root.`)
    process.exit(1)
  }
  const raw = fs.readFileSync(p, 'utf8')
  if (raw.includes('\r\n')) crlfFiles.add(p)
  return raw.replace(/\r\n/g, '\n')
}

function writeFile(p, content) {
  const out = crlfFiles.has(p) ? content.replace(/\n/g, '\r\n') : content
  if (DRY_RUN) {
    console.log(`  [dry-run] would write ${path.relative(ROOT, p)}`)
    return
  }
  fs.writeFileSync(p, out, 'utf8')
  console.log(`  ✓ wrote ${path.relative(ROOT, p)}`)
}

function requireAnchor(content, anchor, fileLabel) {
  if (!content.includes(anchor)) {
    console.error(`✗ ${fileLabel}: expected anchor not found — file may have changed upstream.`)
    console.error(`  Looked for: ${anchor.slice(0, 90)}...`)
    console.error(`  Run with --debug to dump the relevant region of the file for comparison.`)
    if (process.argv.includes('--debug')) {
      const firstLine = anchor.split('\n')[0]
      const idx = content.indexOf(firstLine)
      if (idx !== -1) {
        console.error('  --- nearby content in your file ---')
        console.error(content.slice(idx, idx + anchor.length + 200))
        console.error('  ------------------------------------')
      } else {
        console.error(`  Could not even find the first line of the anchor: "${firstLine}"`)
      }
    }
    process.exit(1)
  }
}

// ============================================================
// 1) WORKER — POST /api/sales/purge-all
// ============================================================
console.log('\n[1/3] Backend route: worker/src/index.ts')
{
  let content = readFile(WORKER_FILE)
  const marker = "app.post('/api/sales/purge-all'"

  if (content.includes(marker)) {
    console.log('  · purge-all route: already applied, skipping')
  } else {
    const anchor = `// POST /api/sales/:id/reprint`
    requireAnchor(content, anchor, 'worker/src/index.ts')

    const route = `// POST /api/sales/purge-all — HARD delete ALL sales data (admin only)
// Wipes sales, sale_items, sale_item_addons, sale_payments, cash_drops,
// and shifts. Resets receipt_counters so numbering restarts cleanly.
// This is IRREVERSIBLE — the caller is expected to have already backed
// up their own data (e.g. via /api/reports/sales-detailed export).
// One audit_log row is written BEFORE the delete, recording who did
// it, their reason, and the row counts removed — this is the only
// record of the wipe left behind afterward.
app.post('/api/sales/purge-all', async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin') return jsonErr('Admin only', 403)
  const db = c.get('db')
  const d1 = c.env.DB
  const body = await c.req.json<{ reason: string }>().catch(() => ({ reason: '' }))
  if (!body.reason) return jsonErr('Reason required')

  const salesRow = await d1.prepare('SELECT COUNT(*) AS n FROM sales').first<{ n: number }>()
  const shiftsRow = await d1.prepare('SELECT COUNT(*) AS n FROM shifts').first<{ n: number }>()
  const salesCount = salesRow?.n ?? 0
  const shiftsCount = shiftsRow?.n ?? 0

  // Log first: once the delete runs there's nothing left to reference.
  await createAuditLog(db, actor.id, 'purge_all_sales', 'sale', null, null, {
    sales_deleted: salesCount,
    shifts_deleted: shiftsCount,
  }, body.reason)

  await d1.batch([
    d1.prepare('DELETE FROM sale_item_addons'),
    d1.prepare('DELETE FROM sale_items'),
    d1.prepare('DELETE FROM sale_payments'),
    d1.prepare('DELETE FROM sales'),
    d1.prepare('DELETE FROM cash_drops'),
    d1.prepare('DELETE FROM shifts'),
    d1.prepare('DELETE FROM receipt_counters'),
  ])

  return jsonOk({ ok: true, sales_deleted: salesCount, shifts_deleted: shiftsCount })
})

`
    const idx = content.indexOf(anchor)
    content = content.slice(0, idx) + route + content.slice(idx)
    anyChange = true
    console.log('  ✓ purge-all route: applying')
  }

  writeFile(WORKER_FILE, content)
}

// ============================================================
// 2) FRONTEND API — usePurgeAllSales hook
// ============================================================
console.log('\n[2/3] Frontend hook: src/api.ts')
{
  let content = readFile(API_FILE)
  const marker = 'export function usePurgeAllSales'

  if (content.includes(marker)) {
    console.log('  · usePurgeAllSales hook: already applied, skipping')
  } else {
    const anchor = `export function useReprintSale() {`
    requireAnchor(content, anchor, 'src/api.ts')

    const hook = `export function usePurgeAllSales() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { reason: string }) =>
      api.post<{ ok: boolean; sales_deleted: number; shifts_deleted: number }>('/sales/purge-all', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] })
      qc.invalidateQueries({ queryKey: ['shifts'] })
    },
  })
}

`
    const idx = content.indexOf(anchor)
    content = content.slice(0, idx) + hook + content.slice(idx)
    anyChange = true
    console.log('  ✓ usePurgeAllSales hook: applying')
  }

  writeFile(API_FILE, content)
}

// ============================================================
// 3) FRONTEND UI — Danger Zone card in Admin Settings page
// ============================================================
console.log('\n[3/3] Frontend UI: src/App.tsx')
{
  let content = readFile(APP_FILE)

  // 3a. Import usePurgeAllSales alongside the other hooks used in App.tsx
  if (content.includes('usePurgeAllSales')) {
    console.log('  · usePurgeAllSales import: already applied, skipping')
  } else {
    const importAnchor = `useReprintSale, useSalesReport, useSettings, useUpdateSettings,`
    requireAnchor(content, importAnchor, 'src/App.tsx (import list)')
    content = content.replace(
      importAnchor,
      `useReprintSale, useSalesReport, useSettings, useUpdateSettings, usePurgeAllSales,`
    )
    anyChange = true
    console.log('  ✓ usePurgeAllSales import: applying')
  }

  // 3b. Danger Zone UI block inside AdminSettingsPage: state + handlers.
  const stateMarker = 'const purgeAllSales = usePurgeAllSales();'
  if (content.includes(stateMarker)) {
    console.log('  · AdminSettingsPage purge state/handlers: already applied, skipping')
  } else {
    const stateAnchor = `const [printerLoading, setPrinterLoading] = useState(false);`
    requireAnchor(content, stateAnchor, 'src/App.tsx (AdminSettingsPage state)')

    const stateBlock = `${stateAnchor}
  const purgeAllSales = usePurgeAllSales();
  const [purgeModal, setPurgeModal] = useState(false);
  const [purgeReason, setPurgeReason] = useState('');
  const [purgeConfirmText, setPurgeConfirmText] = useState('');
  const [showAnyPinForPurge, setShowAnyPinForPurge] = useState(false);

  const handlePurgeConfirm = useCallback(() => {
    if (!purgeReason || purgeConfirmText !== 'DELETE ALL') return;
    setPurgeModal(false);
    setShowAnyPinForPurge(true);
  }, [purgeReason, purgeConfirmText]);

  const doPurge = useCallback(async () => {
    setShowAnyPinForPurge(false);
    try {
      const res = await purgeAllSales.mutateAsync({ reason: purgeReason });
      toast(\`Deleted \${res.sales_deleted} sale(s) and \${res.shifts_deleted} shift(s)\`);
      setPurgeReason('');
      setPurgeConfirmText('');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Failed to delete sales data', 'error');
    }
  }, [purgeAllSales, purgeReason]);`

    content = content.replace(stateAnchor, stateBlock)
    anyChange = true
    console.log('  ✓ AdminSettingsPage purge state/handlers: applying')
  }

  // 3c. Danger Zone card + modals, inserted right after the Bluetooth
  //     Printer card closes, replacing the AdminSettingsPage's closing
  //     structure (which is unique in the file).
  const uiMarker = 'Delete All Sales Data'
  if (content.includes(uiMarker)) {
    console.log('  · Danger Zone card + modals: already applied, skipping')
  } else {
    const closeAnchor = `              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Admin Audit Log Page ─────────────────────────────────────`
    requireAnchor(content, closeAnchor, 'src/App.tsx (AdminSettingsPage closing structure)')

    const dangerZoneAndModals = `              </div>
            </div>

            <div className="mt-5 bg-white border border-red-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-red-100 flex items-center gap-2 bg-red-50">
                <AlertTriangle size={14} className="text-red-600" />
                <span className="text-xs font-700 text-red-700 uppercase tracking-wide" style={{ fontWeight: 700 }}>
                  Danger Zone
                </span>
              </div>
              <div className="px-5 py-4">
                <p className="text-xs text-gray-500 mb-3">
                  Permanently deletes ALL sales, sale line items, payments, cash drops, and shifts
                  from the database. This cannot be undone — back up your data first (Reports export)
                  before continuing.
                </p>
                <Btn variant="danger" fullWidth onClick={() => setPurgeModal(true)}>
                  <Trash2 size={14} /> Delete All Sales Data
                </Btn>
              </div>
            </div>
          </div>
        )}
      </div>

      <Modal open={purgeModal} onClose={() => setPurgeModal(false)} title="⚠️ Delete All Sales Data">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-600">
            This permanently deletes every sale, sale item, payment, cash drop, and shift record.
            Menu, users, inventory, and settings are not affected. Make sure you have already
            backed up your sales data before continuing — this cannot be undone.
          </p>
          <Input label="Reason" value={purgeReason} onChange={setPurgeReason} autoFocus />
          <Input
            label="Type DELETE ALL to confirm"
            value={purgeConfirmText}
            onChange={setPurgeConfirmText}
            placeholder="DELETE ALL"
          />
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={() => setPurgeModal(false)} className="flex-1">Cancel</Btn>
            <Btn
              variant="danger"
              onClick={handlePurgeConfirm}
              disabled={!purgeReason || purgeConfirmText !== 'DELETE ALL'}
              className="flex-1"
            >
              Continue
            </Btn>
          </div>
        </div>
      </Modal>

      <AnyUserPinModal
        open={showAnyPinForPurge}
        onClose={() => setShowAnyPinForPurge(false)}
        onSuccess={doPurge}
        title="🔒 Authorize Deletion"
        description="Enter your PIN to permanently delete all sales data."
        required_role="admin"
      />
    </div>
  );
}

// ─── Admin Audit Log Page ─────────────────────────────────────`

    content = content.replace(closeAnchor, dangerZoneAndModals)
    anyChange = true
    console.log('  ✓ Danger Zone card + modals: applying')
  }

  writeFile(APP_FILE, content)
}

console.log('')
if (!anyChange) {
  console.log('Nothing to do — all changes already applied.')
} else if (DRY_RUN) {
  console.log('Dry run complete — no files were modified.')
} else {
  console.log('Done. Next steps:')
  console.log('  1. Review the diff (git diff).')
  console.log('  2. Deploy the worker (cd worker && npx wrangler deploy).')
  console.log('  3. Rebuild/redeploy the frontend as usual.')
  console.log('  (No DB migration needed — no schema changes, only DELETEs.)')
}
