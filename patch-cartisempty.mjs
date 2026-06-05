/**
 * patch-cartisempty.mjs
 *
 * Fixes TS2552: "Cannot find name 'useCartIsEmpty'" in App.tsx.
 *
 * Root cause: the previous patch injected `useCartIsEmpty` as an import
 * but the hook was never exported from store.ts. The fix has two parts:
 *
 *   FIX A — Add `useCartIsEmpty` export to store.ts
 *   FIX B — Remove `useCartIsEmpty` from the App.tsx import (it is not
 *            needed as a hook — `cartIsEmpty` is already derived locally
 *            from `useCartItemCount`, which IS exported). Also remove any
 *            stray duplicate declaration of cartIsEmpty if present.
 */

import fs from "fs";
import path from "path";

const ROOT = process.cwd();

let passed = 0, skipped = 0, failed = 0;

function applyFix(label, filePath, fn) {
  const abs = path.resolve(ROOT, filePath);
  if (!fs.existsSync(abs)) {
    console.error(`✗ ${label}: file not found — ${filePath}`);
    failed++;
    return;
  }
  const original = fs.readFileSync(abs, "utf8");
  try {
    const result = fn(original);
    if (result === null) {
      console.log(`~ ${label}: already applied — skipping`);
      skipped++;
      return;
    }
    fs.writeFileSync(abs, result, "utf8");
    console.log(`✓ ${label}: applied`);
    passed++;
  } catch (e) {
    console.error(`✗ ${label}: FAILED — ${e.message}`);
    failed++;
  }
}

// ─── FIX A: Add useCartIsEmpty to store.ts ──────────────────────────────────
// Place it right after the useCartItemCount export (same pattern).
// useCartIsEmpty = true when cart has 0 items.
applyFix(
  "FIX A: store.ts — export useCartIsEmpty hook",
  "src/store.ts",
  (src) => {
    if (src.includes("useCartIsEmpty")) return null; // already present

    // Anchor: the line that exports useCartItemCount
    const anchor = /export\s+function\s+useCartItemCount\s*\(\)[^}]+\}/s;
    const m = src.match(anchor);
    if (!m) {
      // Fallback: look for useCartTotal and insert after its closing brace
      const anchor2 = /export\s+function\s+useCartTotal\s*\(\)[^}]+\}/s;
      const m2 = src.match(anchor2);
      if (!m2) throw new Error("Cannot find useCartItemCount or useCartTotal in store.ts");
      return src.replace(
        m2[0],
        m2[0] +
          "\n\nexport function useCartIsEmpty(): boolean {\n" +
          "  return useCartStore((s) => s.cart.items.length === 0);\n" +
          "}"
      );
    }

    return src.replace(
      m[0],
      m[0] +
        "\n\nexport function useCartIsEmpty(): boolean {\n" +
        "  return useCartStore((s) => s.cart.items.length === 0);\n" +
        "}"
    );
  }
);

// ─── FIX B: App.tsx — ensure useCartIsEmpty is in the store import ──────────
// The previous patch may have left it out. If it's missing from the import
// but used in the file body, add it. If it's in the import already, skip.
applyFix(
  "FIX B: App.tsx — ensure useCartIsEmpty is in the store import",
  "src/App.tsx",
  (src) => {
    const inImport = src.match(
      /import\s*\{[^}]*useCartIsEmpty[^}]*\}\s*from\s*['"]\.\/store['"]/
    );
    if (inImport) return null; // already imported

    // Find the store import line and append useCartIsEmpty
    const storeImportRe =
      /import\s*\{([^}]*)\}\s*from\s*['"]\.\/store['"]/;
    const m = src.match(storeImportRe);
    if (!m) throw new Error("Cannot find './store' import in App.tsx");

    const newNames = m[1].trimEnd().replace(/,?\s*$/, "") + ", useCartIsEmpty";
    return src.replace(m[0], m[0].replace(m[1], newNames));
  }
);

// ─── FIX C: App.tsx — remove duplicate cartIsEmpty declaration if present ───
// The previous patch may have left both:
//   const cartIsEmpty = ...    ← local derivation (correct)
//   const cartIsEmpty = useCartIsEmpty()   ← duplicate (error)
// Keep only the `useCartIsEmpty()` call form since that's now the hook.
applyFix(
  "FIX C: App.tsx — replace local cartIsEmpty derivation with hook call",
  "src/App.tsx",
  (src) => {
    // Pattern for the old local derivation: const cartIsEmpty = cartItemCount === 0
    const oldDerivation =
      /const\s+cartIsEmpty\s*=\s*(?:cartItemCount\s*===\s*0|useCartItemCount\(\)\s*===\s*0);?\n?/;

    // Pattern for the hook call already being there
    const hookCall = /const\s+cartIsEmpty\s*=\s*useCartIsEmpty\(\)/;

    if (hookCall.test(src) && !oldDerivation.test(src)) return null; // clean already

    if (hookCall.test(src) && oldDerivation.test(src)) {
      // Both exist — remove the old derivation, keep the hook call
      return src.replace(oldDerivation, "");
    }

    if (!hookCall.test(src)) {
      // Hook call absent — replace the old derivation with the hook call
      if (!oldDerivation.test(src)) {
        // Neither form exists at all — just add the hook call after cartItemCount
        const anchor = /const\s+cartItemCount\s*=\s*useCartItemCount\(\);?\n/;
        if (!anchor.test(src)) {
          throw new Error(
            "Cannot find cartIsEmpty or cartItemCount declaration in App.tsx. " +
            "Please manually change line 2122 to: const cartIsEmpty = useCartIsEmpty();"
          );
        }
        return src.replace(anchor, (m) => m + "  const cartIsEmpty = useCartIsEmpty();\n");
      }
      return src.replace(oldDerivation, "const cartIsEmpty = useCartIsEmpty();\n");
    }

    return null;
  }
);

// ─── summary ────────────────────────────────────────────────────────────────
console.log();
if (failed === 0 && passed > 0) {
  console.log(`✅  Done — ${passed} fix(es) applied. Rebuild with: npm run build`);
} else if (failed === 0) {
  console.log("✅  All fixes were already applied — nothing left to patch.");
} else {
  console.log(`⚠️  ${passed} applied, ${skipped} skipped, ${failed} failed — see errors above.`);
  process.exit(1);
}
