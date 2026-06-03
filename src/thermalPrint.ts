/**
 * thermalPrint.ts  (Android / Capacitor edition) — FIXED
 *
 * Fixes applied for the 57mm BT 4.0 thermal printer:
 *
 *  1. PAPER WIDTH: Printer prints 48mm (57mm roll) — cols changed from 32 to 32
 *     (32 cols is correct for 58mm/57mm; was already 32 but the PaperWidth enum
 *      allowed '80' to be persisted from detectPaperWidth which never matched
 *      57mm names — now defaults correctly to 58).
 *
 *  2. CHUNK SIZE: 57mm BT 4.0 printers have a small BT buffer (~128 bytes max
 *     per write). The old CHUNK was 512 — this causes silent data loss / garbled
 *     output. Fixed to 128 bytes.
 *
 *  3. CHUNK DELAY: BT Classic SPP on low-end printers needs a small inter-chunk
 *     delay (20 ms) or the printer drops data. Added delayMs helper.
 *
 *  4. CUT COMMAND: The old CUT was GS 0x56 0x41 0x03 (partial cut with 3mm).
 *     Many 57mm portables only support GS 0x56 0x00 (full cut) or simply ignore
 *     the cut and expect extra line-feeds. Switched to FEED_AND_CUT which sends
 *     4 LFs then full-cut so the receipt exits the paper slot before cutting.
 *
 *  5. selectAndSavePrinter: Was imported but NEVER CALLED in App.tsx — the
 *     savedPrinter/printerLoading state was declared but orphaned.
 *     printReceipt now falls back to calling selectAndSavePrinter automatically
 *     when no printer is saved, so the first print still prompts the user.
 *
 *  6. nativePrint auto-reconnect: The old code called call.reject() inside the
 *     Kotlin when not connected (see BluetoothPrinterPlugin.kt fix), but the TS
 *     side never retried after a dropped connection during printReceipt.  Now
 *     nativePrint attempts one reconnect before giving up.
 *
 *  7. connectedAddress NOT cleared on closeSocket in Kotlin (see .kt fix) so
 *     the TS side can pass the address on reconnect — harmless here but paired
 *     with the Kotlin fix.
 *
 * Strategy:
 *  - On Android (Capacitor), use the BluetoothPrinterPlugin native bridge.
 *  - On the browser (dev/web), falls back to window.print().
 */

import type { SaleDetail, Settings } from './types';

// ─── ESC/POS byte constants ────────────────────────────────────────────────────
const ESC = 0x1b;
const GS  = 0x1d;

const INIT:          number[] = [ESC, 0x40];
const ALIGN_CENTER:  number[] = [ESC, 0x61, 0x01];
const ALIGN_LEFT:    number[] = [ESC, 0x61, 0x00];
const BOLD_ON:       number[] = [ESC, 0x45, 0x01];
const BOLD_OFF:      number[] = [ESC, 0x45, 0x00];
const DOUBLE_HEIGHT: number[] = [ESC, 0x21, 0x10];
const NORMAL_SIZE:   number[] = [ESC, 0x21, 0x00];
// FIX #4: Use full cut (GS 0x56 0x00) + 4 line feeds before it.
// Old: [GS, 0x56, 0x41, 0x03] — partial cut not supported by many 57mm portables.
const CUT:           number[] = [GS, 0x56, 0x00];
const LF:            number[] = [0x0a];

// ─── Paper width ──────────────────────────────────────────────────────────────
export type PaperWidth = 58 | 80;

const STORAGE_KEY_ADDRESS = 'printer_mac_address';
const STORAGE_KEY_NAME    = 'printer_device_name';
const STORAGE_KEY_WIDTH   = 'printer_paper_width';

function detectPaperWidth(deviceName: string): PaperWidth {
  const n = deviceName.toUpperCase();
  const is80 = /80MM|76MM|3IN|RPP300|RP80|RP-80|PRP-080|PRP080|BIXOLON|TSP100|TSP650|TM-T88|TM-T20/.test(n);
  return is80 ? 80 : 58; // 57mm printer → defaults to 58 (correct)
}

// ─── Persistent printer state ─────────────────────────────────────────────────
export interface SavedPrinter {
  address: string;
  name: string;
  width: PaperWidth;
}

export function getSavedPrinter(): SavedPrinter | null {
  const address = localStorage.getItem(STORAGE_KEY_ADDRESS);
  const name    = localStorage.getItem(STORAGE_KEY_NAME);
  const width   = localStorage.getItem(STORAGE_KEY_WIDTH);
  if (!address || !name) return null;
  return {
    address,
    name,
    width: (width === '80' ? 80 : 58) as PaperWidth,
  };
}

