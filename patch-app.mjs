#!/usr/bin/env node
// patch-app.mjs
// Run from the project root:   node patch-app.mjs
//
// Applies two targeted fixes to src/App.tsx:
//
//   FIX 1 (line ~14): Add fine-grained cart hooks to the store import.
//          useCartTotal and useCartItemCount are already exported from
//          store.ts but never imported in App.tsx. POSPage still calls
//          useCartStore(s => s.total()) and useCartStore(s => s.cart.items.reduce(...))
//          which subscribe to the full store object.
//
//   FIX 2 (lines ~1223-1225): Replace the two inline useCartStore selectors
//          in POSPage with the stable hooks. This means POSPage's total/itemCount
//          vars only cause a re-render when those specific values change, not on
//          every cart mutation (discount toggle, note update, etc.).
//
//   FIX 3 (lines ~3803-3811): Replace the eager pageMap object literal with
//          a switch/conditional that only instantiates the current page.
//          Previously all 7 page components were mounted simultaneously and their
//          React Query hooks fired on mount — SalesPage was making API calls
//          even while the cashier was on the POS screen.

import fs from 'fs';
import path from 'path';

const filePath = path.resolve('src/App.tsx');
let src = fs.readFileSync(filePath, 'utf8');

// ─── FIX 1: Update store import ──────────────────────────────────────────────
const OLD_IMPORT = `import { useAuthStore, useCartStore, useUIStore } from './store';`;
const NEW_IMPORT = `import { useAuthStore, useCartStore, useUIStore, useCartTotal, useCartItemCount } from './store';`;

if (!src.includes(OLD_IMPORT)) {
  console.error('FIX 1 FAILED: Could not find store import line. Already patched?');
  process.exit(1);
}
src = src.replace(OLD_IMPORT, NEW_IMPORT);
console.log('✓ FIX 1 applied: store import updated');

// ─── FIX 2: Replace inline selectors in POSPage ──────────────────────────────
const OLD_SELECTORS = `  // useCartStore selectors — only subscribe to what we need
  const total = useCartStore(s => s.total());
  const itemCount = useCartStore(s => s.cart.items.reduce((acc, i) => acc + i.qty, 0));`;

const NEW_SELECTORS = `  // Fine-grained cart hooks — each subscribes to only one computed value.
  // useCartTotal() re-renders only when the cart total changes.
  // useCartItemCount() re-renders only when the total item count changes.
  // Previously the inline useCartStore(s => s.total()) selectors still
  // subscribed to the full store and re-rendered on every mutation.
  const total = useCartTotal();
  const itemCount = useCartItemCount();`;

if (!src.includes(OLD_SELECTORS)) {
  console.error('FIX 2 FAILED: Could not find inline selector block. Already patched?');
  process.exit(1);
}
src = src.replace(OLD_SELECTORS, NEW_SELECTORS);
console.log('✓ FIX 2 applied: POSPage useCartStore selectors replaced with fine-grained hooks');

// ─── FIX 3: Lazy-render AppShell pageMap ─────────────────────────────────────
const OLD_PAGEMAP = `  const pageMap: Partial<Record<Page, React.ReactNode>> = {
    pos:               <POSPage />,
    sales:             <SalesPage />,
    admin_dashboard:   <AdminDashboardPage />,
    admin_menu:        <AdminMenuPage />,
    admin_employees:   <AdminEmployeesPage />,
    admin_settings:    <AdminSettingsPage />,
    admin_audit:       <AdminAuditPage />,
  };

  const adminPages: Page[] = ['admin_dashboard','admin_menu','admin_employees','admin_settings','admin_audit'];
  const currentPage: Page = adminPages.includes(page) && user?.role !== 'admin' ? 'pos' : page;

  return (
    <div className="w-full h-full flex flex-col" style={{ background: 'var(--surface-page)' }}>
      <Header />
      <main className="flex-1 overflow-hidden" role="main">
        {pageMap[currentPage] ?? <POSPage />}
      </main>
      <PinModal />
    </div>
  );`;

const NEW_PAGEMAP = `  // FIX: Replaced eager pageMap object with lazy rendering.
  // Previously all 7 page components were instantiated on every AppShell
  // render, meaning all their useQuery hooks fired simultaneously — SalesPage
  // and AdminDashboardPage were making API calls even while the cashier was
  // on the POS screen. Now only the current page is mounted.
  const adminPages: Page[] = ['admin_dashboard','admin_menu','admin_employees','admin_settings','admin_audit'];
  const currentPage: Page = adminPages.includes(page) && user?.role !== 'admin' ? 'pos' : page;

  function renderPage() {
    switch (currentPage) {
      case 'pos':               return <POSPage />;
      case 'sales':             return <SalesPage />;
      case 'admin_dashboard':   return <AdminDashboardPage />;
      case 'admin_menu':        return <AdminMenuPage />;
      case 'admin_employees':   return <AdminEmployeesPage />;
      case 'admin_settings':    return <AdminSettingsPage />;
      case 'admin_audit':       return <AdminAuditPage />;
      default:                  return <POSPage />;
    }
  }

  return (
    <div className="w-full h-full flex flex-col" style={{ background: 'var(--surface-page)' }}>
      <Header />
      <main className="flex-1 overflow-hidden" role="main">
        {renderPage()}
      </main>
      <PinModal />
    </div>
  );`;

if (!src.includes(OLD_PAGEMAP)) {
  console.error('FIX 3 FAILED: Could not find pageMap block. Already patched?');
  process.exit(1);
}
src = src.replace(OLD_PAGEMAP, NEW_PAGEMAP);
console.log('✓ FIX 3 applied: AppShell pageMap replaced with lazy renderPage()');

// ─── Write output ─────────────────────────────────────────────────────────────
fs.writeFileSync(filePath, src, 'utf8');
console.log('\n✅ All 3 fixes applied to src/App.tsx');
