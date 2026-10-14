#!/usr/bin/env node
/**
 * mw-pos-sales-by-item-fixes-2.mjs
 *
 * Fixes the "Sales by item" report showing STALE numbers.
 *
 * Problem
 * -------
 * The app caches every report for 5 minutes (staleTime in src/main.tsx).
 * When a sale is rung up, voided, refunded, edited, deleted or purged, the
 * app refreshes the Dashboard and Detailed Report, but NEVER the Sales by item
 * report. So after ringing up or cancelling sales, Sales by item can keep
 * showing the old counts for up to 5 minutes, and disagree with the Receipts tab.
 *
 * Fix (src/api.ts only)
 *   1. Every mutation that already refreshes 'report-sales-detailed'
 *      (checkout, void, refund, soft delete, purge all, edit sale) now also
 *      refreshes 'report-sales-by-item'.
 *   2. useSalesByItemReport uses staleTime: 0, so opening the report always
 *      fetches fresh numbers instead of reusing a cached copy.
 *
 * Usage
 * -----
 *   node mw-pos-sales-by-item-fixes-2.mjs <repo-root> [--dry-run]
 *
 *   - Idempotent: re-running skips what is already applied.
 *   - Aborts BEFORE writing anything if an expected anchor is not found.
 *   - Handles Windows (CRLF) and Linux (LF) line endings.
 *   - Writes a .bak copy the first time it changes the file.
 *
 * After running:  npm run build   (then push / redeploy the frontend,
 *                                  and rebuild the APK if you use the app)
 * No backend deploy is needed for this one.
 */

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const root = path.resolve(args.find(a => !a.startsWith('--')) ?? '.')
const FILE = path.join(root, 'src', 'api.ts')

if (!fs.existsSync(FILE)) {
  console.error(`✖ Cannot find ${FILE}\n  Pass the repo root as the first argument.`)
  process.exit(1)
}

const raw = fs.readFileSync(FILE, 'utf8')
const crlf = raw.includes('\r\n')
let src = raw.replace(/\r\n/g, '\n')
const before = src

const results = []
let failed = false

// ── Edit 1: refresh by-item wherever 'report-sales-detailed' is refreshed ────
{
  const id = 'refresh-by-item-after-sale-changes'
  const marker = "qc.invalidateQueries({ queryKey: ['report-sales-by-item'] })"
  const re = /^([ \t]*)qc\.invalidateQueries\(\{ queryKey: \['report-sales-detailed'\] \}\)[ \t]*$/gm
  const hits = (src.match(re) ?? []).length
  const done = src.split(marker).length - 1
  if (done >= hits && done > 0) {
    results.push({ id, status: 'skip' })
  } else if (hits === 0) {
    results.push({ id, status: 'fail', note: "no invalidateQueries(['report-sales-detailed']) lines found" })
    failed = true
  } else {
    src = src.replace(
      re,
      (m, indent) => `${m}\n${indent}${marker}`
    )
    results.push({ id, status: 'apply', note: `${hits} mutations` })
  }
}

// ── Edit 2: never serve a cached copy when the report is opened ──────────────
{
  const id = 'by-item-staleTime-0'
  const marker = '[fix-sbi2]'
  const find =
    "    queryFn: ({ signal }) => api.get<SalesByItemReport>(`/reports/sales-by-item?${qs}`, signal),\n" +
    '    placeholderData: keepPreviousData,\n'
  const replace = find + '    staleTime: 0, // [fix-sbi2] always refetch when the report is opened\n'
  if (src.includes(marker)) {
    results.push({ id, status: 'skip' })
  } else if (src.split(find).length - 1 !== 1) {
    results.push({ id, status: 'fail', note: `anchor found ${src.split(find).length - 1}x (expected 1)` })
    failed = true
  } else {
    src = src.replace(find, () => replace)
    results.push({ id, status: 'apply' })
  }
}

for (const r of results) {
  const icon = r.status === 'apply' ? '✔ apply' : r.status === 'skip' ? '• skip (already applied)' : '✖ FAILED'
  console.log(`${icon.padEnd(26)} ${r.id}${r.note ? '  (' + r.note + ')' : ''}`)
}

if (failed) {
  console.error('\nAborted: nothing was written. src/api.ts differs from what this script expects.')
  process.exit(1)
}
if (src === before) {
  console.log('\nNothing to do - already applied.')
  process.exit(0)
}
if (DRY) {
  console.log('\nDry run: would modify src/api.ts. Nothing written.')
  process.exit(0)
}

const bak = FILE + '.bak'
if (!fs.existsSync(bak)) fs.writeFileSync(bak, raw)
fs.writeFileSync(FILE, crlf ? src.replace(/\n/g, '\r\n') : src)
console.log('\nwrote src/api.ts  (backup: api.ts.bak)')
console.log('\nNext:  npm run build   then push / redeploy (rebuild the APK if you use the app).')
