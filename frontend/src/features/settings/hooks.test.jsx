import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../auth/auth-context';
import { useAssistantName } from './hooks';

const apiMocks = vi.hoisted(() => ({
  getAssistantName: vi.fn(),
  updateAssistantName: vi.fn(),
}));

vi.mock('./api', () => ({
  DEFAULT_ASSISTANT_NAME: 'Friday',
  getAssistantName: apiMocks.getAssistantName,
  updateAssistantName: apiMocks.updateAssistantName,
  getSignature: vi.fn(),
  updateSignature: vi.fn(),
  getAvatar: vi.fn(),
  updateAvatar: vi.fn(),
  getAvatarPresets: vi.fn(),
}));

function AssistantNameProbe({ id, canUpdate = false }) {
  const { assistantName, updateAssistantName } = useAssistantName();
  return (
    <div>
      <span data-testid={id}>{assistantName}</span>
      {canUpdate && <button onClick={() => updateAssistantName('Nova')}>rename</button>}
    </div>
  );
}

describe('settings hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getAssistantName.mockResolvedValue('Atlas');
    apiMocks.updateAssistantName.mockResolvedValue('Nova');
  });

  it('deduplicates consumers and publishes mutation results through the shared cache', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const auth = { authToken: 'token', user: { email: 'person@example.com' } };

    render(
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={auth}>
          <AssistantNameProbe id="first" canUpdate />
          <AssistantNameProbe id="second" />
        </AuthContext.Provider>
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByTestId('first')).toHaveTextContent('Atlas'));
    expect(screen.getByTestId('second')).toHaveTextContent('Atlas');
    expect(apiMocks.getAssistantName).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'rename' }));
    await waitFor(() => expect(screen.getByTestId('first')).toHaveTextContent('Nova'));
    expect(screen.getByTestId('second')).toHaveTextContent('Nova');
    expect(apiMocks.updateAssistantName).toHaveBeenCalledWith('token', 'Nova');
  });
});
