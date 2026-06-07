/**
 * thermalPrint.ts  (Android / Capacitor edition)
 *
 * Fixes in this file:
 *
 *  1. PAPER WIDTH: 57mm roll → 32 cols. Correct and unchanged.
 *
 *  2. CHUNK SIZE: 128 bytes per write. Correct and unchanged.
 *
 *  3. CHUNK DELAY: 20ms between chunks. Correct and unchanged.
 *
 *  4. CUT COMMAND: GS 0x56 0x00 (full cut) + 4 LFs. Correct and unchanged.
 *
 *  5. selectAndSavePrinter auto-called on first print. Correct and unchanged.
 *
 *  6. nativePrint auto-reconnect via isConnected() before chunked send.
 *     isConnected() now uses a live probe on the Kotlin side (FIX F in .kt),
 *     so it correctly detects a dropped connection instead of trusting the
 *     stale socket.isConnected flag.
 *
 *  7. connectedAddress preserved across socket close (Kotlin FIX A). Unchanged.
 *
 *  8. DOM-based printer picker modal replaces window.prompt() / window.alert().
 *     Capacitor WebView blocks both silently on Android. Unchanged.
 *
 *  NEW FIX 9 — printReceipt() shows a visible error toast on Android when
 *     native printing fails instead of silently falling through to window.print()
 *     (which does nothing useful inside a Capacitor WebView). The user now sees
 *     "Printing failed — check your Bluetooth printer" rather than nothing.
 *
 *  NEW FIX 10 — autoReconnectPrinter() skips the isConnected() check and always
 *     calls connect() on startup. The old isConnected() guard was based on the
 *     stale socket state and would often skip a needed reconnect on app resume.
 *     Now it always attempts connect() silently on mount; the Kotlin side handles
 *     the case where it is already connected gracefully.
 *
 * Strategy:
 *  - On Android (Capacitor), use the BluetoothPrinterPlugin native bridge.
 *  - On the browser (dev/web), falls back to Web Bluetooth → window.print().
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
const CUT:           number[] = [GS, 0x56, 0x00];   // full cut
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
  listPaired():                       Promise<{ devices: { name: string; address: string }[] }>;
  connect(opts: { address: string }): Promise<{ success: boolean; error?: string }>;
  disconnect():                       Promise<void>;
  print(opts: { data: number[] }):    Promise<{ success: boolean; error?: string }>;
  isConnected():                      Promise<{ connected: boolean }>;
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
  // Fix: clamp the slice start to 0 so we never pass a negative index when
  // right.length >= width (e.g. very long addon names on 32-col paper).
  // Also ensure the combined result never exceeds `width`.
  const maxLeft = Math.max(0, width - right.length - 1);
  return left.slice(0, maxLeft) + ' ' + right;
}
 
function dashes(n: number): string { return '-'.repeat(n); }
 
/**
 * Word-wrap a string to fit within `width` columns.
 * Splits only on spaces so whole words always stay together —
 * no mid-word breaks like "Mani\nla".
 * Returns an array of lines, each at most `width` chars long.
 */
function wordWrap(s: string, width: number): string[] {
  const words = s.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
 
function delayMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
 
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
  if (settings.store_address) {
    for (const wline of wordWrap(settings.store_address, cols)) p(line(wline));
  }
  p(cmd(ALIGN_LEFT));
  p(line(dashes(cols)));
 
p(line(columns('Receipt:', sale.receipt_number,     cols)));
p(line(columns('Cashier:', sale.cashier_name,        cols)));
p(line(columns('Date:',    fmtDate(sale.created_at), cols)));
// Fix 4: print the order type so kitchen/front-of-house know dine-in vs take-out
p(line(columns('Order:',   sale.order_type === 'take_out' ? 'Take Out' : 'Dine In', cols)));
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
 
  // Extra blank lines after footer so the text clears the cutter blade,
  // then 4 line feeds to advance paper past the cutter, then full-cut.
  p(cmd(LF), cmd(LF), cmd(LF), cmd(LF), cmd(LF), cmd(LF), cmd(CUT));
 
  return mergeBytes(parts);
}
 
// ─── Native print via Capacitor plugin ───────────────────────────────────────
const BT_CHUNK_SIZE     = 128; // 57mm BT 4.0 printer max safe write size
const BT_CHUNK_DELAY_MS = 20;  // pause between chunks so printer buffer doesn't overflow
 
