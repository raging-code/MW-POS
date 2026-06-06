#!/usr/bin/env node
/**
 * MW-POS Diagnostic — run from repo root: node mwpos-diagnose.mjs
 * Prints the exact text around each patch target so the patch can be regenerated.
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();

function read(rel) {
  try {
    const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    return raw.replace(/\r\n/g, '\n');
  } catch (e) {
    return null;
  }
}

function show(label, filePath, searchHint, contextLines = 6) {
  const content = read(filePath);
  if (!content) { console.log(`\n[${label}] ❌ Could not read: ${filePath}`); return; }
  const lines = content.split('\n');
  const idx = lines.findIndex(l => l.includes(searchHint));
  if (idx === -1) { console.log(`\n[${label}] ❌ Hint not found in ${filePath}: "${searchHint}"`); return; }
  const start = Math.max(0, idx - 2);
  const end   = Math.min(lines.length - 1, idx + contextLines);
  console.log(`\n[${label}] ${filePath} (lines ${start+1}–${end+1})`);
  console.log('─'.repeat(70));
  lines.slice(start, end + 1).forEach((l, i) => {
    console.log(`${String(start + i + 1).padStart(4)}: ${JSON.stringify(l)}`);
  });
}

// Bug 1
show('Bug1', 'src/types.ts', 'SaleStatus');

// Bug 2
show('Bug2', 'worker/src/index.ts', 'Idempotency: return existing sale', 10);

// Bug 3
show('Bug3', 'worker/src/index.ts', 'orderBy(desc(sales.created_at))');

// Bug 4
show('Bug4', 'worker/src/index.ts', "app.delete('/api/menu/categories/:id'", 12);

// Bug 5a
show('Bug5a', 'worker/src/index.ts', 'already reprinted');

// Bug 5b
show('Bug5b', 'src/App.tsx', 'statusColor = useCallback');

// Bug 5c
show('Bug5c', 'src/App.tsx', 'statusColor(sale.status)');

console.log('\n─── Done. Paste this output back. ───\n');
