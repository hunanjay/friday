import { describe, expect, it, beforeEach } from 'vitest';
import { readComposeDraft, writeComposeDraft } from '../pages/composeDraft';

describe('compose draft persistence', () => {
  beforeEach(() => localStorage.clear());

  it('returns empty fields when nothing was saved', () => {
    expect(readComposeDraft()).toEqual({ to: '', cc: '', bcc: '', subject: '', body: '' });
  });

  it('round-trips what was typed', () => {
    writeComposeDraft({ to: 'a@x.com', cc: '', bcc: '', subject: 'Hi', body: 'Half a thought' });
    expect(readComposeDraft()).toMatchObject({ to: 'a@x.com', subject: 'Hi', body: 'Half a thought' });
  });

  it('fills in fields a stored draft predates, instead of yielding undefined', () => {
    localStorage.setItem('friday.composeDraft', JSON.stringify({ to: 'a@x.com' }));
    expect(readComposeDraft()).toEqual({ to: 'a@x.com', cc: '', bcc: '', subject: '', body: '' });
  });

  it('clears the entry once every field is empty, so an old draft cannot resurface', () => {
    writeComposeDraft({ to: 'a@x.com', cc: '', bcc: '', subject: '', body: '' });
    writeComposeDraft({ to: '', cc: '', bcc: '', subject: '', body: '' });
    expect(localStorage.getItem('friday.composeDraft')).toBeNull();
  });

  it('survives a corrupted entry rather than throwing on mount', () => {
    localStorage.setItem('friday.composeDraft', 'not json');
    expect(readComposeDraft()).toEqual({ to: '', cc: '', bcc: '', subject: '', body: '' });
  });
});
