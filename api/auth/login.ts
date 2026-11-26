import { randomBytes } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { STATE_COOKIE, cookie, noStore, origin } from '../_lib/session.js';

// GET /api/auth/login: send the browser to GitHub with a random state kept in a short-lived cookie.
export default function handler(req: VercelRequest, res: VercelResponse) {
  noStore(res);
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) { res.status(500).send('GITHUB_CLIENT_ID is not set. Run npm run setup.'); return; }
  const state = randomBytes(24).toString('base64url');
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', `${origin(req)}/api/auth/callback`);
  url.searchParams.set('scope', 'repo');
  url.searchParams.set('state', state);
  res.setHeader('Set-Cookie', cookie(STATE_COOKIE, state, 600));
  res.redirect(302, url.toString());
}
