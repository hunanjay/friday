import { useEffect } from 'react';
import { useAssistantName } from './hooks';

export function SettingsEffects() {
  const { assistantName } = useAssistantName();

  useEffect(() => {
    document.title = assistantName;
  }, [assistantName]);

  return null;
}
