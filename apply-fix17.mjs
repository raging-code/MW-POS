#!/usr/bin/env node
// apply-fix17.mjs
//
// Fixes: the "choose account" login screen can't be scrolled on iPad /
// tablet POS devices, especially in landscape.
//
// ROOT CAUSE:
//   - src/index.css intentionally sets `body { overflow: hidden }` for
//     kiosk-mode (prevents rubber-band scroll on the main POS screens).
//     That's correct for the app shell, but it also means the DOCUMENT
//     itself can never scroll as a fallback.
//   - The login screen (LoginPage in src/App.tsx) rendered its content in
//     a `min-h-screen flex items-center justify-center` wrapper with NO
//     scroll container of its own.
//   - Result: whenever the card (logo + account list, or logo + PIN pad +
//     numpad) is taller than the viewport, the overflow is silently
//     clipped with no way to reach it. iPad landscape is the easiest way
//     to hit this — viewport height drops to ~700-760px after Safari's
//     chrome — but any short-viewport tablet/kiosk device has the same
//     problem, e.g. with several staff accounts in the list.
//
// FIX:
//   Give the login screen its own scroll container:
//     <div class="h-full w-full overflow-y-auto ...">      <- scrolls
//       <div class="min-h-full flex items-center justify-center p-4">  <- still centers when content fits
//         ...existing card...
//       </div>
//     </div>
//   This is the standard "centered-but-scrollable" pattern: short content
//   still centers vertically exactly like before; tall content scrolls
//   instead of clipping. `-webkit-overflow-scrolling: touch` keeps the
//   scroll smooth on iPad/older Safari-based POS hardware.
//
// Usage:
//   node apply-fix17.mjs [path-to-repo]
//   (defaults to current directory)

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.argv[2] || '.';
const filePath = join(repoRoot, 'src/App.tsx');

let src;
try {
  src = readFileSync(filePath, 'utf8');
} catch (e) {
  console.error(`Could not read ${filePath}: ${e.message}`);
  process.exit(1);
}

let patched = src;
let changes = 0;

// ── 1. Opening wrapper: add scroll container + inner centering div ─────
const oldOpen = `  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--surface-page)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
<div className="w-20 h-20 flex items-center justify-center mx-auto mb-4">
  <img src="/MWIcon.png" alt="MW POS" className="w-full h-full object-contain" />
</div>
          <h1 className="text-2xl font-900 mb-1" style={{ fontFamily: 'var(--font-display)', fontWeight: 900 }}>
            <span style={{ color: '#D97706' }}>Mango </span><span style={{ color: 'var(--warrior-red)' }}>Warrior</span>
          </h1>
          <p className="text-gray-500 text-sm">Point of Sale System</p>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-lg border border-gray-150">`;

const newOpen = `  return (
    // FIX #17: iPad/tablet landscape can't scroll the login screen.
    //
    // body { overflow: hidden } is intentional (kiosk-mode, prevents
    // rubber-band scroll on the main POS screens — see index.css), but it
    // means the DOCUMENT can never scroll as a fallback. This wrapper was
    // \`min-h-screen flex items-center justify-center\` with no scroll
    // container of its own, so whenever the login card (logo + account
    // list, or logo + PIN pad + numpad) is taller than the viewport —
    // very easy on iPad landscape, where height drops to ~700-760px after
    // Safari's chrome — the overflow was just clipped with no way to
    // reach it, on iPad or any other short-viewport device.
    //
    // Fix: give this screen its own scroll container (\`overflow-y-auto\`)
    // sized to the available height (\`h-full\`, matching #root), with an
    // inner \`min-h-full\` flex wrapper so short content still centers
    // vertically like before, and tall content scrolls instead of
    // clipping. \`-webkit-overflow-scrolling: touch\` keeps scrolling
    // smooth on iPad/older Safari-based POS devices.
    <div className="h-full w-full overflow-y-auto overscroll-contain" style={{ background: 'var(--surface-page)', WebkitOverflowScrolling: 'touch' }}>
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
        <div className="text-center mb-8">
<div className="w-20 h-20 flex items-center justify-center mx-auto mb-4">
  <img src="/MWIcon.png" alt="MW POS" className="w-full h-full object-contain" />
</div>
          <h1 className="text-2xl font-900 mb-1" style={{ fontFamily: 'var(--font-display)', fontWeight: 900 }}>
            <span style={{ color: '#D97706' }}>Mango </span><span style={{ color: 'var(--warrior-red)' }}>Warrior</span>
          </h1>
          <p className="text-gray-500 text-sm">Point of Sale System</p>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-lg border border-gray-150">`;

if (patched.includes(oldOpen)) {
  patched = patched.replace(oldOpen, newOpen);
  changes++;
} else {
  console.error('✗ Could not find the LoginPage opening wrapper (step 1). File may already be patched, or has diverged — check manually.');
}

// ── 2. Closing tags: add the matching closing div for the new wrapper ──
const oldClose = `        </div>
      </div>
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────`;

const newClose = `        </div>
      </div>
      </div>
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────`;

if (patched.includes(oldClose)) {
  patched = patched.replace(oldClose, newClose);
  changes++;
} else {
  console.error('✗ Could not find the LoginPage closing tags (step 2). File may already be patched, or has diverged — check manually.');
}

if (changes === 0) {
  console.error('\nNo changes applied. Nothing was written.');
  process.exit(1);
}

writeFileSync(filePath, patched, 'utf8');
console.log(`✓ Applied ${changes}/2 patch block(s) to ${filePath}`);
if (changes < 2) {
  console.log('  One block was skipped — see ✗ line above. Check that section manually (likely the closing-tags match isn\'t unique, since "// ─── Header" appears once — search near the end of LoginPage for the mismatch instead).');
  process.exit(1);
}
console.log('\nDone. Recommended next steps:');
console.log('  1. cd into your repo, run `npx tsc --noEmit` to confirm it compiles.');
console.log('  2. Test in Safari dev tools (or a real iPad) in landscape: open the');
console.log('     login screen with several staff accounts, or enter a PIN so the');
console.log('     numpad shows — you should now be able to scroll the card instead');
console.log('     of content being clipped at the top/bottom.');
