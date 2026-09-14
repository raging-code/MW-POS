#!/usr/bin/env node
/**
 * hide-addons-category-card.mjs
 *
 * Problem:
 *   In SalesByItemPanel (src/App.tsx), the "Sales by Item" report renders
 *   TWO cards that both look like they report on add-ons:
 *     1. A per-category detail card for the "Add-ons" menu category
 *        (from report.categories) — shows standalone Add-ons *menu items*
 *        sold on their own, e.g. { item: "Add-ons", Nata: 1 }.
 *     2. An "Add-ons sold" card (from report.addons) — shows real addon
 *        attachments across all drinks, e.g. Nata: 2, Pearl: 3.
 *
 *   These count fundamentally different things and will never match,
 *   which reads as a bug even though it isn't one. Since the "Add-ons
 *   sold" card already covers real addon reporting, card #1 is
 *   redundant noise and gets hidden.
 *
 * Fix:
 *   Filter the "Add-ons" category out of the report.categories.map(...)
 *   loop in SalesByItemPanel, so only the "Add-ons sold" card renders.
 *
 * Usage:
 *   node hide-addons-category-card.mjs <path-to-App.tsx>
 *   node hide-addons-category-card.mjs src/App.tsx
 *
 *   - Idempotent: running it twice is a no-op the second time.
 *   - Exits non-zero with a clear message if the expected line isn't
 *     found (e.g. file already patched differently, or code moved).
 */

import { readFile, writeFile } from "node:fs/promises";

const TARGET_LINE = "{report.categories.map(cat => {";
const REPLACEMENT_LINE =
  "{report.categories.filter(cat => cat.category_name !== 'Add-ons').map(cat => {";

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error("Usage: node hide-addons-category-card.mjs <path-to-App.tsx>");
    process.exit(1);
  }

  const original = await readFile(filePath, "utf8");

  if (original.includes(REPLACEMENT_LINE)) {
    console.error("Already patched — no changes made.");
    return;
  }

  const occurrences = original.split(TARGET_LINE).length - 1;

  if (occurrences === 0) {
    console.error(
      `Could not find the expected line:\n  ${TARGET_LINE}\n` +
        `File may have changed. No changes made — please patch manually.`
    );
    process.exit(1);
  }

  if (occurrences > 1) {
    console.error(
      `Found ${occurrences} matches for the target line — expected exactly 1.\n` +
        `Refusing to guess which one to patch. No changes made.`
    );
    process.exit(1);
  }

  const patched = original.replace(TARGET_LINE, REPLACEMENT_LINE);

  await writeFile(filePath, patched, "utf8");
  console.error(`Patched ${filePath}: "Add-ons" category card hidden from Sales by Item report.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
