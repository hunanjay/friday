import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UiProvider } from '../context/UiContext';
import { useUi } from '../hooks/useUi';

function UiProbe() {
  const {
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    toast,
    showToast,
  } = useUi();
  return (
    <div>
      <span data-testid="sidebar">{String(isSidebarCollapsed)}</span>
      <span data-testid="toast">{toast.visible ? toast.message : 'hidden'}</span>
      <button type="button" onClick={() => setIsSidebarCollapsed(value => !value)}>sidebar</button>
      <button type="button" onClick={() => showToast('Saved')}>toast</button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('UiProvider', () => {
  it('persists sidebar state without mixing it into workspace data', () => {
    localStorage.setItem('sidebar_collapsed', 'true');
    render(<UiProvider><UiProbe /></UiProvider>);
    expect(screen.getByTestId('sidebar')).toHaveTextContent('true');

    fireEvent.click(screen.getByRole('button', { name: 'sidebar' }));

    expect(screen.getByTestId('sidebar')).toHaveTextContent('false');
    expect(localStorage.getItem('sidebar_collapsed')).toBe('false');
  });

  it('owns the toast lifecycle', () => {
    render(<UiProvider><UiProbe /></UiProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'toast' }));
    expect(screen.getByTestId('toast')).toHaveTextContent('Saved');

    act(() => vi.advanceTimersByTime(3000));

    expect(screen.getByTestId('toast')).toHaveTextContent('hidden');
  });
});
