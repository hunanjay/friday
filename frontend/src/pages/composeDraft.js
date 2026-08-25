// Unsent compose text, kept locally for instant restore. `draftId` (a Graph
// message id) is carried alongside so a fresh Microsoft compose keeps mirroring
// the same Outlook draft across reloads instead of creating a new one each time.
const COMPOSE_DRAFT_KEY = 'friday.composeDraft';
const EMPTY_DRAFT = { to: '', cc: '', bcc: '', subject: '', body: '', draftId: null };
const _TEXT_FIELDS = ['to', 'cc', 'bcc', 'subject', 'body'];

export function readComposeDraft() {
  try {
    return { ...EMPTY_DRAFT, ...JSON.parse(localStorage.getItem(COMPOSE_DRAFT_KEY) || '{}') };
  } catch {
    return { ...EMPTY_DRAFT };
  }
}

export function writeComposeDraft(draft) {
  const hasContent = _TEXT_FIELDS.some(key => draft[key]);
  if (hasContent) localStorage.setItem(COMPOSE_DRAFT_KEY, JSON.stringify(draft));
  else localStorage.removeItem(COMPOSE_DRAFT_KEY);
}
