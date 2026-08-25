import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../context/ThemeContext';
import { UiProvider } from '../context/UiContext';
import { AuthProvider } from '../features/auth/AuthProvider';
import { SettingsEffects } from '../features/settings/SettingsEffects';
import { queryClient } from './queryClient';

export function AppProviders({ children, client = queryClient }) {
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <AuthProvider>
          <SettingsEffects />
          <UiProvider>{children}</UiProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
