import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

interface DialogState {
  kind: 'alert' | 'confirm';
  title: string;
  message: string;
  resolve: (value: boolean) => void;
}

interface DialogContextValue {
  alert: (message: string, title?: string) => Promise<void>;
  confirm: (message: string, title?: string) => Promise<boolean>;
}

const DialogContext = createContext<DialogContextValue | undefined>(undefined);

// In-app replacement for window.alert()/window.confirm(). Native browser
// dialogs look out of place next to the rest of this app's styled modals,
// and on some pages they've been known to freeze automated testing with no
// way to dismiss them. This renders a modal matching the existing
// Logout-confirmation style (Sidebar.tsx) instead.
export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const alert = useCallback((message: string, title = 'Notice') => {
    return new Promise<void>((resolve) => {
      resolverRef.current = () => resolve();
      setDialog({ kind: 'alert', title, message, resolve: () => resolve() });
    });
  }, []);

  const confirm = useCallback((message: string, title = 'Please Confirm') => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setDialog({ kind: 'confirm', title, message, resolve });
    });
  }, []);

  const close = (value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setDialog(null);
  };

  return (
    <DialogContext.Provider value={{ alert, confirm }}>
      {children}
      {dialog && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="app-dialog-title"
          aria-describedby="app-dialog-message"
        >
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 id="app-dialog-title" className="text-xl font-bold text-gray-900 mb-4">
              {dialog.title}
            </h2>
            <p id="app-dialog-message" className="text-gray-600 mb-6 whitespace-pre-wrap">
              {dialog.message}
            </p>
            <div className="flex gap-3 justify-end">
              {dialog.kind === 'confirm' && (
                <button
                  onClick={() => close(false)}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
                  autoFocus
                >
                  Cancel
                </button>
              )}
              <button
                onClick={() => close(true)}
                className="px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary-light transition-colors"
                autoFocus={dialog.kind === 'alert'}
              >
                {dialog.kind === 'confirm' ? 'Confirm' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error('useDialog must be used within a DialogProvider');
  }
  return ctx;
}
