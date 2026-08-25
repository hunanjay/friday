import { supabase } from '../../supabaseClient';

const AZURE_SCOPES = 'openid email profile offline_access Mail.ReadWrite Mail.Send Calendars.ReadWrite Contacts.ReadWrite';

// `prompt: 'select_account'` is what makes this a real account picker instead
// of a silent SSO re-auth into whichever Microsoft account is still signed
// in in this browser.
export function startAzureSignIn({ prompt } = {}) {
  return supabase.auth.signInWithOAuth({
    provider: 'azure',
    options: {
      redirectTo: window.location.origin,
      scopes: AZURE_SCOPES,
      ...(prompt ? { queryParams: { prompt } } : {}),
    },
  });
}

// Ends Azure AD's own browser SSO session, not just this app's Supabase
// session - without this, signing out and back in silently re-authenticates
// as the same Microsoft account.
export function msLogoutRedirectUrl(returnPath = '/login') {
  const postLogoutRedirectUri = encodeURIComponent(`${window.location.origin}${returnPath}`);
  return `https://login.microsoftonline.com/common/oauth2/v2.0/logout?post_logout_redirect_uri=${postLogoutRedirectUri}`;
}
