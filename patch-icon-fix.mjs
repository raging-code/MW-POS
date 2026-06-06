#!/usr/bin/env node
// patch-icon-fix.mjs
// Place this in your project root (same folder as package.json) and run:
//   node patch-icon-fix.mjs

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC  = path.join(ROOT, "public/web-app-manifest-512x512.png"); // clean white bg icon
const BASE = path.join(ROOT, "android/app/src/main/res");

if (!fs.existsSync(SRC)) {
  console.error("✖  public/web-app-manifest-512x512.png not found. Run this from the project root.");
  process.exit(1);
}

function getPython() {
  for (const bin of ["python", "python3"]) {
    const r = spawnSync(bin, ["-c", "from PIL import Image; print('ok')"], { stdio: "pipe" });
    if (r.status === 0) return bin;
  }
  return null;
}

const pyBin = getPython();
if (!pyBin) {
  console.error("✖  Pillow not found. Run:  python -m pip install Pillow");
  process.exit(1);
}

const script = `
import os, shutil
from PIL import Image

src  = Image.open(r"${SRC.replace(/\\/g,"/")}").convert("RGBA")
base = r"${BASE.replace(/\\/g,"/")}"
print(f"  Source: {src.size[0]}x{src.size[1]} px")

# mipmap ic_launcher + ic_launcher_round (API < 26)
for density, px in [
    ("mipmap-mdpi",48),("mipmap-hdpi",72),("mipmap-xhdpi",96),
    ("mipmap-xxhdpi",144),("mipmap-xxxhdpi",192)
]:
    folder = os.path.join(base, density)
    img = src.resize((px, px), Image.LANCZOS)
    img.save(os.path.join(folder, "ic_launcher.png"))
    img.save(os.path.join(folder, "ic_launcher_round.png"))
    print(f"  ✔  {density}/ic_launcher.png ({px}x{px})")

# mipmap ic_launcher_foreground (adaptive icon API 26+)
for density, px in [
    ("mipmap-mdpi",108),("mipmap-hdpi",162),("mipmap-xhdpi",216),
    ("mipmap-xxhdpi",324),("mipmap-xxxhdpi",432)
]:
    folder = os.path.join(base, density)
    img = src.resize((px, px), Image.LANCZOS)
    img.save(os.path.join(folder, "ic_launcher_foreground.png"))
    print(f"  ✔  {density}/ic_launcher_foreground.png ({px}x{px})")

# drawable-v24: remove old vector XML, replace with real PNG
for old in ["ic_launcher_foreground.xml", "ic_launcher_foreground.xml.bak"]:
    p = os.path.join(base, "drawable-v24", old)
    if os.path.exists(p):
        os.remove(p)
        print(f"  ✔  Removed drawable-v24/{old}")

shutil.copy(
    os.path.join(base, "mipmap-xxxhdpi/ic_launcher_foreground.png"),
    os.path.join(base, "drawable-v24/ic_launcher_foreground.png")
)
print("  ✔  Copied to drawable-v24/ic_launcher_foreground.png")
`;

console.log("\n── Applying icon fix ────────────────────────────────────────────────────");
const result = spawnSync(pyBin, ["-c", script], { stdio: "inherit" });
if (result.status !== 0) process.exit(1);

console.log(`
────────────────────────────────────────────────────────────
  ✅  Icon fix applied!

  Next steps:
    1. npm run build
    2. npx cap sync android
    3. cd android && ./gradlew clean assembleRelease
    4. UNINSTALL the old APK from your phone first, then reinstall
────────────────────────────────────────────────────────────
`);
