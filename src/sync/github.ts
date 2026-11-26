// Git Data API client. All requests go through /api/github, which attaches the token server-side.
import { Octokit } from '@octokit/rest';

export interface TreeEntry { path: string; sha: string; type: string }
export type Change =
  | { path: string; content: string }
  | { path: string; blobSha: string }
  | { path: string; delete: true };

export interface Head { sha: string; treeSha: string }
export interface CommitInfo { sha: string; date: string; message: string }

export interface GitApi {
  /** null when the repository has no commits yet. */
  getHead(): Promise<Head | null>;
  /** Create the first commit with the Contents API. */
  bootstrap(): Promise<void>;
  getTree(treeSha: string): Promise<TreeEntry[]>;
  readBlob(sha: string): Promise<Uint8Array>;
  createBlob(bytes: Uint8Array): Promise<string>;
  commit(parent: Head, changes: Change[], message: string): Promise<Head>;
  /** false on a non-fast-forward. */
  updateRef(sha: string): Promise<boolean>;
  listCommits(path: string, page?: number): Promise<CommitInfo[]>;
  readFileAt(path: string, ref: string): Promise<string | null>;
  commitUrl(sha: string): string;
}

const BRANCH = 'main';
export const utf8 = (b: Uint8Array) => new TextDecoder().decode(b);

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export class AuthError extends Error {}

export function createGitHubApi(repoFull: string): GitApi {
  const [owner, repo] = repoFull.split('/');
  const octokit = new Octokit({ baseUrl: `${location.origin}/api/github`, request: { retries: 0 } });
  const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
    try { return await fn(); } catch (e: any) {
      if (e?.status === 401) throw new AuthError('Not signed in');
      throw e;
    }
  };
  return {
    async getHead() {
      try {
        const ref = await octokit.git.getRef({ owner, repo, ref: `heads/${BRANCH}` });
        const c = await octokit.git.getCommit({ owner, repo, commit_sha: ref.data.object.sha });
        return { sha: c.data.sha, treeSha: c.data.tree.sha };
      } catch (e: any) {
        if (e?.status === 409 || e?.status === 404) return null;
        if (e?.status === 401) throw new AuthError('Not signed in');
        throw e;
      }
    },
    async bootstrap() {
      await wrap(() => octokit.repos.createOrUpdateFileContents({
        owner, repo, path: 'README.md', branch: BRANCH, message: 'Initial commit',
        content: bytesToB64(new TextEncoder().encode('# Unlimited Draft scripts\n\nWritten by the Unlimited Draft app. Do not edit by hand.\n')),
      }));
    },
    async getTree(treeSha) {
      const t = await wrap(() => octokit.git.getTree({ owner, repo, tree_sha: treeSha, recursive: 'true' }));
      return t.data.tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path!, sha: e.sha!, type: e.type! }));
    },
    async readBlob(sha) {
      const b = await wrap(() => octokit.git.getBlob({ owner, repo, file_sha: sha }));
      return b64ToBytes(b.data.content);
    },
    async createBlob(bytes) {
      const b = await wrap(() => octokit.git.createBlob({ owner, repo, content: bytesToB64(bytes), encoding: 'base64' }));
      return b.data.sha;
    },
    async commit(parent, changes, message) {
      const tree = changes.map((c) => {
        if ('delete' in c) return { path: c.path, mode: '100644' as const, type: 'blob' as const, sha: null };
        if ('blobSha' in c) return { path: c.path, mode: '100644' as const, type: 'blob' as const, sha: c.blobSha };
        return { path: c.path, mode: '100644' as const, type: 'blob' as const, content: c.content };
      });
      const t = await wrap(() => octokit.git.createTree({ owner, repo, base_tree: parent.treeSha, tree: tree as any }));
      const c = await wrap(() => octokit.git.createCommit({ owner, repo, message, tree: t.data.sha, parents: [parent.sha] }));
      return { sha: c.data.sha, treeSha: t.data.sha };
    },
    async updateRef(sha) {
      try {
        await octokit.git.updateRef({ owner, repo, ref: `heads/${BRANCH}`, sha, force: false });
        return true;
      } catch (e: any) {
        if (e?.status === 422 || e?.status === 409) return false;
        if (e?.status === 401) throw new AuthError('Not signed in');
        throw e;
      }
    },
    async listCommits(path, page = 1) {
      const r = await wrap(() => octokit.repos.listCommits({ owner, repo, path, per_page: 100, page }));
      return r.data.map((c) => ({ sha: c.sha, date: c.commit.committer?.date ?? c.commit.author?.date ?? '', message: c.commit.message }));
    },
    async readFileAt(path, ref) {
      try {
        const r = await octokit.repos.getContent({ owner, repo, path, ref });
        const d = r.data as any;
        if (d.content) return utf8(b64ToBytes(d.content));
        if (d.sha) return utf8(await this.readBlob(d.sha));
        return null;
      } catch (e: any) {
        if (e?.status === 404) return null;
        if (e?.status === 401) throw new AuthError('Not signed in');
        throw e;
      }
    },
    commitUrl: (sha) => `https://github.com/${owner}/${repo}/commit/${sha}`,
  };
}
