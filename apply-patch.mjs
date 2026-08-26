#!/usr/bin/env node
// apply-patch.mjs
//
// Fixes 4 issues in MW-POS:
//   #1  Sales sometimes missing from Sales tab
//   #2  Dashboard/report cards stuck at ₱0.00 after a sale
//   #3  (No code change — PBKDF2 cost is inherent; see note at bottom)
//   #4  "-₱10 discount" mismatch when a category has discounts disabled
//
// Usage:
//   node apply-patch.mjs            (run from the repo root)
//
// Safe to re-run: every replacement checks the target file's current
// content first and skips (with a message) if it's already patched or
// if the expected text isn't found (so you don't get a silent partial
// patch on a repo that has since diverged).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const FILES = {
  app: 'src/App.tsx',
  api: 'src/api.ts',
  store: 'src/store.ts',
  worker: 'worker/src/index.ts',
};

let touched = new Set();
let skipped = [];
let failed = [];

function patch(fileKey, label, oldStr, newStr, { optional = false } = {}) {
  const path = FILES[fileKey];
  if (!existsSync(path)) {
    failed.push(`[${label}] File not found: ${path}`);
    return;
  }
  let content = readFileSync(path, 'utf8');

  // Check "already applied" FIRST and independently of oldStr — some
  // patches have newStr as a strict superset of oldStr (oldStr is a
  // substring of newStr), so checking both at once can never detect
  // an already-applied patch and would insert a duplicate on re-run.
  if (content.includes(newStr)) {
    skipped.push(`[${label}] Already applied — skipping.`);
    return;
  }

  const occurrences = content.split(oldStr).length - 1;
  if (occurrences === 0) {
    const msg = `[${label}] Expected text not found in ${path} — repo may have changed. Skipping.`;
    if (optional) skipped.push(msg);
    else failed.push(msg);
    return;
  }
  if (occurrences > 1) {
    failed.push(`[${label}] Expected text found ${occurrences} times (need exactly 1) in ${path} — refusing to guess. Skipping.`);
    return;
  }

  content = content.replace(oldStr, newStr);
  writeFileSync(path, content, 'utf8');
  touched.add(path);
  console.log(`✔ [${label}] patched ${path}`);
}

// ─────────────────────────────────────────────────────────────────
// FIX #1 + #2 (shared root cause: local-date helper)
// Add a single Manila-local-date helper next to the other small
// formatting helpers, so all three UTC-slice call sites can share it.
// ─────────────────────────────────────────────────────────────────
patch(
  'app',
  '1/2 — add getManilaDateString helper',
  `function fmtDate(iso: string) {`,
  `// FIX: Asia/Manila (UTC+8) local calendar date as "YYYY-MM-DD".
// new Date().toISOString().slice(0, 10) gives the UTC date, which is
// wrong for roughly 8 hours a day in Manila (00:00-07:59 local time is
// still "yesterday" in UTC). The server's manilaToUTC() treats date
// filter strings as Manila calendar days, so the client must produce
// the same calendar day it, or sales right after local midnight won't
// show up until the date field is manually bumped forward.
function getManilaDateString(d: Date = new Date()): string {
  // en-CA locale formats as YYYY-MM-DD, which is what we want.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(d);
}

function fmtDate(iso: string) {`
);

patch(
  'app',
  '1/2 — SalesPage default dateFrom/dateTo',
  `function SalesPage() {
  const openPinModal = useUIStore(s => s.openPinModal);
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));`,
  `function SalesPage() {
  const openPinModal = useUIStore(s => s.openPinModal);
  const [dateFrom, setDateFrom] = useState(getManilaDateString());
  const [dateTo, setDateTo] = useState(getManilaDateString());`
);

patch(
  'app',
  '1/2 — DetailedReportModal default dateValue',
  `function DetailedReportModal({ onClose }: { onClose: () => void }) {
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('daily');
  const [dateValue, setDateValue] = useState(new Date().toISOString().slice(0, 10));`,
  `function DetailedReportModal({ onClose }: { onClose: () => void }) {
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('daily');
  const [dateValue, setDateValue] = useState(getManilaDateString());`
);

