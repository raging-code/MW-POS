#!/usr/bin/env node
/**
 * MW-POS — Remaining bug fixes for src/App.tsx
 * Bugs: #1, #3, #4a, #4b, #4c, #12, #13a, #13b, #17
 *
 * Usage:
 *   node mwpos-remaining-fixes.cjs              (run from repo root)
 *   node mwpos-remaining-fixes.cjs /path/to/repo
 *
 * Windows-safe: normalises CRLF → LF before patching so needles always match.
 */

const fs   = require('fs');
const path = require('path');
const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();

function read(rel) {
  const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  // Normalise Windows CRLF → LF so needle strings always match
  return raw.replace(/\r\n/g, '\n');
}
function write(rel, c) {
  fs.writeFileSync(path.join(ROOT, rel), c, 'utf8');
}

/**
 * marker = a unique string that ONLY appears after the fix is applied
 *          (used to detect "already applied" when the find-needle is gone)
 */
function applyAll(rel, patches) {
  console.log(`\nPatching ${rel}…`);
  let content = read(rel);
  let ok = 0, skip = 0, fail = 0;

  for (const { label, find, replace, marker } of patches) {
    if (!content.includes(find)) {
      if (marker && content.includes(marker)) {
        console.log(`  ⤼ [${label}] — already applied, skipping`);
        skip++;
      } else {
        console.log(`  ✗ [${label}] — needle NOT FOUND in file`);
        fail++;
      }
    } else {
      content = content.replace(find, replace);
      console.log(`  ✔ [${label}]`);
      ok++;
    }
  }

  write(rel, content);
  console.log(`\n  → Written. (${ok} applied, ${skip} already done, ${fail} failed)`);
  return fail;
}

// ─────────────────────────────────────────────────────────────────────────────

