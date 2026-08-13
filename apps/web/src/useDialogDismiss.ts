import { useEffect, useRef } from 'react';

/**
 * Escape-to-dismiss and focus restoration for the modal surfaces.
 *
 * Every drawer and the inspector declare `aria-modal="true"`, which commits
 * them to the dialog keyboard contract. Each one autofocuses its close control
 * on open, so without this the keyboard path in is fine and the path out is a
 * dead end.
 *
 * The listener sits on the document rather than the dialog node because focus
 * moves to `body` as soon as a pointer user clicks inert dialog chrome, which
 * would otherwise silently break the key.
 */
export function useDialogDismiss(onClose: () => void): void {
  const closeRef = useRef(onClose);
  // Captured during the first render on purpose. React applies `autoFocus`
  // while committing this dialog, which is before any effect here runs, so an
  // effect would only ever capture the dialog's own close button.
  const previouslyFocusedRef = useRef<Element | null>(
    typeof document === 'undefined' ? null : document.activeElement,
  );

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = previouslyFocusedRef.current;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Deferred and guarded. StrictMode simulates an unmount immediately after
      // mounting, and React does not re-apply `autoFocus` on the remount, so an
      // unconditional restore here would pull focus straight back out of a
      // dialog that is still on screen. The same guard hands focus to whichever
      // modal replaced this one rather than to the original trigger.
      setTimeout(() => {
        if (document.querySelector('[role="dialog"]')) return;
        if (
          previouslyFocused instanceof HTMLElement &&
          document.body.contains(previouslyFocused)
        ) {
          previouslyFocused.focus();
        }
      }, 0);
    };
  }, []);
}
