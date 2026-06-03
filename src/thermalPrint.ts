/**
 * thermalPrint.ts  (Android / Capacitor edition)
 *
 * Strategy:
 *  - On Android (Capacitor), use the BluetoothPrinterPlugin native bridge.
 *    • The printer MAC + name is persisted in localStorage so the app
 *      auto-reconnects on every open — NO picker dialog on subsequent prints.
 *    • On the very first print (no saved printer), the picker is shown once.
 *  - On the browser (dev/web), falls back to window.print() so you can still
 *    develop in the browser without changes.
 *
 * Native plugin contract (android/app/src/.../BluetoothPrinterPlugin.kt):
 *   listPaired()          → { devices: [{ name, address }] }
 *   connect(address)      → { success: boolean, error?: string }
 *   disconnect()          → void
 *   print(data: number[]) → { success: boolean, error?: string }
 *   isConnected()         → { connected: boolean }
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
const CUT:           number[] = [GS,  0x56, 0x41, 0x03];
const LF:            number[] = [0x0a];

// ─── Paper width ──────────────────────────────────────────────────────────────
export type PaperWidth = 58 | 80;

const STORAGE_KEY_ADDRESS = 'printer_mac_address';
const STORAGE_KEY_NAME    = 'printer_device_name';
const STORAGE_KEY_WIDTH   = 'printer_paper_width';

function detectPaperWidth(deviceName: string): PaperWidth {
  const n = deviceName.toUpperCase();
  const is80 = /80MM|76MM|3IN|RPP300|RP80|RP-80|PRP-080|PRP080|BIXOLON|TSP100|TSP650|TM-T88|TM-T20/.test(n);
  return is80 ? 80 : 58;
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

// ─── ESC/POS receipt builder ──────────────────────────────────────────────────
function buildReceipt(sale: SaleDetail, settings: Settings, width: PaperWidth): Uint8Array {
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

  p(cmd(LF), cmd(LF), cmd(LF), cmd(LF), cmd(CUT));

  return mergeBytes(parts);
}

// ─── Native print via Capacitor plugin ───────────────────────────────────────
async function nativePrint(data: Uint8Array, address: string): Promise<boolean> {
  const plugin = getNativePlugin();
  if (!plugin) return false;

  try {
    // Check if already connected; if not, reconnect silently
    const { connected } = await plugin.isConnected();
    if (!connected) {
      const r = await plugin.connect({ address });
      if (!r.success) {
        console.warn('[ThermalPrint] Connect failed:', r.error);
        return false;
      }
    }

    const result = await plugin.print({ data: Array.from(data) });
    if (!result.success) {
      console.warn('[ThermalPrint] Print failed:', result.error);
      return false;
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

    const CHUNK = 512;
    for (let i = 0; i < data.byteLength; i += CHUNK) {
      const slice = data.slice(i, i + CHUNK);
      if (writable.properties.writeWithoutResponse) {
        await writable.writeValueWithoutResponse(slice);
      } else {
        await writable.writeValue(slice);
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
 * Print a receipt. On Android (Capacitor) it silently reconnects to the saved
 * printer and prints directly — no dialog. Falls back to window.print() when
 * no native plugin is present.
 */
export async function printReceipt(sale: SaleDetail, settings: Settings): Promise<void> {
  const saved = getSavedPrinter();
  const width: PaperWidth = saved?.width ?? 58;
  const data = buildReceipt(sale, settings, width);

  const plugin = getNativePlugin();

  if (plugin && saved) {
    const ok = await nativePrint(data, saved.address);
    if (ok) return;
    // If the saved printer failed, fall through to web BT or window.print
  }

  if (!plugin) {
    // Running in browser (dev) — try Web Bluetooth first
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

      // Build a simple picker — callers (App.tsx) should show a proper modal,
      // but as a safe fallback we use a basic prompt.
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