export function savePrinter(printer: SavedPrinter): void {
  localStorage.setItem(STORAGE_KEY_ADDRESS, printer.address);
  localStorage.setItem(STORAGE_KEY_NAME,    printer.name);
  localStorage.setItem(STORAGE_KEY_WIDTH,   String(printer.width));
}

export function forgetPrinter(): void {
  localStorage.removeItem(STORAGE_KEY_ADDRESS);
  localStorage.removeItem(STORAGE_KEY_NAME);
  localStorage.removeItem(STORAGE_KEY_WIDTH);
}

export function getCachedPaperWidth(): PaperWidth | null {
  const saved = getSavedPrinter();
  return saved ? saved.width : null;
}

// ─── Capacitor / native bridge detection ──────────────────────────────────────
interface BluetoothPrinterPlugin {
  listPaired():                 Promise<{ devices: { name: string; address: string }[] }>;
  connect(opts: { address: string }): Promise<{ success: boolean; error?: string }>;
  disconnect():                 Promise<void>;
  print(opts: { data: number[] }): Promise<{ success: boolean; error?: string }>;
  isConnected():                Promise<{ connected: boolean }>;
}

function getNativePlugin(): BluetoothPrinterPlugin | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cap = (window as any).Capacitor;
  if (!cap?.Plugins?.BluetoothPrinter) return null;
  return cap.Plugins.BluetoothPrinter as BluetoothPrinterPlugin;
}

// ─── ESC/POS builder helpers ──────────────────────────────────────────────────
function mergeBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.byteLength; }
  return out;
}

function cmd(...seqs: number[][]): Uint8Array {
  const flat: number[] = [];
  for (const s of seqs) flat.push(...s);
  return new Uint8Array(flat);
}

function txt(s: string): Uint8Array { return new TextEncoder().encode(s); }
function line(s = ''): Uint8Array   { return txt(s + '\n'); }

function columns(left: string, right: string, width: number): string {
  const gap = width - left.length - right.length;
  if (gap > 0) return left + ' '.repeat(gap) + right;
  return left.slice(0, width - right.length - 1) + ' ' + right;
}

function dashes(n: number): string { return '-'.repeat(n); }

// FIX #3: delay helper for inter-chunk pacing on slow BT printers
function delayMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── ESC/POS receipt builder ──────────────────────────────────────────────────
function buildReceipt(sale: SaleDetail, settings: Settings, width: PaperWidth): Uint8Array {
  // FIX #1: 57mm paper → 32 cols (print width 48mm ÷ ~1.5mm/char ≈ 32 chars)
  // 80mm paper → 48 cols. This was already correct but now explicitly documented.
  const cols = width === 80 ? 48 : 32;

  const fmtMoney = (n: number) => `P${n.toFixed(2)}`;
  const fmtDate  = (iso: string) => {
    try {
      const d = new Date(iso);
      return (
        d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) +
        ' ' +
        d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
      );
    } catch { return iso; }
  };

  const parts: Uint8Array[] = [];
  const p = (...u: Uint8Array[]) => parts.push(...u);

  p(cmd(INIT));
  p(cmd(ALIGN_CENTER), cmd(BOLD_ON), cmd(DOUBLE_HEIGHT));
  p(line(settings.store_name || 'Mango Warrior'));
  p(cmd(NORMAL_SIZE), cmd(BOLD_OFF));
  if (settings.store_address) p(line(settings.store_address));
  if (settings.store_contact) p(line(settings.store_contact));
  p(cmd(ALIGN_LEFT));
  p(line(dashes(cols)));

  p(line(columns('Receipt:', sale.receipt_number,     cols)));
  p(line(columns('Cashier:', sale.cashier_name,        cols)));
  p(line(columns('Date:',    fmtDate(sale.created_at), cols)));
  if (sale.note) p(line(columns('Note:', sale.note,    cols)));
  p(line(dashes(cols)));

  for (const item of sale.items) {
    const label = `${item.qty}x ${item.item_name}${item.size_name ? ` (${item.size_name})` : ''}`;
    p(cmd(BOLD_ON));
    p(line(columns(label, fmtMoney(item.final_price), cols)));
    p(cmd(BOLD_OFF));
    for (const a of item.addons) {
      p(line(columns(`  + ${a.addon_name} x${a.qty}`, fmtMoney(a.addon_price * a.qty), cols)));
    }
    if (item.discount_amount > 0) {
      p(line(columns(`  ${(item.discount_type ?? 'DISC').toUpperCase()} Disc`, `-${fmtMoney(item.discount_amount)}`, cols)));
    }
  }

  p(line(dashes(cols)));

  p(line(columns('Subtotal:', fmtMoney(sale.subtotal), cols)));
  if (sale.discount_total > 0) {
    p(line(columns('Discount:', `-${fmtMoney(sale.discount_total)}`, cols)));
  }
  p(cmd(BOLD_ON));
  p(line(columns('TOTAL:', fmtMoney(sale.total), cols)));
  p(cmd(BOLD_OFF));
  for (const pay of sale.payments) {
    p(line(columns(`${pay.method.toUpperCase()}:`, fmtMoney(pay.amount), cols)));
  }
  if (sale.change_amount != null && sale.change_amount > 0) {
    p(line(columns('Change:', fmtMoney(sale.change_amount), cols)));
  }

  p(line(dashes(cols)));
  p(cmd(ALIGN_CENTER));
  p(line(settings.receipt_footer || 'Thank you!'));
  if (sale.sale_type === 'missed') {
    p(cmd(BOLD_ON), line('*** MISSED SALE ***'), cmd(BOLD_OFF));
  }

  // FIX #4: 4 line feeds to advance paper past cutter, then full-cut
  p(cmd(LF), cmd(LF), cmd(LF), cmd(LF), cmd(CUT));

  return mergeBytes(parts);
}

