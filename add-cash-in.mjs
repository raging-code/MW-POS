#!/usr/bin/env node
/**
 * MW-POS patch: add "Cash In" to shift management
 *
 * Adds the ability to record cash ADDED to the drawer mid-shift (e.g. change
 * fund top-up, owner injection), as the counterpart to the existing "Cash
 * Drop" (cash removed). Reuses the existing cash_drops table with a new
 * `type` column ('drop' | 'cash_in') rather than creating a parallel table,
 * so all existing audit-log / reporting code that already reads cash_drops
 * keeps working unchanged for old rows (they default to 'drop').
 *
 * Changes:
 *   1. worker/migrations/0007_cash_drop_type.sql
 *        ALTER TABLE cash_drops ADD COLUMN type ... (safe, no rebuild needed
 *        since it's not a CHECK constraint)
 *   2. worker/src/index.ts
 *        - cashDrops schema: add `type` column
 *        - POST /api/shifts/:id/cash-drop: persist type: 'drop'
 *        - NEW POST /api/shifts/:id/cash-in: persist type: 'cash_in'
 *   3. src/types.ts
 *        - CashDrop gets a `type: 'drop' | 'cash_in'` field
 *   4. src/api.ts
 *        - NEW useCashIn() hook, mirrors useCashDrop()
 *   5. src/App.tsx
 *        - import useCashIn
 *        - expectedCash now ADDS cash_in rows and SUBTRACTS drop rows
 *        - new "Cash In" tab (mirrors "Cash Drop" tab)
 *        - overview list shows cash-ins in green with a "+", drops in red
 *          with a "-", instead of only listing drops
 *
 * Usage:
 *   node add-cash-in.mjs --dry-run   # preview only
 *   node add-cash-in.mjs             # apply
 *   node add-cash-in.mjs --debug     # verbose diagnostics on failure
 *
 * Safe to run twice: detects the already-fixed form and skips per-edit.
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

function detectEOL(text) {
  const crlfCount = (text.match(/\r\n/g) || []).length;
  const lfOnlyCount = (text.match(/(?<!\r)\n/g) || []).length;
  return crlfCount > lfOnlyCount ? '\r\n' : '\n';
}

function splitLines(text) {
  const eol = detectEOL(text);
  const lines = text.split(/\r\n|\n/);
  return { lines, eol };
}

function normalizeForMatch(line) {
  return line.replace(/\r$/, '').replace(/[ \t]+/g, ' ').trim();
}

function findLineIndex(lines, needleSubstr, startAt = 0) {
  const needle = normalizeForMatch(needleSubstr);
  for (let i = startAt; i < lines.length; i++) {
    if (normalizeForMatch(lines[i]).includes(needle)) return i;
  }
  return -1;
}

/** Finds the index of a line matching a full-line regex (whitespace-tolerant). */
function findLineIndexRegex(lines, regex, startAt = 0) {
  for (let i = startAt; i < lines.length; i++) {
    if (regex.test(lines[i].replace(/\r$/, ''))) return i;
  }
  return -1;
}

