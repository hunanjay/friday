import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { UiContext } from './ui-context';

const EMPTY_TOAST = { message: '', visible: false };

export function UiProvider({ children }) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    () => localStorage.getItem('sidebar_collapsed') === 'true',
  );
  const [toast, setToast] = useState(EMPTY_TOAST);

  const showToast = useCallback((message) => {
    setToast({ message, visible: true });
  }, []);

  const hideToast = useCallback(() => setToast(EMPTY_TOAST), []);

  useEffect(() => {
    localStorage.setItem('sidebar_collapsed', String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  useEffect(() => {
    if (!toast.visible) return undefined;
    const timer = setTimeout(hideToast, 3000);
    return () => clearTimeout(timer);
  }, [hideToast, toast.visible]);

  const value = useMemo(() => ({
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    toast,
    showToast,
    hideToast,
  }), [hideToast, isSidebarCollapsed, showToast, toast]);

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}
