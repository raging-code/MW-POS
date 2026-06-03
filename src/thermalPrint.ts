/**
 * thermalPrint.ts
 *
 * Direct Bluetooth thermal printer support for MW-POS.
 *
 * Flow:
 *  1. On first print, request a paired Bluetooth device from the browser.
 *  2. Detect paper width (58 mm vs 80 mm) from the device name.
 *  3. Connect via GATT/SPP and send ESC/POS bytes.
 *  4. If Bluetooth is unavailable or the user cancels, fall back to
 *     window.print() with a dynamically injected @page CSS sized to the
 *     correct paper width.
 *
 * The resolved paper width is cached for the session so subsequent prints
 * skip the device-picker dialog.
 */

import type { SaleDetail, Settings } from './types';

// ─── ESC/POS byte helpers ─────────────────────────────────────────────────────
const ESC = 0x1b;
const GS  = 0x1d;

// Use mutable arrays so TypeScript is happy with the spread later
const INIT:          number[] = [ESC, 0x40];
const ALIGN_CENTER:  number[] = [ESC, 0x61, 0x01];
const ALIGN_LEFT:    number[] = [ESC, 0x61, 0x00];
const BOLD_ON:       number[] = [ESC, 0x45, 0x01];
const BOLD_OFF:      number[] = [ESC, 0x45, 0x00];
const DOUBLE_HEIGHT: number[] = [ESC, 0x21, 0x10];
const NORMAL_SIZE:   number[] = [ESC, 0x21, 0x00];
const CUT:           number[] = [GS,  0x56, 0x41, 0x03];
const LF:            number[] = [0x0a];

// Bluetooth SPP service UUID
const SPP_SERVICE = '00001101-0000-1000-8000-00805f9b34fb';

// ─── Paper width ──────────────────────────────────────────────────────────────
export type PaperWidth = 58 | 80;

/** Infer paper width from Bluetooth device name. Falls back to 58 mm. */
function detectPaperWidth(deviceName: string): PaperWidth {
  const n = deviceName.toUpperCase();
  const is80 = /80MM|76MM|3IN|RPP300|RP80|RP-80|PRP-080|PRP080|BIXOLON|TSP100|TSP650|TM-T88|TM-T20/.test(n);
  return is80 ? 80 : 58;
}

// ─── Session cache ────────────────────────────────────────────────────────────
let _device: BluetoothDevice | null = null;
let _width:  PaperWidth | null = null;

export function getCachedPaperWidth(): PaperWidth | null { return _width; }

export function forgetPrinter(): void {
  _device = null;
  _width  = null;
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

// ─── ESC/POS receipt ──────────────────────────────────────────────────────────
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

  // Init + header
  p(cmd(INIT));
  p(cmd(ALIGN_CENTER), cmd(BOLD_ON), cmd(DOUBLE_HEIGHT));
  p(line(settings.store_name || 'Mango Warrior'));
  p(cmd(NORMAL_SIZE), cmd(BOLD_OFF));
  if (settings.store_address) p(line(settings.store_address));
  if (settings.store_contact) p(line(settings.store_contact));
  p(cmd(ALIGN_LEFT));
  p(line(dashes(cols)));

  // Meta
  p(line(columns('Receipt:', sale.receipt_number,     cols)));
  p(line(columns('Cashier:', sale.cashier_name,        cols)));
  p(line(columns('Date:',    fmtDate(sale.created_at), cols)));
  if (sale.note) p(line(columns('Note:', sale.note,    cols)));
  p(line(dashes(cols)));

  // Items
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

  // Totals
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

  // Footer
  p(cmd(ALIGN_CENTER));
  p(line(settings.receipt_footer || 'Thank you!'));
  if (sale.sale_type === 'missed') {
    p(cmd(BOLD_ON), line('*** MISSED SALE ***'), cmd(BOLD_OFF));
  }

  // Feed + cut
  p(cmd(LF), cmd(LF), cmd(LF), cmd(LF), cmd(CUT));

  return mergeBytes(parts);
}

// ─── Bluetooth sender ─────────────────────────────────────────────────────────
async function sendBluetooth(data: Uint8Array): Promise<boolean> {
  try {
    if (!_device || !_device.gatt) {
      _device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [SPP_SERVICE],
      });
      _width = detectPaperWidth(_device.name ?? '');
    }

    const server = await _device.gatt!.connect();

    let service: BluetoothRemoteGATTService | null = null;
    try {
      service = await server.getPrimaryService(SPP_SERVICE);
    } catch {
      const all = await server.getPrimaryServices();
      service = all[0] ?? null;
    }
    if (!service) throw new Error('No GATT service found');

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
    console.warn('[ThermalPrint] Bluetooth failed:', err);
    return false;
  }
}

// ─── CSS window.print() fallback ─────────────────────────────────────────────
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
 * Print a receipt directly to the paired Bluetooth thermal printer.
 * Falls back to window.print() if Bluetooth is unavailable or fails.
 */
export async function printReceipt(sale: SaleDetail, settings: Settings): Promise<void> {
  const btAvailable =
    typeof navigator !== 'undefined' &&
    'bluetooth' in navigator &&
    typeof navigator.bluetooth?.requestDevice === 'function';

  if (btAvailable) {
    // Use cached width if known; 58 is default before first pair
    const w: PaperWidth = _width ?? 58;
    const ok = await sendBluetooth(buildReceipt(sale, settings, w));
    if (ok) {
      // If width was just detected for the first time, it may have changed — resend
      if (_width && _width !== w) {
        await sendBluetooth(buildReceipt(sale, settings, _width));
      }
      return;
    }
  }

  // Fallback
  windowPrintFallback(_width ?? 58);
}

/**
 * Prompt the user to select their Bluetooth printer and detect its paper width.
 * Caches the result for the session. Returns the detected width, or null on cancel.
 */
export async function probePaperWidth(): Promise<PaperWidth | null> {
  if (_width) return _width;

  const btAvailable =
    typeof navigator !== 'undefined' &&
    'bluetooth' in navigator &&
    typeof navigator.bluetooth?.requestDevice === 'function';

  if (!btAvailable) return null;

  try {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [SPP_SERVICE],
    });
    _device = device;
    _width  = detectPaperWidth(device.name ?? '');
    return _width;
  } catch {
    return null;
  }
}
