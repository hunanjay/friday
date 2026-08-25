import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../context/ThemeContext';
import { WorkspaceProvider } from '../context/WorkspaceContext';
import { queryClient } from './queryClient';

export function AppProviders({ children, client = queryClient }) {
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <WorkspaceProvider>{children}</WorkspaceProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
