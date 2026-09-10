#!/usr/bin/env node
/**
 * MW-POS patch: fix add-on qty double-counting bug
 *
 * Bug: when both item qty > 1 AND addon qty > 1, the addon subtotal gets
 * multiplied by item qty a second time (it's folded into a per-unit price
 * that then gets multiplied by qty again).
 *
 * Fix: (base_price + addons_total) * qty  -->  (base_price * qty) + addons_total
 *
 * This version matches line-by-line with whitespace/line-ending tolerance
 * (handles CRLF, trailing spaces, minor reformatting) instead of relying on
 * brittle exact multi-line block strings.
 *
 * Usage:
 *   node fix-addon-qty-double-count.mjs --dry-run   # preview only
 *   node fix-addon-qty-double-count.mjs             # apply
 *   node fix-addon-qty-double-count.mjs --debug     # verbose diagnostics on failure
 *
 * Safe to run twice: detects the already-fixed form and skips.
 */

import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const DEBUG = args.includes('--debug');

const REPO_ROOT = process.cwd();

function log(msg) { console.log(msg); }
function ok(msg) { console.log('\x1b[32m✔\x1b[0m ' + msg); }
function warn(msg) { console.log('\x1b[33m⚠\x1b[0m ' + msg); }
function err(msg) { console.log('\x1b[31m✖\x1b[0m ' + msg); }
function info(msg) { console.log('\x1b[36mℹ\x1b[0m ' + msg); }

/**
 * Detects the dominant line ending used in a string.
 */
function detectEOL(text) {
  const crlfCount = (text.match(/\r\n/g) || []).length;
  const lfOnlyCount = (text.match(/(?<!\r)\n/g) || []).length;
  return crlfCount > lfOnlyCount ? '\r\n' : '\n';
}

/**
 * Splits text into lines, stripping any trailing \r so each line is
 * comparable regardless of original EOL style. Returns { lines, eol }.
 */
function splitLines(text) {
  const eol = detectEOL(text);
  const lines = text.split(/\r\n|\n/);
  return { lines, eol };
}

/**
 * Normalizes a line for matching: trims trailing whitespace/\r, collapses
 * internal runs of whitespace to single spaces (so minor reformatting
 * doesn't break the match), but keeps it otherwise intact.
 */
function normalizeForMatch(line) {
  return line.replace(/\r$/, '').replace(/[ \t]+/g, ' ').trim();
}

/**
 * Finds the index of the first line whose normalized form contains
 * normalizedNeedle as a substring. Returns -1 if not found.
 */
function findLineIndex(lines, needleSubstr, startAt = 0) {
  const needle = normalizeForMatch(needleSubstr);
  for (let i = startAt; i < lines.length; i++) {
    if (normalizeForMatch(lines[i]).includes(needle)) return i;
  }
  return -1;
}

/**
 * Replaces a substring within one line, preserving that line's original
 * leading whitespace and any trailing \r.
 */
function replaceInLine(line, fromSubstr, toSubstr) {
  // Match ignoring internal whitespace differences by using a whitespace-
  // tolerant regex built from fromSubstr.
  const escaped = fromSubstr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const flexible = escaped.replace(/\s+/g, '\\s+');
  const re = new RegExp(flexible);
  if (!re.test(line)) return null;
  return line.replace(re, toSubstr);
}

