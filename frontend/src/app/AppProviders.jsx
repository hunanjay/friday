import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../context/ThemeContext';
import { UiProvider } from '../context/UiContext';
import { WorkspaceProvider } from '../context/WorkspaceContext';
import { AuthProvider } from '../features/auth/AuthProvider';
import { SettingsEffects } from '../features/settings/SettingsEffects';
import { queryClient } from './queryClient';

export function AppProviders({ children, client = queryClient }) {
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <AuthProvider>
          <SettingsEffects />
          <UiProvider>
            <WorkspaceProvider>{children}</WorkspaceProvider>
          </UiProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
