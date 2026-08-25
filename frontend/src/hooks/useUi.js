import { useContext } from 'react';
import { UiContext } from '../context/ui-context';

export function useUi() {
  const context = useContext(UiContext);
  if (!context) throw new Error('useUi must be used within a UiProvider');
  return context;
}
