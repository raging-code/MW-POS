#!/usr/bin/env node
// Patch: add category-scoped addon support to src/types.ts
// (This is the file that failed to apply in the previous patch run —
//  root cause: your local checkout uses CRLF line endings (Windows +
//  core.autocrlf), but the previous script's anchors were written
//  against LF text, so the exact-string match never found them.
//  This script normalizes line endings before matching, then restores
//  your original line-ending style on write.)

import fs from 'fs';
import path from 'path';

const root = process.cwd();
const file = path.join(root, 'src', 'types.ts');

console.log(`MW-POS types.ts patch — target: ${file}\n`);

if (!fs.existsSync(file)) {
  console.error(`[FAIL] Could not find ${file}. Run this from your MW-POS repo root.`);
  process.exit(1);
}

const raw = fs.readFileSync(file, 'utf8');
const usesCRLF = raw.includes('\r\n');
const src = raw.replace(/\r\n/g, '\n'); // normalize to LF for matching

let out = src;
let applied = 0;
let failed = 0;

function patch(label, find, replace) {
  if (out.includes(replace)) {
    console.log(`  [SKIP]  ${label} — already applied`);
    applied++; // treat as already-done, not a failure
    return;
  }
  if (!out.includes(find)) {
    console.log(`  [FAIL]  ${label} — anchor text not found`);
    failed++;
    return;
  }
  out = out.replace(find, replace);
  console.log(`  [OK]    ${label}`);
  applied++;
}

// 1. Addon: add category_id
patch(
  'Addon: add category_id',
  `export interface Addon {\n  id: string;\n  name: string;\n  price: number;\n  is_available: boolean;\n}`,
  `export interface Addon {\n  id: string;\n  name: string;\n  price: number;\n  is_available: boolean;\n  category_id: string | null;\n}`
);

// 2. MenuItem: update stale comment on addons field
patch(
  'MenuItem: update stale comment on addons field',
  `  addons: Addon[];          // still returned by API but not used in creation/editing`,
  `  addons: Addon[];          // addon_ids in creation/editing; full objects on read`
);

// 3. Category: add addons field
patch(
  'Category: add addons field',
  `export interface Category {\n  id: string;\n  name: string;\n  sort_order: number;\n  items: MenuItem[];\n}`,
  `export interface Category {\n  id: string;\n  name: string;\n  sort_order: number;\n  items: MenuItem[];\n  addons: Addon[];\n}`
);

if (applied > 0 && out !== src) {
  const backup = file + '.bak';
  fs.writeFileSync(backup, raw);
  const finalOut = usesCRLF ? out.replace(/\n/g, '\r\n') : out;
  fs.writeFileSync(file, finalOut);
  console.log(`\nBacked up original to ${path.relative(root, backup)}`);
}

console.log(`\nDone. Applied ${applied}, failed ${failed}.`);
if (failed > 0) {
  console.log('Some anchors were not found — paste me the current src/types.ts and I will adjust.');
  process.exit(1);
}
