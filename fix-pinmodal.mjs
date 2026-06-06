// fix-pinmodal.mjs
// Fixes TS2448/TS2454: moves doSubmit + press ABOVE the useEffect that
// references `press` in its deps array inside PinModal.
//
// Usage:  node fix-pinmodal.mjs
// Then:   npm run build

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'fs';
import { join } from 'path';

const TARGET = join(process.cwd(), 'src', 'App.tsx');

if (!existsSync(TARGET)) {
  console.error('[error] src/App.tsx not found. Run from your project root.');
  process.exit(1);
}

// Backup
const BACKUP = TARGET + '.pinfix-backup';
if (!existsSync(BACKUP)) {
  copyFileSync(TARGET, BACKUP);
  console.log('[  ok ] Backed up → src/App.tsx.pinfix-backup');
} else {
  console.log('[ info ] Backup already exists, skipping.');
}

const lines = readFileSync(TARGET, 'utf8').split('\n');

// ── Already fixed? ────────────────────────────────────────────────────────────
if (lines.some(l => l.includes('// FIX: doSubmit and press declared BEFORE'))) {
  console.log('[ info ] Fix already applied — nothing to do.');
  console.log('[  ok ] Run: npm run build');
  process.exit(0);
}

// ── Locate blocks using their UNIQUE closing dep lines ────────────────────────
// These three lines each appear exactly once in the file.

// 1. useEffect end: }, [pinModal.open, press, resolvePinModal]);
const effectEndIdx = lines.findIndex(l =>
  l.includes('[pinModal.open, press, resolvePinModal]'));

// 2. doSubmit end: }, [user, verifyPin, pinModal.required_role, resolvePinModal]);
const doSubmitEndIdx = lines.findIndex(l =>
  l.includes('[user, verifyPin, pinModal.required_role, resolvePinModal]'));

// 3. press end (the one AFTER effectEndIdx): }, [locked, pin, doSubmit]);
const pressEndIdx = lines.findIndex(l =>
  l.includes('[locked, pin, doSubmit]') && lines.indexOf(l) > effectEndIdx);

if (effectEndIdx === -1 || doSubmitEndIdx === -1 || pressEndIdx === -1) {
  console.error('[error] Could not locate one or more blocks.');
  console.error(`  effectEnd:   line ${effectEndIdx + 1}`);
  console.error(`  doSubmitEnd: line ${doSubmitEndIdx + 1}`);
  console.error(`  pressEnd:    line ${pressEndIdx + 1}`);
  process.exit(1);
}

// Walk BACKWARD from each end to find block starts
function findBlockStart(endIdx, startMarker) {
  let i = endIdx;
  while (i > 0 && !lines[i].trim().startsWith(startMarker)) i--;
  return i;
}

const effectStartIdx  = findBlockStart(effectEndIdx,  'useEffect(');
const doSubmitStartIdx = findBlockStart(doSubmitEndIdx, 'const doSubmit');
const pressStartIdx   = findBlockStart(pressEndIdx,   'const press');

console.log(`[ info ] useEffect block:  lines ${effectStartIdx+1}–${effectEndIdx+1}`);
console.log(`[ info ] doSubmit block:   lines ${doSubmitStartIdx+1}–${doSubmitEndIdx+1}`);
console.log(`[ info ] press block:      lines ${pressStartIdx+1}–${pressEndIdx+1}`);

// Sanity: the order in the file must be effect → doSubmit → press
if (!(effectStartIdx < doSubmitStartIdx && doSubmitStartIdx < pressStartIdx)) {
  console.error('[error] Unexpected block order in file — fix may already be applied?');
  process.exit(1);
}

// Extract the three blocks
const effectBlock   = lines.slice(effectStartIdx,   effectEndIdx + 1);
const doSubmitBlock = lines.slice(doSubmitStartIdx, doSubmitEndIdx + 1);
const pressBlock    = lines.slice(pressStartIdx,    pressEndIdx + 1);

// Build the output: everything before effectStart, then the fixed order,
// then everything after pressEnd.
const before  = lines.slice(0, effectStartIdx);
const after   = lines.slice(pressEndIdx + 1);

const fixedBlock = [
  '  // FIX: doSubmit and press declared BEFORE the useEffect that references',
  '  // `press` in its deps array — required by TypeScript (TS2448/TS2454).',
  ...doSubmitBlock,
  ...pressBlock,
  ...effectBlock,
];

const output = [...before, ...fixedBlock, ...after];
writeFileSync(TARGET, output.join('\n'), 'utf8');

console.log('[  ok ] src/App.tsx patched successfully.');
console.log('');
console.log('Now run:  npm run build');