const appPatches = [

  // ── Bug #13a: Add required_role prop to AnyUserPinModal signature ─────────
  // (must run before #4a so required_role is in scope)
  {
    label: 'Bug #13a — AnyUserPinModal: add required_role prop to signature',
    marker: 'enforce a minimum role before the backend rejects',
    find:
`function AnyUserPinModal({
  open, onClose, onSuccess, title, description,
}: {
  open: boolean; onClose: () => void;
  onSuccess: (result: { user_id: string; user_name: string; role: string }) => void;
  title: string; description: string;
}) {`,
    replace:
`function AnyUserPinModal({
  open, onClose, onSuccess, title, description, required_role,
}: {
  open: boolean; onClose: () => void;
  onSuccess: (result: { user_id: string; user_name: string; role: string }) => void;
  title: string; description: string;
  /** Bug #13a: enforce a minimum role before the backend rejects with 403 */
  required_role?: 'admin';
}) {`,
  },

  // ── Bug #4a: AnyUserPinModal catch ─────────────────────────────────────────
  {
    label: 'Bug #4a — AnyUserPinModal: pass required_role & show real backend error',
    marker: 'Bug #4a: surface real backend message',
    find:
`    try {
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
    replace:
`    try {
      await verifyPin.mutateAsync({ user_id: user.id, pin: pinValue, required_role });
      inAppLockout.reset();
      onSuccess({ user_id: user.id, user_name: user.name, role: user.role });
    } catch (err) {
      // Bug #4a: surface real backend message (e.g. rate-limit "Try again after…")
      const serverMsg = err instanceof Error ? err.message : '';
      const isBackendLock = serverMsg.toLowerCase().includes('try again after') ||
                            serverMsg.toLowerCase().includes('too many');
      inAppLockout.increment();
      if (isBackendLock) {
        setError(serverMsg);
      } else if (inAppLockout.isLocked()) {
        setLocked(true); setLockSecs(inAppLockout.secondsLeft());
        setError(\`Too many attempts. Locked for \${inAppLockout.secondsLeft()}s.\`);
      } else {
        setError(\`Invalid PIN. \${PIN_MAX_ATTEMPTS - inAppLockout.attempts} attempt(s) left.\`);
      }
      setPin('');
    }
  }, [verifyPin, onSuccess, required_role]);`,
  },

  // ── Bug #4b: PinModal catch ───────────────────────────────────────────────
  {
    label: 'Bug #4b — PinModal: show real backend error message',
    marker: 'Bug #4b: surface real backend message',
    find:
`    try {
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
    replace:
`    try {
      await verifyPin.mutateAsync({ user_id: user.id, pin: pinValue, required_role: pinModal.required_role });
      inAppLockout.reset();
      resolvePinModal({ verified: true, user_id: user.id, user_name: user.name, role: user.role });
    } catch (err) {
      // Bug #4b: surface real backend message (e.g. rate-limit "Try again after…")
      const serverMsg = err instanceof Error ? err.message : '';
      const isBackendLock = serverMsg.toLowerCase().includes('try again after') ||
                            serverMsg.toLowerCase().includes('too many');
      inAppLockout.increment();
      if (isBackendLock) {
        setError(serverMsg);
      } else if (inAppLockout.isLocked()) {
        setLocked(true); setLockSecs(inAppLockout.secondsLeft());
        setError(\`Too many attempts. Locked for \${inAppLockout.secondsLeft()}s.\`);
      } else {
        setError(\`Invalid PIN. \${PIN_MAX_ATTEMPTS - inAppLockout.attempts} attempt(s) left.\`);
      }
      setPin('');
    }
  }, [user, verifyPin, pinModal.required_role, resolvePinModal]);`,
  },

  // ── Bug #4c: LoginPage catch ──────────────────────────────────────────────
  {
    label: 'Bug #4c — LoginPage: show real backend error message',
    marker: 'Bug #4c: surface real backend message',
    find:
`    try {
      const res = await login.mutateAsync({ user_id: user.id, pin: pinValue });
      pinLockoutState.reset();
      authLogin(res.user, res.token);
      navigate(res.user.role === 'admin' ? 'admin_dashboard' : 'pos');
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
  }, [login, authLogin, navigate]);`,
    replace:
`    try {
      const res = await login.mutateAsync({ user_id: user.id, pin: pinValue });
      pinLockoutState.reset();
      authLogin(res.user, res.token);
      navigate(res.user.role === 'admin' ? 'admin_dashboard' : 'pos');
    } catch (err) {
      // Bug #4c: surface real backend message (e.g. rate-limit "Try again after…")
      const serverMsg = err instanceof Error ? err.message : '';
      const isBackendLock = serverMsg.toLowerCase().includes('try again after') ||
                            serverMsg.toLowerCase().includes('too many');
      pinLockoutState.increment();
      if (isBackendLock) {
        setError(serverMsg);
      } else if (pinLockoutState.isLocked()) {
        setLocked(true); setLockSecs(pinLockoutState.secondsLeft());
        setError(\`Too many attempts. Locked for \${pinLockoutState.secondsLeft()}s.\`);
      } else {
        setError(\`Invalid PIN. \${PIN_MAX_ATTEMPTS - pinLockoutState.attempts} attempt(s) left.\`);
      }
      setPin('');
    }
  }, [login, authLogin, navigate]);`,
  },

  // ── Bug #1: Disable "Selected Items" tab in PartialActionModal ───────────
  {
    label: 'Bug #1 — PartialActionModal: disable Selected Items tab',
    marker: 'backend always voids/refunds entire sale',
    find:
`            <button onClick={() => setMode('items')}
              role="tab" aria-selected={mode === 'items'}
              className={clsx('flex-1 py-2 rounded-xl text-sm font-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400',
                mode === 'items' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              )}
              style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
              {actionLabel} Selected Items
            </button>`,
    replace:
`            {/* Bug #1: backend always voids/refunds entire sale — partial not supported yet */}
            <button disabled title="Partial void/refund not yet supported"
              role="tab" aria-selected={false}
              className="flex-1 py-2 rounded-xl text-sm font-700 opacity-40 cursor-not-allowed text-gray-400"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
              {actionLabel} Selected Items
            </button>`,
  },

  // ── Bug #3: Clear cart on logout ─────────────────────────────────────────
  {
    label: 'Bug #3 — handleLogout: clear cart so next user starts fresh',
    marker: 'Bug #3: clear in-progress cart',
    find:
`  const handleLogout = useCallback(() => {
    queryClient.clear();   // flush cached data so the next user starts fresh
    logout();
    setMenuOpen(false);
  }, [logout, queryClient]);`,
    replace:
`  const handleLogout = useCallback(() => {
    queryClient.clear();   // flush cached data so the next user starts fresh
    logout();
    setMenuOpen(false);
    // Bug #3: clear in-progress cart so next user doesn't inherit previous order
    useCartStore.getState().clearCart();
  }, [logout, queryClient]);`,
  },

  // ── Bug #12: moveUp/moveDown — mutateAsync + toast on error ──────────────
  {
    label: 'Bug #12 — moveUp/moveDown: use mutateAsync and toast errors',
    marker: 'Bug #12: mutateAsync + catch',
    find:
`  const moveUp = useCallback((catId: string) => reorderCategory.mutate({ id: catId, direction: 'up' }), [reorderCategory]);
  const moveDown = useCallback((catId: string) => reorderCategory.mutate({ id: catId, direction: 'down' }), [reorderCategory]);`,
    replace:
`  // Bug #12: mutateAsync + catch so "Cannot move further" toasts instead of silently failing
  const moveUp = useCallback(async (catId: string) => {
    try { await reorderCategory.mutateAsync({ id: catId, direction: 'up' }); }
    catch (e: unknown) { toast(e instanceof Error ? e.message : 'Cannot move category', 'error'); }
  }, [reorderCategory]);
  const moveDown = useCallback(async (catId: string) => {
    try { await reorderCategory.mutateAsync({ id: catId, direction: 'down' }); }
    catch (e: unknown) { toast(e instanceof Error ? e.message : 'Cannot move category', 'error'); }
  }, [reorderCategory]);`,
  },

  // ── Bug #13b: ShiftModal — pass required_role="admin" ────────────────────
  {
    label: 'Bug #13b — ShiftModal: require admin PIN for Open Shift',
    marker: 'Bug #13b: backend rejects non-admins',
    find:
`        <AnyUserPinModal
          open={showAnyPin}
          onClose={() => { setShowAnyPin(false); setPendingAction(null); }}
          onSuccess={executeAction}
          title="🔒 Open Shift"
          description="Enter your PIN to open the shift."
        />`,
    replace:
`        {/* Bug #13b: backend rejects non-admins with 403 — require admin PIN upfront */}
        <AnyUserPinModal
          open={showAnyPin}
          onClose={() => { setShowAnyPin(false); setPendingAction(null); }}
          onSuccess={executeAction}
          title="🔒 Open Shift (Admin Required)"
          description="Only admins can open a shift. Enter an admin PIN to continue."
          required_role="admin"
        />`,
  },

  // ── Bug #17: handleNoteChange — stable stableSetNote ref ─────────────────
  {
    label: 'Bug #17 — handleNoteChange: use stable stableSetNote ref',
    marker: 'Bug #17: stable selector so handleNoteChange',
    find:
`  const [noteLocal, setNoteLocal] = useState(cart.cart.note);
  const noteDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleNoteChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setNoteLocal(val);
    if (noteDebounceRef.current) clearTimeout(noteDebounceRef.current);
    noteDebounceRef.current = setTimeout(() => {
      cart.setNote(val);
      noteDebounceRef.current = null; // reset so guard re-arms for next sync
    }, 300);
  }, [cart]);`,
    replace:
`  const [noteLocal, setNoteLocal] = useState(cart.cart.note);
  const noteDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bug #17: stable selector so handleNoteChange isn't recreated on every cart mutation
  const stableSetNote = useCartStore(s => s.setNote);
  const handleNoteChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setNoteLocal(val);
    if (noteDebounceRef.current) clearTimeout(noteDebounceRef.current);
    noteDebounceRef.current = setTimeout(() => {
      stableSetNote(val);
      noteDebounceRef.current = null; // reset so guard re-arms for next sync
    }, 300);
  }, [stableSetNote]);`,
  },

];

// ─────────────────────────────────────────────────────────────────────────────

const totalFailed = applyAll('src/App.tsx', appPatches);

if (totalFailed === 0) {
  console.log(
`✅ All patches applied cleanly.

Next steps:
  git add src/App.tsx
  git commit -m "Fix bugs #1 #3 #4 #12 #13 #17 in App.tsx"
  git push

Then rebuild + deploy:
  cd worker && wrangler deploy && cd ..
  npm run build
`);
} else {
  console.log(`\n⚠️  ${totalFailed} patch(es) failed — check the output above.`);
  process.exit(1);
}