function backupFile(filePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.bak-${stamp}`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

/**
 * Runs one patch operation against a file.
 * spec: {
 *   filePath, label,
 *   alreadyFixedMarker,   // substring indicating fix already applied
 *   findMarker,           // substring used to locate the target line
 *   fromSubstr, toSubstr, // exact substring replace within that line
 * }
 */
function applyPatch(spec) {
  log('');
  log(`== ${spec.label} ==`);

  if (!fs.existsSync(spec.filePath)) {
    err(`File not found: ${spec.filePath}`);
    return false;
  }

  const original = fs.readFileSync(spec.filePath, 'utf8');
  const { lines, eol } = splitLines(original);

  // Check idempotency first.
  const alreadyIdx = findLineIndex(lines, spec.alreadyFixedMarker);
  if (alreadyIdx !== -1) {
    ok(`Already patched (line ${alreadyIdx + 1}) — skipping.`);
    return true;
  }

  const targetIdx = findLineIndex(lines, spec.findMarker);
  if (targetIdx === -1) {
    err(`Could not find expected code for "${spec.label}".`);
    err(`  This usually means the file has changed since this patch was written,`);
    err(`  or has already been modified in a way this script doesn't recognize.`);
    err(`  No changes were made. Please check the file manually.`);
    if (DEBUG) {
      info(`Searched for (normalized): "${normalizeForMatch(spec.findMarker)}"`);
      info(`Nearby content search failed entirely — dumping first 5 non-empty lines containing "addon" or "itemBase" or "perUnit":`);
      lines.forEach((l, i) => {
        if (/addon|itemBase|perUnit|total_before_discount/i.test(l)) {
          info(`  ${i + 1}: ${l}`);
        }
      });
    }
    return false;
  }

  const newLine = replaceInLine(lines[targetIdx], spec.fromSubstr, spec.toSubstr);
  if (newLine === null) {
    err(`Found the target line but could not apply substring replacement on line ${targetIdx + 1}.`);
    if (DEBUG) info(`Line content: ${JSON.stringify(lines[targetIdx])}`);
    return false;
  }

  log(`  Line ${targetIdx + 1}:`);
  log(`  \x1b[31m- ${lines[targetIdx].replace(/\r$/, '')}\x1b[0m`);
  log(`  \x1b[32m+ ${newLine.replace(/\r$/, '')}\x1b[0m`);

  if (DRY_RUN) {
    warn(`Dry run — no changes written.`);
    return true;
  }

  const patchedLines = lines.slice();
  patchedLines[targetIdx] = newLine;
  const newContent = patchedLines.join(eol);

  const backupPath = backupFile(spec.filePath);
  fs.writeFileSync(spec.filePath, newContent, 'utf8');
  ok(`Patched. Backup saved to ${path.relative(REPO_ROOT, backupPath)}`);
  return true;
}

log('MW-POS patch: fix add-on qty double-counting bug');
info(`Repo root: ${REPO_ROOT}`);
if (DRY_RUN) warn('Running in --dry-run mode: no files will be modified.');

const patches = [
  {
    filePath: path.join(REPO_ROOT, 'src', 'store.ts'),
    label: 'src/store.ts — computeItemTotals() line-total formula',
    alreadyFixedMarker: '(item.base_price * item.qty) + addons_total',
    findMarker: 'const total_before_discount = perUnit * item.qty;',
    fromSubstr: 'const total_before_discount = perUnit * item.qty;',
    toSubstr: 'const total_before_discount = (item.base_price * item.qty) + addons_total;',
  },
  {
    filePath: path.join(REPO_ROOT, 'worker', 'src', 'index.ts'),
    label: 'worker/src/index.ts — itemBase calculation (checkout handler)',
    alreadyFixedMarker: '(item.base_price * item.qty) + addonsTotal',
    findMarker: 'const itemBase = (item.base_price + addonsTotal) * item.qty',
    fromSubstr: 'const itemBase = (item.base_price + addonsTotal) * item.qty',
    toSubstr: 'const itemBase = (item.base_price * item.qty) + addonsTotal',
  },
  {
    filePath: path.join(REPO_ROOT, 'worker', 'src', 'index.ts'),
    label: 'worker/src/index.ts — addons_total stored to DB (checkout handler)',
    alreadyFixedMarker: 'addons_total:    addonsTotal,',
    findMarker: 'addons_total: addonsTotal * item.qty,',
    fromSubstr: 'addons_total: addonsTotal * item.qty,',
    toSubstr: 'addons_total:    addonsTotal,',
  },
];

let allOk = true;
for (const spec of patches) {
  const result = applyPatch(spec);
  allOk = allOk && result;
}

log('');
if (allOk) {
  if (DRY_RUN) {
    ok('Dry run completed successfully — re-run without --dry-run to apply.');
  } else {
    ok('Patch completed successfully.');
    info('Next steps: npm run build   &&   cd worker && npx wrangler deploy');
  }
  process.exit(0);
} else {
  err('Patch completed with errors — see above. No partial changes were left in place for failed files.');
  process.exit(1);
}