patch(
  'app',
  '1/2 — AdminDashboardPage default dateFrom/dateTo',
  `function AdminDashboardPage() {
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));`,
  `function AdminDashboardPage() {
  const [dateFrom, setDateFrom] = useState(getManilaDateString());
  const [dateTo, setDateTo] = useState(getManilaDateString());`
);

// ─────────────────────────────────────────────────────────────────
// FIX #2 — invalidate report-sales / report-sales-detailed everywhere
// a sale's data can change: checkout, void, refund, soft-delete,
// purge-all, edit. Previously only ['sales'] and ['shift-current']
// were invalidated, so Dashboard/Detailed Report kept serving stale
// cached data (₱0.00) even though the sale landed correctly.
// ─────────────────────────────────────────────────────────────────
patch(
  'api',
  '2 — useCheckout invalidation',
  `    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] })
      qc.invalidateQueries({ queryKey: ['shift-current'] })
    },
  })
}

// ─── Sales ────────────────────────────────────────────────────`,
  `    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] })
      qc.invalidateQueries({ queryKey: ['shift-current'] })
      // FIX: Dashboard and Detailed Report read from these query keys,
      // not ['sales']. Without this they kept showing stale (often
      // ₱0.00) totals after a checkout.
      qc.invalidateQueries({ queryKey: ['report-sales'] })
      qc.invalidateQueries({ queryKey: ['report-sales-detailed'] })
    },
  })
}

// ─── Sales ────────────────────────────────────────────────────`
);

patch(
  'api',
  '2 — useVoidSale invalidation',
  `      api.post(\`/sales/\${id}/void\`, { reason, actioned_by_user_id, actioned_by_name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales'] }),
  })
}`,
  `      api.post(\`/sales/\${id}/void\`, { reason, actioned_by_user_id, actioned_by_name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] })
      qc.invalidateQueries({ queryKey: ['report-sales'] })
      qc.invalidateQueries({ queryKey: ['report-sales-detailed'] })
    },
  })
}`
);

patch(
  'api',
  '2 — useRefundSale invalidation',
  `      api.post(\`/sales/\${id}/refund\`, { reason, actioned_by_user_id, actioned_by_name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales'] }),
  })
}`,
  `      api.post(\`/sales/\${id}/refund\`, { reason, actioned_by_user_id, actioned_by_name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] })
      qc.invalidateQueries({ queryKey: ['report-sales'] })
      qc.invalidateQueries({ queryKey: ['report-sales-detailed'] })
    },
  })
}`
);

patch(
  'api',
  '2 — useSoftDeleteSale invalidation',
  `      api.del(\`/sales/\${id}\`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales'] }),
  })
}`,
  `      api.del(\`/sales/\${id}\`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] })
      qc.invalidateQueries({ queryKey: ['report-sales'] })
      qc.invalidateQueries({ queryKey: ['report-sales-detailed'] })
    },
  })
}`
);

patch(
  'api',
  '2 — usePurgeAllSales invalidation',
  `    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] })
      qc.invalidateQueries({ queryKey: ['shifts'] })
    },
  })
}

export function useReprintSale() {`,
  `    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] })
      qc.invalidateQueries({ queryKey: ['shifts'] })
      qc.invalidateQueries({ queryKey: ['report-sales'] })
      qc.invalidateQueries({ queryKey: ['report-sales-detailed'] })
    },
  })
}

export function useReprintSale() {`
);

patch(
  'api',
  '2 — useEditSale invalidation',
  `    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['sales'] })
      qc.invalidateQueries({ queryKey: ['sale', vars.id] })
    },
  })
}

// ─── Reports ─────────────────────────────────────────────────`,
  `    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['sales'] })
      qc.invalidateQueries({ queryKey: ['sale', vars.id] })
      qc.invalidateQueries({ queryKey: ['report-sales'] })
      qc.invalidateQueries({ queryKey: ['report-sales-detailed'] })
    },
  })
}

// ─── Reports ─────────────────────────────────────────────────`
);

