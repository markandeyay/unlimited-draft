import type { VercelRequest, VercelResponse } from '@vercel/node';
import { SESSION_COOKIE, STATE_COOKIE, cookie, cookies, noStore, origin, seal } from '../_lib/session.js';

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;background:#17232e;color:#fff;padding:48px;line-height:1.5"><h2>${title}</h2><p>${body}</p><p><a style="color:#48aff0" href="/">Back to Unlimited Draft</a></p>`;

// GET /api/auth/callback: check state, exchange the code, allow only ALLOWED_GITHUB_LOGIN.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  noStore(res);
  const { code, state } = req.query as { code?: string; state?: string };
  const saved = cookies(req)[STATE_COOKIE];
  const clear = cookie(STATE_COOKIE, '', 0);
  if (!code || !state || !saved || state !== saved) {
    res.setHeader('Set-Cookie', clear);
    res.status(400).send(page('Sign in failed', 'The sign in link expired or did not match. Please try again.'));
    return;
  }
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${origin(req)}/api/auth/callback`,
      }),
    });
    const tokenJson = (await tokenRes.json()) as { access_token?: string; error_description?: string };
    if (!tokenJson.access_token) throw new Error(tokenJson.error_description ?? 'No access token returned');
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'unlimited-draft' },
    });
    const user = (await userRes.json()) as { login?: string; avatar_url?: string };
    const allowed = (process.env.ALLOWED_GITHUB_LOGIN ?? '').toLowerCase();
    if (!user.login || !allowed || user.login.toLowerCase() !== allowed) {
      res.setHeader('Set-Cookie', [clear, cookie(SESSION_COOKIE, '', 0)]);
      res.status(403).send(page('Not allowed', 'This app is private. That GitHub account cannot sign in.'));
      return;
    }
    const session = seal({ token: tokenJson.access_token, login: user.login, avatar: user.avatar_url, iat: Date.now() });
    res.setHeader('Set-Cookie', [clear, cookie(SESSION_COOKIE, session, 60 * 60 * 24 * 180)]);
    res.redirect(302, '/');
  } catch (e) {
    res.setHeader('Set-Cookie', clear);
    res.status(500).send(page('Sign in failed', `GitHub sign in did not complete: ${(e as Error).message.replace(/[<>&]/g, '')}`));
  }
}
