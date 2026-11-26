// Encrypted session cookie helpers shared by the auth functions and the GitHub proxy.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const SESSION_COOKIE = 'ud_session';
export const STATE_COOKIE = 'ud_state';

export interface Session { token: string; login: string; avatar?: string; iat: number }

function key(): Buffer {
  const secret = process.env.COOKIE_SECRET;
  if (!secret || secret.length < 16) throw new Error('COOKIE_SECRET is not set');
  return createHash('sha256').update(secret).digest();
}

export function seal(data: Session): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url');
}

export function unseal(value: string | undefined): Session | null {
  if (!value) return null;
  try {
    const raw = Buffer.from(value, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const dec = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    const s = JSON.parse(dec) as Session;
    return s.token && s.login ? s : null;
  } catch {
    return null;
  }
}

export function cookies(req: VercelRequest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(name: string, value: string, maxAgeSec: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

/** The signed-in session, or null. Only ALLOWED_GITHUB_LOGIN is ever accepted. */
export function getSession(req: VercelRequest): Session | null {
  const s = unseal(cookies(req)[SESSION_COOKIE]);
  if (!s) return null;
  const allowed = (process.env.ALLOWED_GITHUB_LOGIN ?? '').toLowerCase();
  return allowed && s.login.toLowerCase() === allowed ? s : null;
}

export function origin(req: VercelRequest): string {
  const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host ?? 'localhost';
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export function noStore(res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
}
