const API_URL = import.meta.env.VITE_API_URL || '';

// Per-message routes split by provider: IMAP ids are "imap:{account}:{mailbox}:{uid}"
// (routed by app/api/mail_accounts.py), Graph ids are opaque (app/api/mail.py).
export const mailMessageUrl = (emailId, suffix = '') =>
  `${API_URL}/api/${String(emailId).startsWith('imap:') ? 'mail' : 'graph/mail'}`
  + `/${encodeURIComponent(emailId)}${suffix}`;
