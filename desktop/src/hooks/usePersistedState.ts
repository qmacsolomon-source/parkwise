import { useState, useEffect } from 'react';

// Drop-in replacement for useState that survives a page refresh. Backed by
// sessionStorage (not localStorage) on purpose - it only needs to survive a
// refresh of the same tab, not linger indefinitely across unrelated future
// sessions once the tab is actually closed. Never use this for password
// fields - sessionStorage is plain text, and a half-typed password sitting
// there even temporarily isn't worth it.
export function usePersistedState<T>(key: string, initialValue: T) {
  const storageKey = `parkwise:draft:${key}`;

  const [state, setState] = useState<T>(() => {
    try {
      const stored = sessionStorage.getItem(storageKey);
      return stored !== null ? (JSON.parse(stored) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // Storage full, disabled, or unavailable (private browsing, etc.) -
      // the field still works for this session, it just won't survive a
      // refresh. Not worth surfacing to the user over.
    }
  }, [storageKey, state]);

  return [state, setState] as const;
}
