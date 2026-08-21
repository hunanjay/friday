// Unsent compose text, kept locally on purpose: it is not a Drafts-folder
// message, and syncing it would create a second thing to reconcile.
const COMPOSE_DRAFT_KEY = 'friday.composeDraft';
const EMPTY_DRAFT = { to: '', cc: '', bcc: '', subject: '', body: '' };

export function readComposeDraft() {
  try {
    return { ...EMPTY_DRAFT, ...JSON.parse(localStorage.getItem(COMPOSE_DRAFT_KEY) || '{}') };
  } catch {
    return { ...EMPTY_DRAFT };
  }
}

export function writeComposeDraft(draft) {
  const hasContent = Object.values(draft).some(value => value);
  if (hasContent) localStorage.setItem(COMPOSE_DRAFT_KEY, JSON.stringify(draft));
  else localStorage.removeItem(COMPOSE_DRAFT_KEY);
}
