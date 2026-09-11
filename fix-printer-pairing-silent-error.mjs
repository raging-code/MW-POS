#!/usr/bin/env node
// MW-POS patch: surface Bluetooth printer pairing errors to the user
//
// BUG: Tapping "Pair Bluetooth Printer" appeared to do nothing when
// pairing failed (denied Bluetooth permission, Bluetooth turned off,
// native plugin error, etc). This is because selectAndSavePrinter()'s
// catch block in src/thermalPrint.ts only did console.warn(...) — which
// is invisible on a production Android device — and then silently
// returned null. The loading spinner would stop and nothing else would
// happen, with no indication to the user of what went wrong.
//
// FIX: The catch block now also calls the existing showPrinterError()
// toast helper (already used elsewhere in this file for pairing/connect
// failures) with the actual error message, so the user sees exactly why
// pairing failed instead of silence.
//
// This does NOT change plugin registration, permissions, or the Kotlin
// native side — those were checked and are correct. This only fixes the
// silent-failure UX so the real cause becomes visible next time it fails.

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
    if (fs.existsSync(path.join(dir, '.git')) && fs.existsSync(path.join(dir, 'src', 'thermalPrint.ts'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

console.log('MW-POS patch: surface printer pairing errors instead of failing silently\n');

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = findRepoRoot(process.cwd().length > scriptDir.length ? process.cwd() : scriptDir);
log.info(`Repo root: ${repoRoot}`);

const targetPath = path.join(repoRoot, 'src', 'thermalPrint.ts');
if (!fs.existsSync(targetPath)) {
  log.err(`Could not find src/thermalPrint.ts under ${repoRoot}`);
  log.err('Run this script from your MW-POS repo root (same place as add-cash-in.mjs).');
  process.exit(1);
}

console.log('\n=== src/thermalPrint.ts ===\n');

const content = fs.readFileSync(targetPath, 'utf8');

const anchor =
  "    } catch (err) {\n      console.warn('[ThermalPrint] selectAndSavePrinter error:', err);\n      return null;\n    }\n  }";

const already =
  "    } catch (err) {\n      console.warn('[ThermalPrint] selectAndSavePrinter error:', err);\n      const msg = err instanceof Error ? err.message : String(err);\n      showPrinterError(`Pairing failed.\\n${msg || 'Unknown error. Check Bluetooth is on and permission is granted.'}`);\n      return null;\n    }\n  }";

if (content.includes(already)) {
  log.ok('src/thermalPrint.ts already shows a toast on pairing errors.');
  log.info('Nothing to do — patch was already applied.');
  process.exit(0);
}

if (!content.includes(anchor)) {
  log.err('Could not find the expected catch block in selectAndSavePrinter().');
  log.err('The file may have changed since this patch was written.');
  log.info('No changes made. Please check src/thermalPrint.ts manually around selectAndSavePrinter().');
  process.exit(1);
}

const fixed = content.replace(anchor, already);

const backupPath = `${targetPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.writeFileSync(backupPath, content, 'utf8');
fs.writeFileSync(targetPath, fixed, 'utf8');

console.log('-- selectAndSavePrinter() catch block — show a toast with the real error');
console.log('   instead of only console.warn() + silent return null');
log.ok(`Wrote src${path.sep}thermalPrint.ts (backup: ${path.relative(repoRoot, backupPath)})`);

console.log('\n✔ Patch completed successfully.');
log.info('Next steps:');
log.info('  1. npm run build');
log.info('  2. Rebuild the Android app: cd android && .\\gradlew clean assembleRelease');
log.info('  3. Reinstall and tap "Pair Bluetooth Printer" again — if it still fails,');
log.info('     you will now see a red toast with the actual reason (e.g. permission');
log.info('     denied, Bluetooth off). Send that exact message for further diagnosis.');