async function nativePrint(data: Uint8Array, address: string): Promise<boolean> {
  const plugin = getNativePlugin();
  if (!plugin) return false;
 
  try {
    // isConnected() now uses a live probe on the Kotlin side (FIX F),
    // so this correctly detects a dropped connection even if the socket
    // object still exists.
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
 
    // Send in small chunks with inter-chunk delay so the printer's small
    // receive buffer (common on cheap BT 4.0 57mm models) does not overflow.
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
 
// ─── FIX 8: DOM-based printer picker modal (replaces prompt() / alert()) ─────
//
// Capacitor's WebView does not forward window.prompt() or window.alert() to the
// Activity's WebChromeClient by default, so both calls silently return null/void.
// This function creates a real DOM overlay and resolves a Promise when the user
// picks a device or taps Cancel — no external libraries required.
 
interface PickerDevice { name: string; address: string; }
 
function showPrinterPickerModal(devices: PickerDevice[]): Promise<PickerDevice | null> {
  return new Promise(resolve => {
    // ── Overlay backdrop ──────────────────────────────────────────────────
    const backdrop = document.createElement('div');
    backdrop.style.cssText = [
      'position:fixed;inset:0;z-index:99999;',
      'background:rgba(0,0,0,0.45);backdrop-filter:blur(4px);',
      'display:flex;align-items:center;justify-content:center;padding:16px;',
    ].join('');
 
    // ── Card ──────────────────────────────────────────────────────────────
    const card = document.createElement('div');
    card.style.cssText = [
      'background:#fff;border-radius:20px;width:100%;max-width:360px;',
      'box-shadow:0 20px 60px rgba(0,0,0,0.25);overflow:hidden;',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
    ].join('');
 
    // ── Header ────────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.style.cssText = 'padding:18px 20px 14px;border-bottom:1px solid #f0f0f0;';
    header.innerHTML = [
      '<p style="margin:0;font-size:16px;font-weight:700;color:#111;">',
      '🖨️ Select Bluetooth Printer</p>',
      '<p style="margin:4px 0 0;font-size:12px;color:#888;">',
      'Choose from your paired devices</p>',
    ].join('');
 
    // ── Device list ───────────────────────────────────────────────────────
    const list = document.createElement('div');
    list.style.cssText = 'max-height:280px;overflow-y:auto;padding:8px 0;';
 
    devices.forEach(dev => {
      const row = document.createElement('button');
      row.type = 'button';
      row.style.cssText = [
        'display:flex;align-items:center;gap:12px;width:100%;',
        'padding:12px 20px;border:none;background:transparent;cursor:pointer;',
        'text-align:left;transition:background 0.15s;',
      ].join('');
      row.onmouseenter = () => { row.style.background = '#fafafa'; };
      row.onmouseleave = () => { row.style.background = 'transparent'; };
 
      row.innerHTML = [
        '<div style="width:36px;height:36px;border-radius:50%;background:#f0fdf4;',
        'border:1px solid #bbf7d0;display:flex;align-items:center;justify-content:center;',
        'font-size:18px;flex-shrink:0;">🖨️</div>',
        '<div style="flex:1;min-width:0;">',
        `<p style="margin:0;font-size:13px;font-weight:600;color:#111;`,
        `white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(dev.name)}</p>`,
        `<p style="margin:2px 0 0;font-size:11px;color:#aaa;font-family:monospace;">${escapeHtml(dev.address)}</p>`,
        '</div>',
      ].join('');
 
      row.addEventListener('click', () => { cleanup(); resolve(dev); });
      list.appendChild(row);
    });
 
    // ── Cancel button ─────────────────────────────────────────────────────
    const footer = document.createElement('div');
    footer.style.cssText = 'padding:12px 20px 18px;border-top:1px solid #f0f0f0;';
 
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = [
      'width:100%;padding:11px;border-radius:12px;border:1px solid #e5e7eb;',
      'background:#fff;font-size:14px;font-weight:600;color:#374151;cursor:pointer;',
      'transition:background 0.15s;',
    ].join('');
    cancelBtn.onmouseenter = () => { cancelBtn.style.background = '#f9fafb'; };
    cancelBtn.onmouseleave = () => { cancelBtn.style.background = '#fff'; };
    cancelBtn.addEventListener('click', () => { cleanup(); resolve(null); });
 
    footer.appendChild(cancelBtn);
 
    // ── Assemble ──────────────────────────────────────────────────────────
    card.appendChild(header);
    card.appendChild(list);
    card.appendChild(footer);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
 
    // Close on backdrop click
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) { cleanup(); resolve(null); }
    });
 
    function cleanup() { backdrop.remove(); }
  });
}
 
