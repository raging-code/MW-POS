#!/usr/bin/env node
// MW-POS patch: fix misplaced brace from add-cash-in.mjs
//
// The original add-cash-in.mjs inserted useCashIn() one line too early in
// src/api.ts — before useCashDrop()'s closing brace — so useCashIn ended up
// nested inside useCashDrop() instead of being its own top-level export,
// plus it left a stray orphaned "}" after useCashIn's own closing brace.
//
// This resulted in the build failing with:
//   src/App.tsx(25,45): error TS2305: Module './api' has no exported member 'useCashIn'.
//   src/api.ts(290,1): error TS1184: Modifiers cannot appear here.
//
// This script fixes src/api.ts so useCashDrop() and useCashIn() are both
// proper, separate, top-level exported functions.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const log = {
  info: (m) => console.log(`\x1b[36mℹ\x1b[0m ${m}`),
  ok: (m) => console.log(`\x1b[32m✔\x1b[0m ${m}`),
  warn: (m) => console.log(`\x1b[33m⚠\x1b[0m ${m}`),
  err: (m) => console.log(`\x1b[31m✘\x1b[0m ${m}`),
};

function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, '.git')) && fs.existsSync(path.join(dir, 'src', 'api.ts'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

console.log('MW-POS patch: fix useCashIn brace bug in src/api.ts\n');

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = findRepoRoot(process.cwd().length > scriptDir.length ? process.cwd() : scriptDir);
log.info(`Repo root: ${repoRoot}`);

const targetPath = path.join(repoRoot, 'src', 'api.ts');
if (!fs.existsSync(targetPath)) {
  log.err(`Could not find src/api.ts under ${repoRoot}`);
  log.err('Run this script from inside (or above) your MW-POS checkout.');
  process.exit(1);
}

console.log('\n=== src/api.ts ===\n');

let content = fs.readFileSync(targetPath, 'utf8');
const original = content;

// The known-broken shape: useCashDrop's closing `})` is immediately
// followed by a blank line and `export function useCashIn`, with no closing
// `}` for useCashDrop — and useCashIn's own body ends with an extra stray
// `}` after its correct closing brace.
const brokenPattern =
  /(export function useCashDrop\(\) \{[\s\S]*?onSuccess: \(\) => qc\.invalidateQueries\(\{ queryKey: \['shift-current'\] \}\),\n {2}\}\))\n\nexport function useCashIn\(\) \{([\s\S]*?onSuccess: \(\) => qc\.invalidateQueries\(\{ queryKey: \['shift-current'\] \}\),\n {2}\}\)\n\})\n\}/;

const match = content.match(brokenPattern);

if (match) {
  const fixed = `${match[1]}\n}\n\nexport function useCashIn() {${match[2]}`;
  content = content.replace(brokenPattern, fixed);

  if (content === original) {
    log.warn('Pattern matched but replacement produced no change — inspect manually.');
    process.exit(1);
  }

  const backupPath = `${targetPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.writeFileSync(backupPath, original, 'utf8');
  fs.writeFileSync(targetPath, content, 'utf8');

  console.log('-- useCashDrop() — add missing closing brace');
  console.log('-- useCashIn() — promote to top-level export (was nested inside useCashDrop)');
  console.log('-- remove orphaned stray "}" left after useCashIn()');
  log.ok(`Wrote src${path.sep}api.ts (backup: ${path.relative(repoRoot, backupPath)})`);
} else if (/export function useCashDrop\(\) \{[\s\S]*?\n {2}\}\)\n\}[\s\S]*?export function useCashIn\(\) \{[\s\S]*?\n {2}\}\)\n\}(?!\n\})/.test(content)) {
  log.ok('src/api.ts already has useCashDrop() and useCashIn() as separate top-level exports.');
  log.info('Nothing to do — patch was already applied (or the bug was already fixed).');
  process.exit(0);
} else {
  log.err('Could not find the expected broken pattern in src/api.ts.');
  log.err('The file may have been edited since the bug was introduced, or the bug looks different than expected.');
  log.info('No changes made. Please check src/api.ts manually around useCashDrop/useCashIn.');
  process.exit(1);
}

console.log('\n✔ Patch completed successfully.');
log.info('Next steps:');
log.info('  1. npx tsc --noEmit -p tsconfig.app.json   # confirm no TS2305 / TS1184 errors remain');
log.info('  2. npm run build');
