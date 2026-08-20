import { describe, it, expect } from 'vitest';
import { mailMessageUrl } from '../utils/mailApi';

describe('mailMessageUrl', () => {
  it('routes opaque Graph ids to the Graph mail API', () => {
    const graphId = 'AQMkADAwATM0MDAAMS0zYTg0LTFhOTAtMDACLTAwCgBGAAAD/g==';
    expect(mailMessageUrl(graphId, '/read'))
      .toBe(`/api/graph/mail/${encodeURIComponent(graphId)}/read`);
  });

  it('routes imap: ids to the IMAP mail API', () => {
    expect(mailMessageUrl('imap:acc:INBOX:42', '/read'))
      .toBe('/api/mail/imap%3Aacc%3AINBOX%3A42/read');
  });

  it('omits the suffix by default', () => {
    expect(mailMessageUrl('imap:acc:INBOX:42')).toBe('/api/mail/imap%3Aacc%3AINBOX%3A42');
  });
});
