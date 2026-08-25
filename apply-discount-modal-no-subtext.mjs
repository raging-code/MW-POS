#!/usr/bin/env node
// apply-discount-modal-no-subtext.mjs
//
// Removes the small gray hint line under each option in DiscountPickerModal
// (e.g. "Fixed peso amount off the line", "15% off this line") so the
// modal shows just the discount title/badge, nothing else.
//
// Requires apply-discount-modal-and-loyalty.mjs to have been run first
// (this script's anchors target the DiscountPickerModal that patch
// produced). Safe to run whether or not apply-discount-modal-fix.mjs has
// also been run — this change is independent of where the modal is mounted.
//
// Usage:
//   node apply-discount-modal-no-subtext.mjs            (run from repo root)
//   node apply-discount-modal-no-subtext.mjs --dry-run   (show what would change)
//
// Idempotent: safe to run multiple times.

import fs from 'node:fs'
import path from 'node:path'

const DRY_RUN = process.argv.includes('--dry-run')
const ROOT = process.cwd()
const APP_FILE = path.join(ROOT, 'src', 'App.tsx')

let anyChange = false
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

function applyOnce(content, find, replace, label) {
  const count = content.split(find).length - 1
  if (count === 0) return null
  if (count > 1) {
    throw new Error(`Anchor for "${label}" matched ${count} times — expected exactly 1. Aborting to avoid a bad patch.`)
  }
  return content.replace(find, replace)
}

function patchFile(filePath, edits) {
  let content = readFile(filePath)
  let fileChanged = false

  for (const edit of edits) {
    if (edit.already && content.includes(edit.already)) {
      console.log(`  • ${edit.label}: already applied, skipping`)
      continue
    }
    const next = applyOnce(content, edit.find, edit.replace, edit.label)
    if (next === null) {
      console.log(`  ⚠ ${edit.label}: anchor not found (already applied differently, base patch not run yet, or file has changed) — skipping`)
      continue
    }
    content = next
    fileChanged = true
    anyChange = true
    console.log(`  ✓ ${edit.label}`)
  }

  if (fileChanged) writeFile(filePath, content)
  else console.log(`  (no changes to ${path.relative(ROOT, filePath)})`)
}

console.log('── src/App.tsx ──')
patchFile(APP_FILE, [
  {
    label: `DISCOUNT_OPTIONS: drop the hint field`,
    already: `{ type: Exclude<CartItem['discount_type'], null>; label: string; className: string }[]`,
    find: `const DISCOUNT_OPTIONS: { type: Exclude<CartItem['discount_type'], null>; label: string; hint: string; className: string }[] = [
  { type: 'sc',   label: 'Senior Citizen (SC)', hint: 'Fixed peso amount off the line', className: 'discount-btn-sc' },
  { type: 'pwd',  label: 'PWD',                 hint: 'Fixed peso amount off the line', className: 'discount-btn-pwd' },
  { type: 'p15',  label: '15% Off',             hint: '15% off this line',              className: 'discount-btn-p15' },
  { type: 'p100', label: '100% Off',            hint: 'Comps this line entirely',        className: 'discount-btn-p100' },
  { type: 'p10',  label: '-₱10 Discount',       hint: '₱10 off this line',              className: 'discount-btn-p10' },
];`,
    replace: `const DISCOUNT_OPTIONS: { type: Exclude<CartItem['discount_type'], null>; label: string; className: string }[] = [
  { type: 'sc',   label: 'Senior Citizen (SC)', className: 'discount-btn-sc' },
  { type: 'pwd',  label: 'PWD',                 className: 'discount-btn-pwd' },
  { type: 'p15',  label: '15% Off',             className: 'discount-btn-p15' },
  { type: 'p100', label: '100% Off',            className: 'discount-btn-p100' },
  { type: 'p10',  label: '-₱10 Discount',       className: 'discount-btn-p10' },
];`,
  },
  {
    label: `DiscountPickerModal: remove the hint <div>, keep just the title`,
    already: `<div className={\`discount-btn \${opt.className} \${isActive ? 'active' : ''}\`} style={{ display: 'inline-block' }}>`,
    find: `              <div className="min-w-0">
                <div className={\`discount-btn \${opt.className} \${isActive ? 'active' : ''}\`} style={{ display: 'inline-block', marginBottom: 4 }}>
                  {opt.label}
                </div>
                <div className="text-xs text-gray-400">{opt.hint}</div>
              </div>
              {isActive && <span className="text-emerald-600 font-700 text-xs shrink-0">Applied ✓</span>}`,
    replace: `              <div className="min-w-0">
                <div className={\`discount-btn \${opt.className} \${isActive ? 'active' : ''}\`} style={{ display: 'inline-block' }}>
                  {opt.label}
                </div>
              </div>
              {isActive && <span className="text-emerald-600 font-700 text-xs shrink-0">Applied ✓</span>}`,
  },
])

console.log('\n' + '─'.repeat(60))
if (DRY_RUN) {
  console.log(anyChange ? 'Dry run complete — changes are pending.' : 'Dry run complete — nothing to change.')
} else if (anyChange) {
  console.log('✓ Done. Next: npm run build, then review the diff and commit.')
} else {
  console.log('Nothing changed — everything was already applied (or the base patch hasn\'t been run yet).')
}
