import type { VercelRequest, VercelResponse } from '@vercel/node';
import { noStore, origin, safeSession } from './_lib/session.js';

/** True when the proxy may forward this path: only the scripts repo and /user. */
export function pathAllowed(path: string, repo: string): boolean {
  if (!repo || path.includes('..') || path.includes('//')) return false;
  const lower = path.toLowerCase();
  const prefix = `repos/${repo}`.toLowerCase();
  return lower === 'user' || lower === prefix || lower.startsWith(`${prefix}/`);
}

// ALL /api/github/*: thin proxy to api.github.com that attaches the token from the session cookie.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  noStore(res);
  const session = safeSession(req);
  if (!session) { res.status(401).json({ message: 'Not signed in' }); return; }

  const method = (req.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    // Cross-site pages cannot write through the proxy.
    const from = req.headers.origin;
    if (from && from !== origin(req)) { res.status(403).json({ message: 'Bad origin' }); return; }
  }

  const repo = process.env.SCRIPTS_REPO ?? '';
  const raw = req.query.path;
  const path = (Array.isArray(raw) ? raw.join('/') : raw ?? '').replace(/^\/+/, '');
  if (!pathAllowed(path, repo)) { res.status(403).json({ message: 'Path not allowed' }); return; }

  const url = new URL(`https://api.github.com/${path}`);
  for (const [k, v] of Object.entries(req.query)) {
    if (k === 'path') continue;
    for (const item of Array.isArray(v) ? v : [v]) if (item !== undefined) url.searchParams.append(k, String(item));
  }
  const hasBody = method !== 'GET' && method !== 'HEAD' && req.body !== undefined && req.body !== null && req.body !== '';
  try {
    const gh = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${session.token}`,
        Accept: (req.headers.accept as string) || 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'unlimited-draft',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: hasBody ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : undefined,
    });
    const text = await gh.text();
    res.status(gh.status);
    res.setHeader('Content-Type', gh.headers.get('content-type') ?? 'application/json');
    res.send(text);
  } catch (e) {
    res.status(502).json({ message: `GitHub request failed: ${(e as Error).message}` });
  }
}
