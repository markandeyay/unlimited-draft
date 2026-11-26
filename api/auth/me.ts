import type { VercelRequest, VercelResponse } from '@vercel/node';
import { noStore, safeSession } from '../_lib/session.js';

// GET /api/auth/me: who is signed in. The token itself never leaves the server.
export default function handler(req: VercelRequest, res: VercelResponse) {
  noStore(res);
  const s = safeSession(req);
  if (!s) { res.status(401).json({ error: 'Not signed in' }); return; }
  res.status(200).json({ login: s.login, avatar: s.avatar, repo: process.env.SCRIPTS_REPO ?? '' });
}