// ─── Native print via Capacitor plugin ───────────────────────────────────────
// FIX #2 + FIX #3: chunk size reduced to 128 bytes, 20ms delay between chunks
const BT_CHUNK_SIZE = 128; // 57mm BT 4.0 printer max safe write size
const BT_CHUNK_DELAY_MS = 20; // pause between chunks so printer buffer doesn't overflow

async function nativePrint(data: Uint8Array, address: string): Promise<boolean> {
  const plugin = getNativePlugin();
  if (!plugin) return false;

  try {
    // FIX #6: Check connection and reconnect if needed before sending data
    const { connected } = await plugin.isConnected();
    if (!connected) {
      const r = await plugin.connect({ address });
      if (!r.success) {
        console.warn('[ThermalPrint] Connect failed:', r.error);
        return false;
      }
      // Give the printer 300ms to stabilise after reconnect
      await delayMs(300);
    }

    // FIX #2 + FIX #3: Send in small chunks with inter-chunk delay
    const bytes = Array.from(data);
    for (let i = 0; i < bytes.length; i += BT_CHUNK_SIZE) {
      const chunk = bytes.slice(i, i + BT_CHUNK_SIZE);
      const result = await plugin.print({ data: chunk });
      if (!result.success) {
        console.warn('[ThermalPrint] Print chunk failed:', result.error);
        return false;
      }
      if (i + BT_CHUNK_SIZE < bytes.length) {
        await delayMs(BT_CHUNK_DELAY_MS);
      }
    }
    return true;
  } catch (err) {
    console.warn('[ThermalPrint] Native print error:', err);
    return false;
  }
}

// ─── Web Bluetooth fallback (browser dev mode only) ──────────────────────────
const SPP_SERVICE = '00001101-0000-1000-8000-00805f9b34fb';
let _webDevice: BluetoothDevice | null = null;

async function webBluetoothPrint(data: Uint8Array): Promise<boolean> {
  const btAvailable =
    typeof navigator !== 'undefined' &&
    'bluetooth' in navigator &&
    typeof (navigator as unknown as { bluetooth?: { requestDevice: unknown } }).bluetooth?.requestDevice === 'function';

  if (!btAvailable) return false;

  try {
    const nav = navigator as unknown as { bluetooth: { requestDevice: (o: unknown) => Promise<BluetoothDevice> } };

    if (!_webDevice || !_webDevice.gatt) {
      _webDevice = await nav.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [SPP_SERVICE],
      });
      const w = detectPaperWidth(_webDevice.name ?? '');
      savePrinter({ address: (_webDevice as unknown as { id: string }).id, name: _webDevice.name ?? '', width: w });
    }

    const server = await _webDevice.gatt!.connect();
    let service: BluetoothRemoteGATTService | null = null;
    try {
      service = await server.getPrimaryService(SPP_SERVICE);
    } catch {
      const all = await server.getPrimaryServices();
      service = all[0] ?? null;
    }
    if (!service) throw new Error('No GATT service');

    const chars = await service.getCharacteristics();
    const writable = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
    if (!writable) throw new Error('No writable characteristic');

    // FIX #2 + #3 applied to web BT path too
    for (let i = 0; i < data.byteLength; i += BT_CHUNK_SIZE) {
      const slice = data.slice(i, i + BT_CHUNK_SIZE);
      if (writable.properties.writeWithoutResponse) {
        await writable.writeValueWithoutResponse(slice);
      } else {
        await writable.writeValue(slice);
      }
      if (i + BT_CHUNK_SIZE < data.byteLength) {
        await delayMs(BT_CHUNK_DELAY_MS);
      }
    }
    return true;
  } catch (err) {
    console.warn('[ThermalPrint] Web Bluetooth failed:', err);
    return false;
  }
}

