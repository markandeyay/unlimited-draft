import type { VercelRequest, VercelResponse } from '@vercel/node';
import { SESSION_COOKIE, cookie, noStore } from '../_lib/session.js';

// POST /api/auth/logout: clear the session cookie.
export default function handler(req: VercelRequest, res: VercelResponse) {
  noStore(res);
  if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }
  res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, '', 0));
  res.status(200).json({ ok: true });
}