function replaceInLine(line, fromSubstr, toSubstr) {
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
 * Generic "replace one line's substring" patch, with idempotency check.
 */
function applyLinePatch(spec) {
  log('');
  log(`== ${spec.label} ==`);

  if (!fs.existsSync(spec.filePath)) {
    err(`File not found: ${spec.filePath}`);
    return { success: false, changed: false };
  }

  const original = fs.readFileSync(spec.filePath, 'utf8');
  const { lines, eol } = splitLines(original);

  const alreadyIdx = findLineIndex(lines, spec.alreadyFixedMarker);
  if (alreadyIdx !== -1) {
    ok(`Already patched (line ${alreadyIdx + 1}) — skipping.`);
    return { success: true, changed: false };
  }

  const targetIdx = findLineIndex(lines, spec.findMarker);
  if (targetIdx === -1) {
    err(`Could not find expected code for "${spec.label}".`);
    err(`  This usually means the file has changed since this patch was written,`);
    err(`  or has already been modified in a way this script doesn't recognize.`);
    err(`  No changes were made. Please check the file manually.`);
    if (DEBUG) {
      info(`Searched for (normalized): "${normalizeForMatch(spec.findMarker)}"`);
    }
    return { success: false, changed: false };
  }

  const newLine = replaceInLine(lines[targetIdx], spec.fromSubstr, spec.toSubstr);
  if (newLine === null) {
    err(`Found the target line but could not apply substring replacement on line ${targetIdx + 1}.`);
    if (DEBUG) info(`Line content: ${JSON.stringify(lines[targetIdx])}`);
    return { success: false, changed: false };
  }

  log(`  Line ${targetIdx + 1}:`);
  log(`  \x1b[31m- ${lines[targetIdx].replace(/\r$/, '')}\x1b[0m`);
  log(`  \x1b[32m+ ${newLine.replace(/\r$/, '')}\x1b[0m`);

  const patchedLines = lines.slice();
  patchedLines[targetIdx] = newLine;
  return { success: true, changed: true, patchedLines, eol };
}

/**
 * Insert-after patch: finds an anchor line, and if the block to insert isn't
 * already present nearby, inserts new lines right after the anchor.
 */
function applyInsertPatch(spec) {
  log('');
  log(`== ${spec.label} ==`);

  if (!fs.existsSync(spec.filePath)) {
    err(`File not found: ${spec.filePath}`);
    return { success: false, changed: false };
  }

  const original = fs.readFileSync(spec.filePath, 'utf8');
  const { lines, eol } = splitLines(original);

  const alreadyIdx = findLineIndex(lines, spec.alreadyFixedMarker);
  if (alreadyIdx !== -1) {
    ok(`Already patched (line ${alreadyIdx + 1}) — skipping.`);
    return { success: true, changed: false };
  }

  const anchorIdx = findLineIndex(lines, spec.anchorMarker);
  if (anchorIdx === -1) {
    err(`Could not find anchor for "${spec.label}".`);
    err(`  This usually means the file has changed since this patch was written,`);
    err(`  or has already been modified in a way this script doesn't recognize.`);
    err(`  No changes were made. Please check the file manually.`);
    if (DEBUG) info(`Searched for (normalized): "${normalizeForMatch(spec.anchorMarker)}"`);
    return { success: false, changed: false };
  }

  // Determine indentation from the anchor line to keep style consistent.
  const anchorLine = lines[anchorIdx].replace(/\r$/, '');
  const indentMatch = anchorLine.match(/^[ \t]*/);
  const indent = spec.indentOverride !== undefined ? spec.indentOverride : (indentMatch ? indentMatch[0] : '');

  const insertLines = spec.insertLines.map(l => (l.length ? indent + l : l));

  log(`  Inserting ${insertLines.length} line(s) after line ${anchorIdx + 1}:`);
  for (const l of insertLines) log(`  \x1b[32m+ ${l}\x1b[0m`);

  const patchedLines = lines.slice(0, anchorIdx + 1).concat(insertLines, lines.slice(anchorIdx + 1));
  return { success: true, changed: true, patchedLines, eol };
}

/**
 * Applies a sequence of patch operations to a single file transactionally:
 * all ops computed against progressively-updated in-memory lines, and the
 * file is only written once, after every op in the sequence succeeds.
 */
function applyFilePatchSequence(filePath, label, ops) {
  log('');
  log(`=== ${label} ===`);

  if (!fs.existsSync(filePath)) {
    err(`File not found: ${filePath}`);
    return false;
  }

  let text = fs.readFileSync(filePath, 'utf8');
  let { lines, eol } = splitLines(text);
  let anyChanged = false;

  for (const op of ops) {
    const virtualPath = filePath; // for messaging only
    const runner = op.kind === 'insert' ? runInsertOnLines : runLineReplaceOnLines;
    const result = runner(lines, op);
    if (!result.success) {
      err(`Aborting all edits to ${path.relative(REPO_ROOT, filePath)} — no changes written.`);
      return false;
    }
    if (result.changed) {
      lines = result.lines;
      anyChanged = true;
    }
  }

  if (!anyChanged) {
    ok(`All edits to ${path.relative(REPO_ROOT, filePath)} already applied — skipping write.`);
    return true;
  }

  if (DRY_RUN) {
    warn(`Dry run — ${path.relative(REPO_ROOT, filePath)} not written.`);
    return true;
  }

  const backupPath = backupFile(filePath);
  fs.writeFileSync(filePath, lines.join(eol), 'utf8');
  ok(`Wrote ${path.relative(REPO_ROOT, filePath)} (backup: ${path.relative(REPO_ROOT, backupPath)})`);
  return true;
}

function runLineReplaceOnLines(lines, op) {
  log('');
  log(`-- ${op.label}`);
  const alreadyIdx = findLineIndex(lines, op.alreadyFixedMarker);
  if (alreadyIdx !== -1) {
    ok(`Already applied (line ${alreadyIdx + 1}) — skipping.`);
    return { success: true, changed: false, lines };
  }
  const targetIdx = findLineIndex(lines, op.findMarker);
  if (targetIdx === -1) {
    err(`Could not find expected code for "${op.label}".`);
    err(`  No changes were made to this file. Please check it manually.`);
    if (DEBUG) info(`Searched for (normalized): "${normalizeForMatch(op.findMarker)}"`);
    return { success: false, changed: false, lines };
  }
  const newLine = replaceInLine(lines[targetIdx], op.fromSubstr, op.toSubstr);
  if (newLine === null) {
    err(`Found the target line but could not apply substring replacement on line ${targetIdx + 1}.`);
    if (DEBUG) info(`Line content: ${JSON.stringify(lines[targetIdx])}`);
    return { success: false, changed: false, lines };
  }
  log(`  Line ${targetIdx + 1}:`);
  log(`  \x1b[31m- ${lines[targetIdx].replace(/\r$/, '')}\x1b[0m`);
  log(`  \x1b[32m+ ${newLine.replace(/\r$/, '')}\x1b[0m`);
  const next = lines.slice();
  next[targetIdx] = newLine;
  return { success: true, changed: true, lines: next };
}

function runInsertOnLines(lines, op) {
  log('');
  log(`-- ${op.label}`);
  const alreadyIdx = findLineIndex(lines, op.alreadyFixedMarker);
  if (alreadyIdx !== -1) {
    ok(`Already applied (line ${alreadyIdx + 1}) — skipping.`);
    return { success: true, changed: false, lines };
  }
  const anchorIdx = findLineIndex(lines, op.anchorMarker);
  if (anchorIdx === -1) {
    err(`Could not find anchor for "${op.label}".`);
    err(`  No changes were made to this file. Please check it manually.`);
    if (DEBUG) info(`Searched for (normalized): "${normalizeForMatch(op.anchorMarker)}"`);
    return { success: false, changed: false, lines };
  }
  const anchorLine = lines[anchorIdx].replace(/\r$/, '');
  const indentMatch = anchorLine.match(/^[ \t]*/);
  const indent = op.indentOverride !== undefined ? op.indentOverride : (indentMatch ? indentMatch[0] : '');
  const insertLines = op.insertLines.map(l => (l.length ? indent + l : l));
  log(`  Inserting ${insertLines.length} line(s) after line ${anchorIdx + 1}:`);
  for (const l of insertLines) log(`  \x1b[32m+ ${l}\x1b[0m`);
  const next = lines.slice(0, anchorIdx + 1).concat(insertLines, lines.slice(anchorIdx + 1));
  return { success: true, changed: true, lines: next };
}

log('MW-POS patch: add "Cash In" to shift management');
info(`Repo root: ${REPO_ROOT}`);
if (DRY_RUN) warn('Running in --dry-run mode: no files will be modified.');

let allOk = true;

// ------------------------------------------------------------------
// 1. Migration file (new file — created only if missing)
// ------------------------------------------------------------------
{
  log('');
  log('=== worker/migrations/0007_cash_drop_type.sql ===');
  const migPath = path.join(REPO_ROOT, 'worker', 'migrations', '0007_cash_drop_type.sql');
  if (fs.existsSync(migPath)) {
    ok('Migration file already exists — skipping.');
  } else {
    const migSql =
`-- Add a type column to cash_drops so the same table can represent both
-- cash removed from the drawer ('drop', the existing behavior) and cash
-- added to the drawer ('cash_in', e.g. change fund top-ups). Existing rows
-- default to 'drop' so historical data keeps its original meaning.
--
-- This is a plain ADD COLUMN (not a CHECK constraint change), so SQLite
-- allows it without rebuilding the table.

ALTER TABLE cash_drops ADD COLUMN type TEXT NOT NULL DEFAULT 'drop' CHECK(type IN ('drop','cash_in'));
`;
    if (DRY_RUN) {
      warn('Dry run — migration file not written.');
      log('  Would create with contents:');
      migSql.split('\n').forEach(l => log(`  \x1b[32m+ ${l}\x1b[0m`));
    } else {
      fs.mkdirSync(path.dirname(migPath), { recursive: true });
      fs.writeFileSync(migPath, migSql, 'utf8');
      ok(`Created ${path.relative(REPO_ROOT, migPath)}`);
      info(`Remember to apply it: cd worker && npx wrangler d1 migrations apply <DB_NAME> [--remote]`);
    }
  }
}

// ------------------------------------------------------------------
// 2. worker/src/index.ts — schema + endpoints
// ------------------------------------------------------------------
{
  const filePath = path.join(REPO_ROOT, 'worker', 'src', 'index.ts');
  const ops = [
    {
      kind: 'insert',
      label: 'cashDrops schema — add type column',
      alreadyFixedMarker: "type:       text('type', { enum: ['drop', 'cash_in'] }).notNull().default('drop'),",
      anchorMarker: "reason:     text('reason').notNull(),",
      insertLines: [
        "type:       text('type', { enum: ['drop', 'cash_in'] }).notNull().default('drop'),",
      ],
    },
    {
      kind: 'replace',
      label: "cash-drop endpoint — persist type: 'drop'",
      alreadyFixedMarker: "await db.insert(cashDrops).values({ id, shift_id, user_id: actor.id, amount: body.amount, reason: body.reason, created_at: nowISO(), type: 'drop' })",
      findMarker: "await db.insert(cashDrops).values({ id, shift_id, user_id: actor.id, amount: body.amount, reason: body.reason, created_at: nowISO() })",
      fromSubstr: "await db.insert(cashDrops).values({ id, shift_id, user_id: actor.id, amount: body.amount, reason: body.reason, created_at: nowISO() })",
      toSubstr: "await db.insert(cashDrops).values({ id, shift_id, user_id: actor.id, amount: body.amount, reason: body.reason, created_at: nowISO(), type: 'drop' })",
    },
    {
      kind: 'insert',
      label: 'new POST /api/shifts/:id/cash-in endpoint',
      alreadyFixedMarker: "app.post('/api/shifts/:id/cash-in', async (c) => {",
      anchorMarker: "await createAuditLog(db, actor.id, 'cash_drop', 'shift', shift_id, null, { amount: body.amount, reason: body.reason }, body.reason)",
      indentOverride: '',
      insertLines: [
        "  return jsonOk({ id })",
        "})",
        "",
        "app.post('/api/shifts/:id/cash-in', async (c) => {",
        "  const actor = c.get('user')",
        "  const db = c.get('db')",
        "  const shift_id = c.req.param('id')",
        "  const body = await c.req.json<{ amount: number; reason: string }>()",
        "  if (!body.reason) return jsonErr('Reason required')",
        "  if (!body.amount || body.amount <= 0 || !isFinite(body.amount)) return jsonErr('Amount must be a positive number')",
        "  const shiftRec = await db.select({ status: shifts.status }).from(shifts).where(eq(shifts.id, shift_id)).get()",
        "  if (!shiftRec) return jsonErr('Shift not found', 404)",
        "  if (shiftRec.status !== 'open') return jsonErr('Cannot add cash to a closed shift')",
        "  const id = uid()",
        "  await db.insert(cashDrops).values({ id, shift_id, user_id: actor.id, amount: body.amount, reason: body.reason, created_at: nowISO(), type: 'cash_in' })",
        "  await createAuditLog(db, actor.id, 'cash_in', 'shift', shift_id, null, { amount: body.amount, reason: body.reason }, body.reason)",
      ],
    },
  ];

  // The insert for the new endpoint deliberately duplicates the closing
  // `return jsonOk({ id })` / `})` of the existing cash-drop handler as part
  // of its inserted block, then removes the now-duplicate original closer.
  // To keep this simple and safe, we instead anchor differently: insert the
  // whole new route block right after the existing cash-drop route's
  // closing brace, which we locate via its own unique closer line below.
  ops[2] = {
    kind: 'insert',
    label: 'new POST /api/shifts/:id/cash-in endpoint',
    alreadyFixedMarker: "app.post('/api/shifts/:id/cash-in', async (c) => {",
    anchorMarker: "app.post('/api/shifts/:id/cash-drop', async (c) => {",
    indentOverride: '',
    // We can't safely find "the closing brace of this specific route" with
    // a single-line anchor, so instead we anchor on the audit-log call
    // inside cash-drop (unique text) and insert the new route right after
    // the two lines that close out that handler (`return jsonOk` + `})`).
    insertLines: [],
  };

  // Re-derive the correct approach: anchor on the unique audit-log line
  // inside cash-drop, then insert new content 2 lines below it (after
  // `return jsonOk({ id })` and the closing `})`).
  ops[2] = {
    kind: 'insertAfterOffset',
    label: 'new POST /api/shifts/:id/cash-in endpoint',
    alreadyFixedMarker: "app.post('/api/shifts/:id/cash-in', async (c) => {",
    anchorMarker: "await createAuditLog(db, actor.id, 'cash_drop', 'shift', shift_id, null, { amount: body.amount, reason: body.reason }, body.reason)",
    offset: 2, // skip past `return jsonOk({ id })` and the closing `})`
    indentOverride: '',
    insertLines: [
      "",
      "app.post('/api/shifts/:id/cash-in', async (c) => {",
      "  const actor = c.get('user')",
      "  const db = c.get('db')",
      "  const shift_id = c.req.param('id')",
      "  const body = await c.req.json<{ amount: number; reason: string }>()",
      "  if (!body.reason) return jsonErr('Reason required')",
      "  if (!body.amount || body.amount <= 0 || !isFinite(body.amount)) return jsonErr('Amount must be a positive number')",
      "  const shiftRec = await db.select({ status: shifts.status }).from(shifts).where(eq(shifts.id, shift_id)).get()",
      "  if (!shiftRec) return jsonErr('Shift not found', 404)",
      "  if (shiftRec.status !== 'open') return jsonErr('Cannot add cash to a closed shift')",
      "  const id = uid()",
      "  await db.insert(cashDrops).values({ id, shift_id, user_id: actor.id, amount: body.amount, reason: body.reason, created_at: nowISO(), type: 'cash_in' })",
      "  await createAuditLog(db, actor.id, 'cash_in', 'shift', shift_id, null, { amount: body.amount, reason: body.reason }, body.reason)",
      "  return jsonOk({ id })",
      "})",
    ],
  };

  allOk = applyFilePatchSequenceWithOffset(filePath, 'worker/src/index.ts', ops) && allOk;
}

// ------------------------------------------------------------------
// 3. src/types.ts — CashDrop.type field
// ------------------------------------------------------------------
{
  const filePath = path.join(REPO_ROOT, 'src', 'types.ts');
  const ops = [
    {
      kind: 'insert',
      label: 'CashDrop interface — add type field',
      alreadyFixedMarker: "type: 'drop' | 'cash_in';",
      anchorMarker: 'export interface CashDrop {',
      indentOverride: '  ',
      insertLines: ["type: 'drop' | 'cash_in';"],
    },
  ];
  allOk = applyFilePatchSequenceWithOffset(filePath, 'src/types.ts', ops) && allOk;
}

// ------------------------------------------------------------------
// 4. src/api.ts — useCashIn hook
// ------------------------------------------------------------------
{
  const filePath = path.join(REPO_ROOT, 'src', 'api.ts');
  const ops = [
    {
      kind: 'insertAfterOffset',
      label: 'useCashIn() hook (mirrors useCashDrop)',
      alreadyFixedMarker: 'export function useCashIn() {',
      anchorMarker: "mutationFn: ({ shift_id, ...body }: { shift_id: string; amount: number; reason: string }) =>\n      api.post(`/shifts/${shift_id}/cash-drop`, body),",
      offset: 0,
      indentOverride: '',
      insertLines: [], // filled below using single-line anchor variant
    },
  ];
  // api.ts's useCashDrop body spans multiple lines; anchor on its unique
  // closing brace instead, which is simpler to match line-by-line.
  ops[0] = {
    kind: 'insertAfterOffset',
    label: 'useCashIn() hook (mirrors useCashDrop)',
    alreadyFixedMarker: 'export function useCashIn() {',
    anchorMarker: "onSuccess: () => qc.invalidateQueries({ queryKey: ['shift-current'] }),",
    // There are 3 lines matching this exact text (open, close, cash-drop).
    // We need the one inside useCashDrop specifically — use offsetFromEnd
    // search instead: find the LAST occurrence before EOF that is preceded
    // by the cash-drop mutationFn signature. Simpler: anchor directly on
    // the cash-drop endpoint URL, which is unique.
    offset: 0,
    indentOverride: '',
    insertLines: [],
  };
  ops[0] = {
    kind: 'insertAfterOffset',
    label: 'useCashIn() hook (mirrors useCashDrop)',
    alreadyFixedMarker: 'export function useCashIn() {',
    anchorMarker: "api.post(`/shifts/${shift_id}/cash-drop`, body),",
    offset: 2, // skip past the invalidateQueries line and closing `})`
    indentOverride: '',
    insertLines: [
      "",
      "export function useCashIn() {",
      "  const api = useApi()",
      "  const qc = useQueryClient()",
      "  return useMutation({",
      "    mutationFn: ({ shift_id, ...body }: { shift_id: string; amount: number; reason: string }) =>",
      "      api.post(`/shifts/${shift_id}/cash-in`, body),",
      "    onSuccess: () => qc.invalidateQueries({ queryKey: ['shift-current'] }),",
      "  })",
      "}",
    ],
  };
  allOk = applyFilePatchSequenceWithOffset(filePath, 'src/api.ts', ops) && allOk;
}

// ------------------------------------------------------------------
// 5. src/App.tsx — import, expectedCash math, tab, overview list
// ------------------------------------------------------------------
{
  const filePath = path.join(REPO_ROOT, 'src', 'App.tsx');
  const ops = [
    {
      kind: 'replace',
      label: 'import useCashIn alongside useCashDrop',
      alreadyFixedMarker: 'useOpenShift, useCloseShift, useCashDrop, useCashIn, useHeldOrders,',
      findMarker: 'useOpenShift, useCloseShift, useCashDrop, useHeldOrders,',
      fromSubstr: 'useOpenShift, useCloseShift, useCashDrop, useHeldOrders,',
      toSubstr: 'useOpenShift, useCloseShift, useCashDrop, useCashIn, useHeldOrders,',
    },
    {
      kind: 'insert',
      label: 'instantiate cashIn mutation hook',
      alreadyFixedMarker: 'const cashIn = useCashIn();',
      anchorMarker: 'const cashDrop = useCashDrop();',
      insertLines: ['const cashIn = useCashIn();'],
    },
    {
      kind: 'replace',
      label: 'tab state: add cash-in tab',
      alreadyFixedMarker: "const [tab, setTab] = useState<'overview' | 'close' | 'drop' | 'cash-in'>('overview');",
      findMarker: "const [tab, setTab] = useState<'overview' | 'close' | 'drop'>('overview');",
      fromSubstr: "const [tab, setTab] = useState<'overview' | 'close' | 'drop'>('overview');",
      toSubstr: "const [tab, setTab] = useState<'overview' | 'close' | 'drop' | 'cash-in'>('overview');",
    },
    {
      kind: 'insert',
      label: 'cash-in amount/reason input state',
      alreadyFixedMarker: "const [cashInAmount, setCashInAmount] = useState('');",
      anchorMarker: "const [dropReason, setDropReason] = useState('');",
      insertLines: [
        "const [cashInAmount, setCashInAmount] = useState('');",
        "const [cashInReason, setCashInReason] = useState('');",
      ],
    },
    {
      kind: 'replace',
      label: 'pendingAction type: add cash-in',
      alreadyFixedMarker: "const [pendingAction, setPendingAction] = useState<'open' | 'close' | 'drop' | 'cash-in' | null>(null);",
      findMarker: "const [pendingAction, setPendingAction] = useState<'open' | 'close' | 'drop' | null>(null);",
      fromSubstr: "const [pendingAction, setPendingAction] = useState<'open' | 'close' | 'drop' | null>(null);",
      toSubstr: "const [pendingAction, setPendingAction] = useState<'open' | 'close' | 'drop' | 'cash-in' | null>(null);",
    },
    {
      kind: 'replace',
      label: 'triggerAction callback signature: add cash-in',
      alreadyFixedMarker: "const triggerAction = useCallback((action: 'open' | 'close' | 'drop' | 'cash-in') => {",
      findMarker: "const triggerAction = useCallback((action: 'open' | 'close' | 'drop') => {",
      fromSubstr: "const triggerAction = useCallback((action: 'open' | 'close' | 'drop') => {",
      toSubstr: "const triggerAction = useCallback((action: 'open' | 'close' | 'drop' | 'cash-in') => {",
    },
    {
      kind: 'insert',
      label: 'executeAction: handle cash-in mutation',
      alreadyFixedMarker: "} else if (pendingAction === 'cash-in' && shift && cashInReason) {",
      anchorMarker: "toast('Cash drop recorded');\n        setDropAmount(''); setDropReason('');\n        onCloseRef.current();\n      }",
      // The anchor above spans multiple lines and is brittle; use a
      // single unique line instead (see override just below).
      indentOverride: '',
      insertLines: [],
    },
  ];
  // Fix the executeAction insert to use a reliable single-line anchor.
  ops[6] = {
    kind: 'insertAfterOffset',
    label: 'executeAction: handle cash-in mutation',
    alreadyFixedMarker: "} else if (pendingAction === 'cash-in' && shift && cashInReason) {",
    anchorMarker: "setDropAmount(''); setDropReason('');",
    offset: 1, // insert after the `onCloseRef.current();` line that follows
    indentOverride: '      ',
    insertLines: [
      "} else if (pendingAction === 'cash-in' && shift && cashInReason) {",
      "  await cashIn.mutateAsync({ shift_id: shift.id, amount: parseFloat(cashInAmount) || 0, reason: cashInReason });",
      "  toast('Cash in recorded');",
      "  setCashInAmount(''); setCashInReason('');",
      "  onCloseRef.current();",
    ],
  };
  ops.push({
    kind: 'replace',
    label: 'executeAction dependency array: include cashIn hooks/state',
    alreadyFixedMarker: "}, [pendingAction, openShift, closeShift, cashDrop, cashIn, shift, startFloat, closingCash, closeNotes, dropAmount, dropReason, cashInAmount, cashInReason]);",
    findMarker: "}, [pendingAction, openShift, closeShift, cashDrop, shift, startFloat, closingCash, closeNotes, dropAmount, dropReason]);",
    fromSubstr: "}, [pendingAction, openShift, closeShift, cashDrop, shift, startFloat, closingCash, closeNotes, dropAmount, dropReason]);",
    toSubstr: "}, [pendingAction, openShift, closeShift, cashDrop, cashIn, shift, startFloat, closingCash, closeNotes, dropAmount, dropReason, cashInAmount, cashInReason]);",
  });
  ops.push({
    kind: 'replace',
    label: 'expectedCash: add cash-ins, keep subtracting drops',
    alreadyFixedMarker: "const cashInTotal = (shift.cash_drops ?? []).filter((d: CashDrop) => d.type === 'cash_in').reduce((s, d: CashDrop) => s + d.amount, 0);",
    findMarker: "const expectedCash = (shift.starting_float ?? 0) + cashTotal - (shift.cash_drops ?? []).reduce((s, d: CashDrop) => s + d.amount, 0);",
    fromSubstr: "const expectedCash = (shift.starting_float ?? 0) + cashTotal - (shift.cash_drops ?? []).reduce((s, d: CashDrop) => s + d.amount, 0);",
    toSubstr:
      "const cashDropTotal = (shift.cash_drops ?? []).filter((d: CashDrop) => d.type !== 'cash_in').reduce((s, d: CashDrop) => s + d.amount, 0);\n" +
      "  const cashInTotal = (shift.cash_drops ?? []).filter((d: CashDrop) => d.type === 'cash_in').reduce((s, d: CashDrop) => s + d.amount, 0);\n" +
      "  const expectedCash = (shift.starting_float ?? 0) + cashTotal + cashInTotal - cashDropTotal;",
  });
  ops.push({
    kind: 'replace',
    label: 'tab bar: add Cash In tab',
    alreadyFixedMarker: "{(['overview', 'drop', 'cash-in', 'close'] as const).map(t => (",
    findMarker: "{(['overview', 'drop', 'close'] as const).map(t => (",
    fromSubstr: "{(['overview', 'drop', 'close'] as const).map(t => (",
    toSubstr: "{(['overview', 'drop', 'cash-in', 'close'] as const).map(t => (",
  });
  ops.push({
    kind: 'replace',
    label: 'tab label: Cash In',
    alreadyFixedMarker: "{t === 'drop' ? 'Cash Drop' : t === 'cash-in' ? 'Cash In' : t === 'close' ? 'Close Shift' : 'Overview'}",
    findMarker: "{t === 'drop' ? 'Cash Drop' : t === 'close' ? 'Close Shift' : 'Overview'}",
    fromSubstr: "{t === 'drop' ? 'Cash Drop' : t === 'close' ? 'Close Shift' : 'Overview'}",
    toSubstr: "{t === 'drop' ? 'Cash Drop' : t === 'cash-in' ? 'Cash In' : t === 'close' ? 'Close Shift' : 'Overview'}",
  });
  ops.push({
    kind: 'replace',
    label: 'overview: list heading — Cash Drops -> Cash Movements',
    alreadyFixedMarker: "<p className=\"text-xs font-700 text-gray-500 mb-2 uppercase tracking-wider\" style={{ fontWeight: 700 }}>Cash Movements</p>",
    findMarker: "<p className=\"text-xs font-700 text-gray-500 mb-2 uppercase tracking-wider\" style={{ fontWeight: 700 }}>Cash Drops</p>",
    fromSubstr: "<p className=\"text-xs font-700 text-gray-500 mb-2 uppercase tracking-wider\" style={{ fontWeight: 700 }}>Cash Drops</p>",
    toSubstr: "<p className=\"text-xs font-700 text-gray-500 mb-2 uppercase tracking-wider\" style={{ fontWeight: 700 }}>Cash Movements</p>",
  });
  ops.push({
    kind: 'replace',
    label: 'overview: color/sign cash-in green (+) vs drop red (-)',
    alreadyFixedMarker: "<span className={d.type === 'cash_in' ? 'text-green-600 font-700' : 'text-red-500 font-700'} style={{ fontWeight: 700 }}>{d.type === 'cash_in' ? '+' : '−'}{fmt(d.amount)}</span>",
    findMarker: "<span className=\"text-red-500 font-700\" style={{ fontWeight: 700 }}>−{fmt(d.amount)}</span>",
    fromSubstr: "<span className=\"text-red-500 font-700\" style={{ fontWeight: 700 }}>−{fmt(d.amount)}</span>",
    toSubstr: "<span className={d.type === 'cash_in' ? 'text-green-600 font-700' : 'text-red-500 font-700'} style={{ fontWeight: 700 }}>{d.type === 'cash_in' ? '+' : '−'}{fmt(d.amount)}</span>",
  });
  ops.push({
    kind: 'insertAfterOffset',
    label: 'new "Cash In" tab panel (mirrors Cash Drop tab)',
    alreadyFixedMarker: "{tab === 'cash-in' && (",
    anchorMarker: "disabled={!dropReason || !dropAmount} className=\"flex-1\">Record Drop</Btn>",
    offset: 3, // past the two closing </div> lines and the blank line before `{tab === 'close' &&`
    indentOverride: '        ',
    insertLines: [
      "{tab === 'cash-in' && (",
      "  <div className=\"flex flex-col gap-4\">",
      "    <p className=\"text-sm text-gray-500\">Record cash added to the drawer.</p>",
      "    <Input label=\"Amount (₱)\" type=\"number\" value={cashInAmount} min={0} step={0.01} onChange={setCashInAmount} />",
      "    <Input label=\"Reason\" value={cashInReason} onChange={setCashInReason} placeholder=\"e.g. Change fund top-up, Owner injection\" />",
      "    <div className=\"flex gap-2\">",
      "      <Btn variant=\"secondary\" onClick={onClose} className=\"flex-1\">Cancel</Btn>",
      "      <Btn variant=\"mango\" onClick={() => triggerAction('cash-in')} loading={cashIn.isPending}",
      "        disabled={!cashInReason || !cashInAmount} className=\"flex-1\">Record Cash In</Btn>",
      "    </div>",
      "  </div>",
      ")}",
      "",
    ],
  });

  allOk = applyFilePatchSequenceWithOffset(filePath, 'src/App.tsx', ops) && allOk;
}

log('');
if (allOk) {
  if (DRY_RUN) {
    ok('Dry run completed successfully — re-run without --dry-run to apply.');
  } else {
    ok('Patch completed successfully.');
    info('Next steps:');
    info('  1. cd worker && npx wrangler d1 migrations apply <YOUR_DB_NAME> [--remote]');
    info('  2. npm run build');
    info('  3. cd worker && npx wrangler deploy');
  }
  process.exit(0);
} else {
  err('Patch completed with errors — see above. No partial file was left in a broken state');
  err('(each file is only written after all its edits succeed).');
  process.exit(1);
}

// ====================================================================
// Sequence runner supporting 'replace' | 'insert' | 'insertAfterOffset'
// ====================================================================
function applyFilePatchSequenceWithOffset(filePath, label, ops) {
  log('');
  log(`=== ${label} ===`);

  if (!fs.existsSync(filePath)) {
    err(`File not found: ${filePath}`);
    return false;
  }

  let text = fs.readFileSync(filePath, 'utf8');
  let { lines, eol } = splitLines(text);
  let anyChanged = false;

  for (const op of ops) {
    let result;
    if (op.kind === 'replace') {
      result = runLineReplaceOnLines(lines, op);
    } else if (op.kind === 'insert') {
      result = runInsertOnLines(lines, op);
    } else if (op.kind === 'insertAfterOffset') {
      result = runInsertAfterOffsetOnLines(lines, op);
    } else {
      err(`Unknown op kind: ${op.kind}`);
      return false;
    }
    if (!result.success) {
      err(`Aborting all edits to ${path.relative(REPO_ROOT, filePath)} — no changes written.`);
      return false;
    }
    if (result.changed) {
      lines = result.lines;
      anyChanged = true;
    }
  }

  if (!anyChanged) {
    ok(`All edits to ${path.relative(REPO_ROOT, filePath)} already applied — skipping write.`);
    return true;
  }

  if (DRY_RUN) {
    warn(`Dry run — ${path.relative(REPO_ROOT, filePath)} not written.`);
    return true;
  }

  const backupPath = backupFile(filePath);
  fs.writeFileSync(filePath, lines.join(eol), 'utf8');
  ok(`Wrote ${path.relative(REPO_ROOT, filePath)} (backup: ${path.relative(REPO_ROOT, backupPath)})`);
  return true;
}

function runInsertAfterOffsetOnLines(lines, op) {
  log('');
  log(`-- ${op.label}`);
  const alreadyIdx = findLineIndex(lines, op.alreadyFixedMarker);
  if (alreadyIdx !== -1) {
    ok(`Already applied (line ${alreadyIdx + 1}) — skipping.`);
    return { success: true, changed: false, lines };
  }
  const anchorIdx = findLineIndex(lines, op.anchorMarker);
  if (anchorIdx === -1) {
    err(`Could not find anchor for "${op.label}".`);
    err(`  No changes were made to this file. Please check it manually.`);
    if (DEBUG) info(`Searched for (normalized): "${normalizeForMatch(op.anchorMarker)}"`);
    return { success: false, changed: false, lines };
  }
  const insertAt = anchorIdx + 1 + (op.offset || 0);
  if (insertAt > lines.length) {
    err(`Computed insert position (${insertAt}) is past end of file for "${op.label}".`);
    return { success: false, changed: false, lines };
  }
  const anchorLine = lines[anchorIdx].replace(/\r$/, '');
  const indentMatch = anchorLine.match(/^[ \t]*/);
  const indent = op.indentOverride !== undefined ? op.indentOverride : (indentMatch ? indentMatch[0] : '');
  const insertLines = op.insertLines.map(l => (l.length ? indent + l : l));
  log(`  Inserting ${insertLines.length} line(s) at position ${insertAt + 1} (after line ${anchorIdx + 1}, offset ${op.offset || 0}):`);
  for (const l of insertLines) log(`  \x1b[32m+ ${l}\x1b[0m`);
  const next = lines.slice(0, insertAt).concat(insertLines, lines.slice(insertAt));
  return { success: true, changed: true, lines: next };
}