// ─── CSS window.print() final fallback ───────────────────────────────────────
function windowPrintFallback(paperWidth: PaperWidth): void {
  const mmWidth = paperWidth === 80 ? '80mm' : '58mm';
  const styleId = '__thermal_print_style__';
  let el = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = styleId;
    document.head.appendChild(el);
  }
  el.textContent = `
    @media print {
      @page { size: ${mmWidth} auto; margin: 0; }
      body > * { visibility: hidden !important; }
      #receipt-print, #receipt-print * { visibility: visible !important; }
      #receipt-print {
        position: fixed !important;
        left: 0 !important; top: 0 !important;
        width: ${mmWidth} !important;
        max-width: ${mmWidth} !important;
        padding: 4px !important;
        font-size: 11px !important;
        font-family: 'Courier New', Courier, monospace !important;
        line-height: 1.4 !important;
      }
    }
  `;
  window.print();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Print a receipt.
 *
 * FIX #5: If no printer is saved yet, automatically calls selectAndSavePrinter
 * so the user is prompted to pick their printer on the very first print.
 * Subsequent prints reconnect silently.
 */
export async function printReceipt(sale: SaleDetail, settings: Settings): Promise<void> {
  let saved = getSavedPrinter();
  const plugin = getNativePlugin();

  // FIX #5: Auto-prompt on first use when running on Android and no printer saved
  if (plugin && !saved) {
    saved = await selectAndSavePrinter();
    if (!saved) {
      // User cancelled the picker — fall through to window.print
      windowPrintFallback(58);
      return;
    }
  }

  const width: PaperWidth = saved?.width ?? 58;
  const data = buildReceipt(sale, settings, width);

  if (plugin && saved) {
    const ok = await nativePrint(data, saved.address);
    if (ok) return;
    // Native failed — fall through to window.print
  }

  if (!plugin) {
    const ok = await webBluetoothPrint(data);
    if (ok) return;
  }

  windowPrintFallback(width);
}

/**
 * Prompt the user once to select a paired Bluetooth printer and save it.
 * On Android (Capacitor): shows a list of paired devices from the native plugin.
 * In browser: falls back to Web Bluetooth requestDevice picker.
 *
 * Returns the saved printer info, or null if cancelled.
 */
export async function selectAndSavePrinter(): Promise<SavedPrinter | null> {
  const plugin = getNativePlugin();

  if (plugin) {
    try {
      const { devices } = await plugin.listPaired();
      if (!devices.length) {
        alert('No paired Bluetooth devices found. Please pair your printer in Android Settings first.');
        return null;
      }

      const lines = devices.map((d, i) => `${i + 1}. ${d.name} (${d.address})`).join('\n');
      const idx = parseInt(prompt(`Select printer:\n${lines}`) ?? '', 10);
      if (isNaN(idx) || idx < 1 || idx > devices.length) return null;

      const chosen = devices[idx - 1];
      const r = await plugin.connect({ address: chosen.address });
      if (!r.success) {
        alert(`Could not connect: ${r.error ?? 'unknown error'}`);
        return null;
      }

      const saved: SavedPrinter = {
        address: chosen.address,
        name:    chosen.name,
        width:   detectPaperWidth(chosen.name),
      };
      savePrinter(saved);
      return saved;
    } catch (err) {
      console.warn('[ThermalPrint] selectAndSavePrinter error:', err);
      return null;
    }
  }

  // Browser fallback
  try {
    const nav = navigator as unknown as { bluetooth?: { requestDevice: (o: unknown) => Promise<BluetoothDevice> } };
    if (!nav.bluetooth) return null;

    const device = await nav.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [SPP_SERVICE],
    });
    const saved: SavedPrinter = {
      address: (device as unknown as { id: string }).id,
      name:    device.name ?? 'Unknown',
      width:   detectPaperWidth(device.name ?? ''),
    };
    savePrinter(saved);
    return saved;
  } catch {
    return null;
  }
}

/**
 * On app open, silently try to reconnect to the saved printer.
 * Call this once in App.tsx on mount.
 */
export async function autoReconnectPrinter(): Promise<void> {
  const plugin = getNativePlugin();
  const saved  = getSavedPrinter();
  if (!plugin || !saved) return;

  try {
    const { connected } = await plugin.isConnected();
    if (!connected) {
      await plugin.connect({ address: saved.address });
    }
  } catch {
    // Silent — the printer might be off, that's fine; we reconnect on print
  }
}

// Re-export for legacy callers
export { detectPaperWidth };