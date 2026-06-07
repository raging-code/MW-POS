#!/usr/bin/env node
/**
 * MW-POS — Remaining 6 bug fixes for App.tsx
 * Bugs: #1, #3, #4, #12, #13, #17
 *
 * Usage: node mwpos-patch-remaining.cjs [repo-path]
 */

const fs   = require('fs');
const path = require('path');
const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();

function read(rel)  { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function write(rel, c) { fs.writeFileSync(path.join(ROOT, rel), c, 'utf8'); }

function applyAll(rel, patches) {
  console.log(`\nPatching ${rel}…`);
  let content = read(rel);
  let ok = 0, skip = 0;
  for (const { label, find, replace } of patches) {
    if (!content.includes(find)) {
      console.log(`  ⤼ [${label}] — already applied, skipping`);
      skip++;
    } else {
      content = content.replace(find, replace);
      console.log(`  ✔ [${label}]`);
      ok++;
    }
  }
  write(rel, content);
  console.log(`  → Written. (${ok} applied, ${skip} skipped)`);
}

applyAll('src/App.tsx', [

  // ── Bug #1: Disable "Selected Items" tab in PartialActionModal ──────────
  {
    label: 'Bug #1 — PartialActionModal: disable Selected Items tab',
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
`            {/* Bug #1: tab disabled — backend ignores item_indices and always voids/refunds
                the entire sale. Disable until partial void/refund is implemented. */}
            <button disabled title="Partial void/refund not yet supported"
              role="tab" aria-selected={false}
              className="flex-1 py-2 rounded-xl text-sm font-700 opacity-40 cursor-not-allowed text-gray-400"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
              {actionLabel} Selected Items
            </button>`,
  },

  // ── Bug #3: Clear cart on logout ─────────────────────────────────────────
  {
    label: 'Bug #3 — handleLogout: clear cart for next user',
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
    // Bug #3: clear cart so the next user doesn't inherit the previous user's order
    useCartStore.getState().clearCart();
  }, [logout, queryClient]);`,
  },

  // ── Bug #4a: AnyUserPinModal catch — show real backend error ─────────────
  {
    label: 'Bug #4 — AnyUserPinModal: show real backend error message',
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
      // Bug #4: show the real backend error (e.g. "Too many attempts. Try again after...")
      const serverMsg = err instanceof Error ? err.message : '';
      const isBackendLockout = serverMsg.toLowerCase().includes('try again after') || serverMsg.toLowerCase().includes('too many');
      inAppLockout.increment();
      if (isBackendLockout) {
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

  // ── Bug #4b: PinModal catch — show real backend error ────────────────────
  {
    label: 'Bug #4 — PinModal: show real backend error message',
    find:
`      await verifyPin.mutateAsync({ user_id: user.id, pin: pinValue, required_role: pinModal.required_role });
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
`      await verifyPin.mutateAsync({ user_id: user.id, pin: pinValue, required_role: pinModal.required_role });
      inAppLockout.reset();
      resolvePinModal({ verified: true, user_id: user.id, user_name: user.name, role: user.role });
    } catch (err) {
      // Bug #4: show the real backend error (e.g. rate-limit lockout message)
      const serverMsg = err instanceof Error ? err.message : '';
      const isBackendLockout = serverMsg.toLowerCase().includes('try again after') || serverMsg.toLowerCase().includes('too many');
      inAppLockout.increment();
      if (isBackendLockout) {
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

  // ── Bug #4c: LoginPage catch — show real backend error ───────────────────
  {
    label: 'Bug #4 — LoginPage: show real backend error message',
    find:
`      const res = await login.mutateAsync({ user_id: user.id, pin: pinValue });
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
`      const res = await login.mutateAsync({ user_id: user.id, pin: pinValue });
      pinLockoutState.reset();
      authLogin(res.user, res.token);
      navigate(res.user.role === 'admin' ? 'admin_dashboard' : 'pos');
    } catch (err) {
      // Bug #4: show the real backend error (e.g. rate-limit lockout message)
      const serverMsg = err instanceof Error ? err.message : '';
      const isBackendLockout = serverMsg.toLowerCase().includes('try again after') || serverMsg.toLowerCase().includes('too many');
      pinLockoutState.increment();
      if (isBackendLockout) {
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

  // ── Bug #12: moveUp/moveDown — use mutateAsync + toast on error ──────────
  {
    label: 'Bug #12 — moveUp/moveDown: mutateAsync + toast error',
    find:
`  const moveUp = useCallback((catId: string) => reorderCategory.mutate({ id: catId, direction: 'up' }), [reorderCategory]);
  const moveDown = useCallback((catId: string) => reorderCategory.mutate({ id: catId, direction: 'down' }), [reorderCategory]);`,
    replace:
`  // Bug #12: use mutateAsync + catch so "Cannot move further" errors show as toasts
  const moveUp = useCallback(async (catId: string) => {
    try { await reorderCategory.mutateAsync({ id: catId, direction: 'up' }); }
    catch (e: unknown) { toast(e instanceof Error ? e.message : 'Cannot move category', 'error'); }
  }, [reorderCategory]);
  const moveDown = useCallback(async (catId: string) => {
    try { await reorderCategory.mutateAsync({ id: catId, direction: 'down' }); }
    catch (e: unknown) { toast(e instanceof Error ? e.message : 'Cannot move category', 'error'); }
  }, [reorderCategory]);`,
  },

  // ── Bug #13a: AnyUserPinModal — add required_role prop to signature ───────
  {
    label: 'Bug #13 — AnyUserPinModal: add required_role prop',
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
  // Bug #13: optional required_role so callers can enforce admin-only before hitting backend 403
  required_role?: 'admin';
}) {`,
  },

  // ── Bug #13b: ShiftModal open-shift — pass required_role="admin" ──────────
  {
    label: 'Bug #13 — ShiftModal: require admin PIN for open shift',
    find:
`        <AnyUserPinModal
          open={showAnyPin}
          onClose={() => { setShowAnyPin(false); setPendingAction(null); }}
          onSuccess={executeAction}
          title="🔒 Open Shift"
          description="Enter your PIN to open the shift."
        />`,
    replace:
`        {/* Bug #13: require admin PIN upfront — backend rejects non-admins with 403 */}
        <AnyUserPinModal
          open={showAnyPin}
          onClose={() => { setShowAnyPin(false); setPendingAction(null); }}
          onSuccess={executeAction}
          title="🔒 Open Shift (Admin Required)"
          description="Only admins can open a shift. Enter an admin PIN to continue."
          required_role="admin"
        />`,
  },

  // ── Bug #17: handleNoteChange — stable setNote ref ───────────────────────
  {
    label: 'Bug #17 — handleNoteChange: use stable stableSetNote ref',
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
  // Bug #17: stable ref so handleNoteChange isn't recreated on every cart mutation
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

]);

console.log('\n✅ Done. Now run:\n   git add src/App.tsx\n   git commit -m "Fix bugs #1 #3 #4 #12 #13 #17"\n   git push\n');