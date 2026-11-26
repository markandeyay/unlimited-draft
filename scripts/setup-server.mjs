// npm run setup: serves scripts/setup.html on localhost, writes .env.local and can push the values to Vercel.
// Secrets stay on this machine: they go from the form to .env.local and to the Vercel CLI through stdin.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env.local');
const PORT = Number(process.env.SETUP_PORT || 4599);
const NAMES = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'ALLOWED_GITHUB_LOGIN', 'SCRIPTS_REPO', 'COOKIE_SECRET'];

function readEnv() {
  const out = {};
  if (!existsSync(envPath)) return out;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}

function writeEnv(values) {
  const cur = readEnv();
  const next = { ...cur, ...values };
  if (!next.COOKIE_SECRET) next.COOKIE_SECRET = randomBytes(48).toString('base64url');
  if (!next.ALLOWED_GITHUB_LOGIN) next.ALLOWED_GITHUB_LOGIN = 'markandeyay';
  if (!next.SCRIPTS_REPO) next.SCRIPTS_REPO = 'markandeyay/unlimited-draft-scripts';
  // Keep any other keys already in the file (for example values written by the Vercel CLI).
  const keys = [...NAMES.filter((n) => next[n]), ...Object.keys(next).filter((k) => !NAMES.includes(k))];
  writeFileSync(envPath, `${keys.map((n) => `${n}=${next[n]}`).join('\n')}\n`);
  return next;
}

function vercel(args, input) {
  return new Promise((resolve) => {
    const child = spawn('vercel', args, { cwd: root, shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
    if (input !== undefined) child.stdin.write(input);
    child.stdin.end();
  });
}

/** Push every value in .env.local to Vercel (production, preview and development). Values go through stdin. */
export async function pushToVercel(log = console.log) {
  const env = readEnv();
  const results = [];
  for (const name of NAMES) {
    if (!env[name]) { results.push({ name, ok: false, note: 'missing in .env.local' }); continue; }
    let ok = true;
    for (const target of ['production', 'preview', 'development']) {
      await vercel(['env', 'rm', name, target, '--yes']);
      const args = ['env', 'add', name, target];
      if (target === 'preview') args.push('');
      const r = await vercel(args.filter((a) => a !== ''), env[name]);
      if (r.code !== 0 && target === 'production') ok = false;
    }
    results.push({ name, ok });
    log(`${ok ? 'set' : 'FAILED'} ${name}`);
  }
  return results;
}

const body = (req) => new Promise((resolve) => { let d = ''; req.on('data', (c) => { d += c; }); req.on('end', () => resolve(d)); });

if (process.argv.includes('--push')) {
  const r = await pushToVercel();
  process.exit(r.every((x) => x.ok) ? 0 : 1);
} else {
  const server = createServer(async (req, res) => {
    const json = (code, v) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (req.method === 'GET' && (req.url === '/' || req.url === '/setup.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(readFileSync(join(root, 'scripts', 'setup.html')));
      return;
    }
    if (req.method === 'GET' && req.url === '/status') {
      const env = readEnv();
      json(200, Object.fromEntries(NAMES.map((n) => [n, !!env[n]])));
      return;
    }
    if (req.method === 'POST' && req.url === '/save') {
      const data = Object.fromEntries(new URLSearchParams(await body(req)));
      const values = {};
      if (data.clientId?.trim()) values.GITHUB_CLIENT_ID = data.clientId.trim();
      if (data.clientSecret?.trim()) values.GITHUB_CLIENT_SECRET = data.clientSecret.trim();
      if (data.login?.trim()) values.ALLOWED_GITHUB_LOGIN = data.login.trim();
      if (data.repo?.trim()) values.SCRIPTS_REPO = data.repo.trim();
      const env = writeEnv(values);
      json(200, {
        ok: true,
        written: NAMES.filter((n) => env[n]),
        commands: NAMES.map((n) => `vercel env add ${n} production`),
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/push') {
      json(200, { results: await pushToVercel(() => undefined) });
      return;
    }
    json(404, { error: 'Not found' });
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Setup page: http://localhost:${PORT}/`);
    console.log('Paste the OAuth Client ID and Secret there. Press Ctrl+C when done.');
  });
}
