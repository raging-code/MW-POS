/**
 * patch-critical-fixes.mjs
 *
 * Applies all critical bug fixes to MW-POS source files.
 * Run from the repo root:   node patch-critical-fixes.mjs
 *
 * ─── Bugs Fixed ───────────────────────────────────────────────
 *
 *  [A] SHARED PIN LOCKOUT STATE
 *      pinLockoutState was a single module-level object shared by
 *      LoginPage, PinModal, and AnyUserPinModal.  5 failed login
 *      attempts would lock the in-app admin PIN modal for 60 s,
 *      blocking shift ops, voids, and refunds mid-shift.
 *      Fix: factory function → two independent instances.
 *
 *  [B] handleHold — silent failure on park-order API error
 *      If createHeld.mutateAsync threw, the error was swallowed
 *      and the user saw nothing (no feedback, no toast).
 *
 *  [C] executeAction (ShiftModal) — silent failure on shift ops
 *      openShift / closeShift / cashDrop errors were swallowed.
 *      The user saw the PIN modal close with zero feedback.
 *
 *  [D] handleSave (AdminSettingsPage) — unhandled rejection
 *      updateSettings.mutateAsync could throw with no try/catch,
 *      causing an unhandled Promise rejection (dirty bit NOT reset,
 *      but also no error toast shown to the admin).
 *
 *  [E] doReprint — silent failure on reprint API error
 *      reprint.mutateAsync was awaited without try/catch; any
 *      server-side error (shift closed, receipt not found, etc.)
 *      produced a silent failure after the PIN modal closed.
 *
 *  [F] handleAddCategory — silent failure
 *  [G] handleAddItem     — silent failure
 *  [H] handleAddAddon    — silent failure
 *  [I] handleEditItem    — silent failure
 *      All four admin-menu mutateAsync calls had no try/catch.
 *      A failed write (duplicate name, network hiccup) left the
 *      form open and showed nothing to the user.
 *
 *  [J] Auth token validation on mount — logout on ANY network error
 *      The startup /auth/me fetch had `.catch(() => logout())`.
 *      Any transient network failure (LAN hiccup, captive portal,
 *      Android radio sleep/wake) would log the cashier out mid-shift,
 *      losing their cart state.  Fix: only logout on HTTP 401/403.
 */

import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));

// ─── helpers ──────────────────────────────────────────────────
function applyPatch(source, oldStr, newStr, label) {
  if (!source.includes(oldStr)) {
    throw new Error(`[PATCH FAILED] Could not find target string for: ${label}\n` +
      `First 80 chars of search: ${JSON.stringify(oldStr.slice(0, 80))}`);
  }
  const result = source.replace(oldStr, newStr);
  if (result === source) {
    throw new Error(`[PATCH FAILED] Replacement produced no change for: ${label}`);
  }
  console.log(`  ✓  ${label}`);
  return result;
}

async function patchFile(relPath, patches) {
  const absPath = join(__dir, relPath);
  let src = await readFile(absPath, 'utf8');

  // Make a backup
  await writeFile(absPath + '.critical-fix-backup', src);
  console.log(`\nPatching ${relPath}  (backup → ${relPath}.critical-fix-backup)`);

  for (const [label, oldStr, newStr] of patches) {
    src = applyPatch(src, oldStr, newStr, label);
  }

  await writeFile(absPath, src, 'utf8');
  console.log(`  → written.\n`);
}