// ─────────────────────────────────────────────────────────────────
// FIX #4 — discount_disabled guard at checkout time.
// computeItemTotals() (store.ts) has no idea about a category's
// discount_disabled flag, so a cart line added before the flag was
// toggled on (or before the item's category changed) can silently
// carry a discount the server will reject at /sales. The picker/UI
// already hides the option going forward — this adds the actual
// guard so checkout can't be attempted with a doomed cart, instead
// of surfacing the mismatch only after tendering cash.
// ─────────────────────────────────────────────────────────────────
patch(
  'app',
  '4 — CheckoutModal: pull categories from useMenu',
  `function CheckoutModal({ shift, onClose, onSuccess }: {
  shift: Shift | null | undefined; onClose: () => void; onSuccess: () => void;
}) {
  const { user } = useAuthStore();`,
  `function CheckoutModal({ shift, onClose, onSuccess }: {
  shift: Shift | null | undefined; onClose: () => void; onSuccess: () => void;
}) {
  const { user } = useAuthStore();
  // FIX #4: needed to check each cart line's category discount_disabled
  // flag before checkout — see blockedDiscountLines below.
  const { data: menuData } = useMenu();`
);

patch(
  'app',
  '4 — CheckoutModal: compute blockedDiscountLines + guard doCheckout',
  `  const doCheckout = useCallback(async () => {
    if (!user) return;
    try {`,
  `  // FIX #4: a cart line can carry a discount that its category no
  // longer allows — e.g. the line was added before an admin toggled
  // "discounts disabled" on for that category, or the item's category
  // changed. The server always re-checks this from the DB and zeroes
  // the discount, but the client's cart total wouldn't reflect that,
  // so the cashier would tender an amount the server then rejects.
  // Catch it here, before attempting checkout.
  const categoryDiscountDisabled = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const cat of menuData?.categories ?? []) map.set(cat.id, !!cat.discount_disabled);
    return map;
  }, [menuData]);

  const blockedDiscountLines = useMemo(
    () => cartItems.filter(i =>
      (i.discount_type != null || i.discount_pct > 0) &&
      i.category_id != null &&
      categoryDiscountDisabled.get(i.category_id) === true
    ),
    [cartItems, categoryDiscountDisabled]
  );

  const doCheckout = useCallback(async () => {
    if (!user) return;
    if (blockedDiscountLines.length > 0) {
      toast(\`Remove the discount on "\${blockedDiscountLines[0].item_name}" — discounts are disabled for its category\`, 'error');
      return;
    }
    try {`
);

patch(
  'app',
  '4 — disable checkout button while a blocked discount line exists',
  `            <Btn variant="mango" size="lg" onClick={doCheckout}
              disabled={!balanced || !tenderedOk}
              loading={checkout.isPending} className="flex-[2]">`,
  `            <Btn variant="mango" size="lg" onClick={doCheckout}
              disabled={blockedDiscountLines.length > 0 || !balanced || !tenderedOk}
              loading={checkout.isPending} className="flex-[2]">`
);

// ─────────────────────────────────────────────────────────────────
console.log('');
if (skipped.length) {
  console.log('--- Skipped (already applied or not applicable) ---');
  skipped.forEach(m => console.log('  ' + m));
}
if (failed.length) {
  console.log('--- FAILED (needs manual attention) ---');
  failed.forEach(m => console.log('  ✗ ' + m));
}
console.log('');
console.log(`Done. ${touched.size} file(s) modified: ${[...touched].join(', ') || '(none)'}`);
if (failed.length) {
  console.log('\nSome patches failed — see above. Nothing was partially written for a failed patch (each replacement is all-or-nothing), but review the file list and re-run after resolving conflicts.');
  process.exitCode = 1;
}

// ─────────────────────────────────────────────────────────────────
// Note on Issue #3 (slow PIN response):
// No code patch here on purpose. The delay is 100,000 PBKDF2
// iterations verified server-side on every PIN entry — real, working
// security cost, not a bug. Two real options if you want it faster:
//   a) Lower iterations (weakens brute-force resistance) — not applied
//      automatically since it's a security/UX tradeoff you should pick.
//   b) Keep iterations as-is, add an optimistic "Verifying…" spinner
//      client-side so it *feels* instant while the request is in
//      flight (no security tradeoff, purely perceived speed).
// Ask if you want (a), (b), or both wired up as a follow-up patch.