// ── Simple error toast (replaces alert() — works inside Capacitor WebView) ───
function showPrinterError(message: string): void {
  const toast = document.createElement('div');
  toast.style.cssText = [
    'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);',
    'z-index:99999;background:#dc2626;color:#fff;',
    'padding:12px 20px;border-radius:12px;font-size:13px;font-weight:500;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
    'box-shadow:0 8px 24px rgba(0,0,0,0.25);max-width:calc(100vw - 32px);',
    'text-align:center;white-space:pre-wrap;',
  ].join('');
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}
 
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
 
    try {
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
    } finally {
      // Always disconnect to free the GATT connection.
      // Leaving it open causes "already connected" errors on the next print.
      try { server.disconnect(); } catch { /* ignore if already disconnected */ }
    }
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
        padding: 4px 4px 40px 4px !important;
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
 * If no printer is saved yet, automatically prompts the user to pick one.
 *
 * FIX 9: On Android, if native printing fails, shows a visible error toast
 * instead of silently falling through to window.print() (which does nothing
 * inside a Capacitor WebView and leaves the user with no feedback).
 */
export async function printReceipt(sale: SaleDetail, settings: Settings): Promise<void> {
  let saved = getSavedPrinter();
  const plugin = getNativePlugin();
 
  // Auto-prompt on first use when running on Android and no printer saved
  if (plugin && !saved) {
    saved = await selectAndSavePrinter();
    if (!saved) {
      // User cancelled the picker — nothing to do
      return;
    }
  }
 
  const width: PaperWidth = saved?.width ?? 58;
  const data = buildReceipt(sale, settings, width);
 
  if (plugin && saved) {
    const ok = await nativePrint(data, saved.address);
    if (ok) return;
    // FIX 9: Show a user-visible error instead of a silent window.print() fallback
    showPrinterError(
      'Printing failed.\nMake sure your Bluetooth printer is on and in range, then try again.'
    );
    return;
  }
 
  // Browser (dev) path: try Web Bluetooth, then CSS print
  if (!plugin) {
    const ok = await webBluetoothPrint(data);
    if (ok) return;
  }
 
  windowPrintFallback(width);
}
 
/**
 * Prompt the user to select a paired Bluetooth printer and save it.
 *
 * FIX 8: Uses a DOM-based modal instead of window.prompt() / window.alert(),
 * both of which are silently blocked in Capacitor's Android WebView.
 *
 * Returns the saved printer info, or null if cancelled.
 */
export async function selectAndSavePrinter(): Promise<SavedPrinter | null> {
  const plugin = getNativePlugin();
 
  if (plugin) {
    try {
      const { devices } = await plugin.listPaired();
 
      if (!devices.length) {
        showPrinterError(
          'No paired Bluetooth devices found.\nPlease pair your printer in Android Settings first.'
        );
        return null;
      }
 
      // FIX 8: DOM modal instead of prompt()
      const chosen = await showPrinterPickerModal(devices);
      if (!chosen) return null;
 
      const r = await plugin.connect({ address: chosen.address });
      if (!r.success) {
        showPrinterError(`Could not connect to ${chosen.name}.\n${r.error ?? 'Unknown error'}`);
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
 
  // Browser (dev) fallback — Web Bluetooth
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
 *
 * FIX 10: Always calls connect() rather than checking isConnected() first.
 * The old guard checked socket.isConnected which was always stale on app
 * resume, frequently skipping the reconnect. The Kotlin connect() handles
 * an already-connected socket safely (closes and reopens), so calling it
 * unconditionally on startup is safe and reliable.
 */
export async function autoReconnectPrinter(): Promise<void> {
  const plugin = getNativePlugin();
  const saved  = getSavedPrinter();
  if (!plugin || !saved) return;
 
  try {
    await plugin.connect({ address: saved.address });
  } catch {
    // Silent — printer might be off; reconnect happens on next print attempt
  }
}
 
// Re-export for legacy callers
export { detectPaperWidth };