// ═══════════════════════════════════════════════════════════════
// src/App.tsx patches
// ═══════════════════════════════════════════════════════════════
await patchFile('src/App.tsx', [

  // ── [A] Replace single pinLockoutState with factory + two instances ──────
  [
    '[A] pinLockoutState → factory + loginLockout / inAppLockout',
    `const pinLockoutState = {
  attempts: 0,
  lockedUntil: 0,
  increment() {
    this.attempts += 1;
    if (this.attempts >= PIN_MAX_ATTEMPTS) {
      this.lockedUntil = Date.now() + PIN_LOCKOUT_MS;
      this.attempts = 0;
    }
  },
  reset() { this.attempts = 0; this.lockedUntil = 0; },
  isLocked() { return Date.now() < this.lockedUntil; },
  secondsLeft() { return Math.ceil(Math.max(0, this.lockedUntil - Date.now()) / 1000); },
};`,
    `// FIX [A]: factory so login and in-app PIN have independent counters.
// Previously 5 failed login attempts would also lock the admin PIN modal
// for 60 s, blocking shift ops, voids, and refunds mid-shift.
function createPinLockout() {
  return {
    attempts: 0,
    lockedUntil: 0,
    increment() {
      this.attempts += 1;
      if (this.attempts >= PIN_MAX_ATTEMPTS) {
        this.lockedUntil = Date.now() + PIN_LOCKOUT_MS;
        this.attempts = 0;
      }
    },
    reset() { this.attempts = 0; this.lockedUntil = 0; },
    isLocked() { return Date.now() < this.lockedUntil; },
    secondsLeft() { return Math.ceil(Math.max(0, this.lockedUntil - Date.now()) / 1000); },
  };
}
const pinLockoutState = createPinLockout(); // LoginPage
const inAppLockout    = createPinLockout(); // PinModal + AnyUserPinModal`,
  ],

  // ── [A] AnyUserPinModal — switch from pinLockoutState to inAppLockout ────
  [
    '[A] AnyUserPinModal lockout interval → inAppLockout',
    `  useEffect(() => {
    if (!locked) return;
    const iv = setInterval(() => {
      const secs = pinLockoutState.secondsLeft();
      if (secs <= 0) { setLocked(false); setLockSecs(0); clearInterval(iv); }
      else setLockSecs(secs);
    }, 500);
    return () => clearInterval(iv);
  }, [locked]);

  const doSubmit = useCallback(async (pinValue: string, user: User) => {
    if (pinLockoutState.isLocked()) {
      setLocked(true); setLockSecs(pinLockoutState.secondsLeft()); setPin(''); return;
    }
    try {
      await verifyPin.mutateAsync({ user_id: user.id, pin: pinValue });
      pinLockoutState.reset();
      onSuccess({ user_id: user.id, user_name: user.name, role: user.role });
    } catch {
      pinLockoutState.increment();
      if (pinLockoutState.isLocked()) {
        setLocked(true); setLockSecs(pinLockoutState.secondsLeft());
        setError(\`Too many attempts. Locked for \${pinLockoutState.secondsLeft()}s.\`);
      } else {
        setError(\`Invalid PIN. \${PIN_MAX_ATTEMPTS - pinLockoutState.attempts} attempt(s) left.\`);
      }
      setPin('');
    }
  }, [verifyPin, onSuccess]);`,
    `  useEffect(() => {
    if (!locked) return;
    const iv = setInterval(() => {
      const secs = inAppLockout.secondsLeft();
      if (secs <= 0) { setLocked(false); setLockSecs(0); clearInterval(iv); }
      else setLockSecs(secs);
    }, 500);
    return () => clearInterval(iv);
  }, [locked]);

  const doSubmit = useCallback(async (pinValue: string, user: User) => {
    if (inAppLockout.isLocked()) {
      setLocked(true); setLockSecs(inAppLockout.secondsLeft()); setPin(''); return;
    }
    try {
      await verifyPin.mutateAsync({ user_id: user.id, pin: pinValue });
      inAppLockout.reset();
      onSuccess({ user_id: user.id, user_name: user.name, role: user.role });
    } catch {
      inAppLockout.increment();
      if (inAppLockout.isLocked()) {
        setLocked(true); setLockSecs(inAppLockout.secondsLeft());
        setError(\`Too many attempts. Locked for \${inAppLockout.secondsLeft()}s.\`);
      } else {
        setError(\`Invalid PIN. \${PIN_MAX_ATTEMPTS - inAppLockout.attempts} attempt(s) left.\`);
      }
      setPin('');
    }
  }, [verifyPin, onSuccess]);`,
  ],

  // ── [A] PinModal — switch from pinLockoutState to inAppLockout ───────────
  [
    '[A] PinModal lockout interval + doSubmit → inAppLockout',
    `  useEffect(() => {
    if (!locked) return;
    const iv = setInterval(() => {
      const secs = pinLockoutState.secondsLeft();
      if (secs <= 0) { setLocked(false); setLockSecs(0); clearInterval(iv); }
      else setLockSecs(secs);
    }, 500);
    return () => clearInterval(iv);
  }, [locked]);

  // FIX: doSubmit and press declared BEFORE the useEffect that references
  // \`press\` in its deps array — required by TypeScript (TS2448/TS2454).
  const doSubmit = useCallback(async (pinValue: string) => {
    if (!user) return;
    if (pinLockoutState.isLocked()) {
      setLocked(true); setLockSecs(pinLockoutState.secondsLeft()); setPin(''); return;
    }
    try {
      await verifyPin.mutateAsync({ user_id: user.id, pin: pinValue, required_role: pinModal.required_role });
      pinLockoutState.reset();
      resolvePinModal({ verified: true, user_id: user.id, user_name: user.name, role: user.role });
    } catch {
      pinLockoutState.increment();
      if (pinLockoutState.isLocked()) {
        setLocked(true); setLockSecs(pinLockoutState.secondsLeft());
        setError(\`Too many attempts. Locked for \${pinLockoutState.secondsLeft()}s.\`);
      } else {
        setError(\`Invalid PIN. \${PIN_MAX_ATTEMPTS - pinLockoutState.attempts} attempt(s) left.\`);
      }
      setPin('');
    }
  }, [user, verifyPin, pinModal.required_role, resolvePinModal]);`,
    `  useEffect(() => {
    if (!locked) return;
    const iv = setInterval(() => {
      const secs = inAppLockout.secondsLeft();
      if (secs <= 0) { setLocked(false); setLockSecs(0); clearInterval(iv); }
      else setLockSecs(secs);
    }, 500);
    return () => clearInterval(iv);
  }, [locked]);

  // FIX: doSubmit and press declared BEFORE the useEffect that references
  // \`press\` in its deps array — required by TypeScript (TS2448/TS2454).
  const doSubmit = useCallback(async (pinValue: string) => {
    if (!user) return;
    if (inAppLockout.isLocked()) {
      setLocked(true); setLockSecs(inAppLockout.secondsLeft()); setPin(''); return;
    }
    try {
      await verifyPin.mutateAsync({ user_id: user.id, pin: pinValue, required_role: pinModal.required_role });
      inAppLockout.reset();
      resolvePinModal({ verified: true, user_id: user.id, user_name: user.name, role: user.role });
    } catch {
      inAppLockout.increment();
      if (inAppLockout.isLocked()) {
        setLocked(true); setLockSecs(inAppLockout.secondsLeft());
        setError(\`Too many attempts. Locked for \${inAppLockout.secondsLeft()}s.\`);
      } else {
        setError(\`Invalid PIN. \${PIN_MAX_ATTEMPTS - inAppLockout.attempts} attempt(s) left.\`);
      }
      setPin('');
    }
  }, [user, verifyPin, pinModal.required_role, resolvePinModal]);`,
  ],

  // ── [B] handleHold — add try/catch ───────────────────────────────────────
  [
    '[B] handleHold — add try/catch',
    `  const handleHold = async () => {
    if (cartIsEmpty) return;
    const cartSnapshot = useCartStore.getState().cart;
    await createHeld.mutateAsync({ data: cartSnapshot, label: label || undefined });
    clearCart();
    toast('Order parked');
    onClose();
  };`,
    `  const handleHold = async () => {
    if (cartIsEmpty) return;
    const cartSnapshot = useCartStore.getState().cart;
    // FIX [B]: catch API errors so the user gets feedback instead of silence
    try {
      await createHeld.mutateAsync({ data: cartSnapshot, label: label || undefined });
      clearCart();
      toast('Order parked');
      onClose();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Failed to park order', 'error');
    }
  };`,
  ],

  // ── [C] executeAction (ShiftModal) — add try/catch ───────────────────────
  [
    '[C] executeAction ShiftModal — add try/catch',
    `  const executeAction = useCallback(async (actioner: { user_id: string; user_name: string; role: string }) => {
    setShowAnyPin(false);
    if (pendingAction === 'open') {
      await openShift.mutateAsync({ starting_float: parseFloat(startFloat) || 0 });
      toast('Shift opened');
      onCloseRef.current();
    } else if (pendingAction === 'close' && shift) {
      await closeShift.mutateAsync({ id: shift.id, closing_cash: parseFloat(closingCash) || 0, notes: closeNotes });
      toast('Shift closed');
      onCloseRef.current();
    } else if (pendingAction === 'drop' && shift && dropReason) {
      await cashDrop.mutateAsync({ shift_id: shift.id, amount: parseFloat(dropAmount) || 0, reason: dropReason });
      toast('Cash drop recorded');
      setDropAmount(''); setDropReason('');
      onCloseRef.current();
    }
    setPendingAction(null);
  }, [pendingAction, openShift, closeShift, cashDrop, shift, startFloat, closingCash, closeNotes, dropAmount, dropReason]);`,
    `  const executeAction = useCallback(async (actioner: { user_id: string; user_name: string; role: string }) => {
    setShowAnyPin(false);
    // FIX [C]: wrap in try/catch so shift-op failures surface as toasts
    try {
      if (pendingAction === 'open') {
        await openShift.mutateAsync({ starting_float: parseFloat(startFloat) || 0 });
        toast('Shift opened');
        onCloseRef.current();
      } else if (pendingAction === 'close' && shift) {
        await closeShift.mutateAsync({ id: shift.id, closing_cash: parseFloat(closingCash) || 0, notes: closeNotes });
        toast('Shift closed');
        onCloseRef.current();
      } else if (pendingAction === 'drop' && shift && dropReason) {
        await cashDrop.mutateAsync({ shift_id: shift.id, amount: parseFloat(dropAmount) || 0, reason: dropReason });
        toast('Cash drop recorded');
        setDropAmount(''); setDropReason('');
        onCloseRef.current();
      }
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Action failed', 'error');
    }
    setPendingAction(null);
  }, [pendingAction, openShift, closeShift, cashDrop, shift, startFloat, closingCash, closeNotes, dropAmount, dropReason]);`,
  ],

  // ── [D] handleSave (AdminSettingsPage) — add try/catch ───────────────────
  [
    '[D] AdminSettingsPage handleSave — add try/catch',
    `  const handleSave = useCallback(async () => {
    await updateSettings.mutateAsync(form);
    setDirty(false);
    toast('Settings saved');
  }, [updateSettings, form]);`,
    `  const handleSave = useCallback(async () => {
    // FIX [D]: catch API errors; without this the Promise rejects silently
    try {
      await updateSettings.mutateAsync(form);
      setDirty(false);
      toast('Settings saved');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Failed to save settings', 'error');
    }
  }, [updateSettings, form]);`,
  ],

  // ── [E] doReprint — add try/catch around mutateAsync ─────────────────────
  [
    '[E] doReprint — add try/catch',
    `  const doReprint = useCallback(async (actioner: { user_id: string; user_name: string; role: string }) => {
    if (!saleDetail) return;
    setShowAnyPinForReprint(false);
    await reprint.mutateAsync({ id: saleDetail.id, actioned_by_user_id: actioner.user_id, actioned_by_name: actioner.user_name });
    toast('Reprint recorded');
    if (settings) {
      await printReceipt(saleDetail, settings);
    } else {
      toast('Printer settings not loaded yet — please try again in a moment.', 'error');
    }
  }, [saleDetail, reprint, settings]);`,
    `  const doReprint = useCallback(async (actioner: { user_id: string; user_name: string; role: string }) => {
    if (!saleDetail) return;
    setShowAnyPinForReprint(false);
    // FIX [E]: catch reprint API errors (e.g. shift already closed, receipt not found)
    try {
      await reprint.mutateAsync({ id: saleDetail.id, actioned_by_user_id: actioner.user_id, actioned_by_name: actioner.user_name });
      toast('Reprint recorded');
      if (settings) {
        await printReceipt(saleDetail, settings);
      } else {
        toast('Printer settings not loaded yet — please try again in a moment.', 'error');
      }
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Reprint failed', 'error');
    }
  }, [saleDetail, reprint, settings]);`,
  ],

  // ── [F] handleAddCategory — add try/catch ────────────────────────────────
  [
    '[F] handleAddCategory — add try/catch',
    `  const handleAddCategory = useCallback(async () => {
    if (!newCatName.trim()) return;
    await createCategory.mutateAsync({ name: newCatName, sort_order: categories.length });
    setNewCatName('');
    toast('Category added');
  }, [createCategory, newCatName, categories.length]);`,
    `  const handleAddCategory = useCallback(async () => {
    if (!newCatName.trim()) return;
    // FIX [F]: surface API errors (e.g. duplicate name) instead of swallowing them
    try {
      await createCategory.mutateAsync({ name: newCatName, sort_order: categories.length });
      setNewCatName('');
      toast('Category added');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Failed to add category', 'error');
    }
  }, [createCategory, newCatName, categories.length]);`,
  ],

  // ── [G] handleAddItem — add try/catch ────────────────────────────────────
  [
    '[G] handleAddItem — add try/catch',
    `  const handleAddItem = useCallback(async () => {
    const sizes = newItem.sizes.filter(s => s.name && s.price).map(s => ({ name: s.name, price: parseFloat(s.price) }));
    if (!newItem.name || !sizes.length) return;
    await createItem.mutateAsync({ name: newItem.name, category_id: newItem.category_id || undefined, sizes });
    setNewItem({ name: '', category_id: '', sizes: [{ name: 'Regular', price: '' }] });
    setShowAddItem(false);
    toast('Item added');
  }, [createItem, newItem]);`,
    `  const handleAddItem = useCallback(async () => {
    const sizes = newItem.sizes.filter(s => s.name && s.price).map(s => ({ name: s.name, price: parseFloat(s.price) }));
    if (!newItem.name || !sizes.length) return;
    // FIX [G]: catch API errors so the form stays open and user sees the problem
    try {
      await createItem.mutateAsync({ name: newItem.name, category_id: newItem.category_id || undefined, sizes });
      setNewItem({ name: '', category_id: '', sizes: [{ name: 'Regular', price: '' }] });
      setShowAddItem(false);
      toast('Item added');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Failed to add item', 'error');
    }
  }, [createItem, newItem]);`,
  ],

  // ── [H] handleAddAddon — add try/catch ───────────────────────────────────
  [
    '[H] handleAddAddon — add try/catch',
    `  const handleAddAddon = useCallback(async () => {
    if (!newAddon.name || !newAddon.price) return;
    await createAddon.mutateAsync({ name: newAddon.name, price: parseFloat(newAddon.price) });
    setNewAddon({ name: '', price: '' });
    setShowAddAddon(false);
    toast('Add-on added');
  }, [createAddon, newAddon]);`,
    `  const handleAddAddon = useCallback(async () => {
    if (!newAddon.name || !newAddon.price) return;
    // FIX [H]: catch API errors (e.g. duplicate add-on name)
    try {
      await createAddon.mutateAsync({ name: newAddon.name, price: parseFloat(newAddon.price) });
      setNewAddon({ name: '', price: '' });
      setShowAddAddon(false);
      toast('Add-on added');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Failed to add add-on', 'error');
    }
  }, [createAddon, newAddon]);`,
  ],

  // ── [I] handleEditItem — add try/catch ───────────────────────────────────
  [
    '[I] handleEditItem — add try/catch',
    `  const handleEditItem = useCallback(async () => {
    if (!editItem || !editForm) return;
    const sizes = editForm.sizes.filter(s => s.name && s.price).map(s => ({ ...(s.id ? { id: s.id } : {}), name: s.name, price: parseFloat(s.price) }));
    if (!editForm.name || !sizes.length) return;
    await updateItem.mutateAsync({ id: editItem.id, name: editForm.name, category_id: editForm.category_id || undefined, sizes });
    setEditItem(null); setEditForm(null);
    toast('Item updated');
  }, [updateItem, editItem, editForm]);`,
    `  const handleEditItem = useCallback(async () => {
    if (!editItem || !editForm) return;
    const sizes = editForm.sizes.filter(s => s.name && s.price).map(s => ({ ...(s.id ? { id: s.id } : {}), name: s.name, price: parseFloat(s.price) }));
    if (!editForm.name || !sizes.length) return;
    // FIX [I]: keep form open and show error instead of silently failing
    try {
      await updateItem.mutateAsync({ id: editItem.id, name: editForm.name, category_id: editForm.category_id || undefined, sizes });
      setEditItem(null); setEditForm(null);
      toast('Item updated');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Failed to update item', 'error');
    }
  }, [updateItem, editItem, editForm]);`,
  ],

  // ── [J] Auth check — only logout on 401/403, not network errors ──────────
  [
    '[J] Auth /auth/me check — only logout on 401/403',
    `        .then(res => { if (!res.ok) logout() })
        .catch(() => logout())`,
    `        // FIX [J]: only force-logout on explicit auth rejection (401/403).
        // Network hiccups (LAN drop, Android radio sleep) previously caused
        // an unintended logout mid-shift, losing the active cart state.
        .then(res => { if (res.status === 401 || res.status === 403) logout() })
        .catch(() => { /* transient network error — stay logged in */ })`,
  ],

]);

console.log('All patches applied successfully.');
