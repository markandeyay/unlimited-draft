import type { Change, CommitInfo, GitApi, Head, TreeEntry } from '../../src/sync/github';

/** In-memory stand-in for the GitHub Git Data API. */
export class FakeGit implements GitApi {
  blobs = new Map<string, Uint8Array>();
  trees = new Map<string, Record<string, string>>();
  commits = new Map<string, { tree: string; parent: string | null; message: string; date: string }>();
  head: string | null = null;
  calls: string[] = [];
  private n = 0;
  /** Set to make the next updateRef fail like a non-fast-forward. */
  failNextUpdate: (() => Promise<void>) | null = null;

  private id(prefix: string) { return `${prefix}${(++this.n).toString(16).padStart(6, '0')}`; }
  private putBlob(bytes: Uint8Array) { const sha = this.id('b'); this.blobs.set(sha, bytes); return sha; }

  files(): Record<string, string> {
    if (!this.head) return {};
    const tree = this.trees.get(this.commits.get(this.head)!.tree)!;
    return Object.fromEntries(Object.entries(tree).map(([p, sha]) => [p, new TextDecoder().decode(this.blobs.get(sha)!)]));
  }
  log(): string[] {
    const out: string[] = [];
    for (let c = this.head; c; c = this.commits.get(c)!.parent) out.push(this.commits.get(c)!.message);
    return out;
  }

  async getHead(): Promise<Head | null> {
    this.calls.push('getHead');
    return this.head ? { sha: this.head, treeSha: this.commits.get(this.head)!.tree } : null;
  }
  async bootstrap() {
    this.calls.push('bootstrap');
    const tree = this.id('t');
    this.trees.set(tree, { 'README.md': this.putBlob(new TextEncoder().encode('# readme')) });
    const sha = this.id('c');
    this.commits.set(sha, { tree, parent: null, message: 'Initial commit', date: new Date().toISOString() });
    this.head = sha;
  }
  async getTree(treeSha: string): Promise<TreeEntry[]> {
    return Object.entries(this.trees.get(treeSha) ?? {}).map(([path, sha]) => ({ path, sha, type: 'blob' }));
  }
  async readBlob(sha: string) { return this.blobs.get(sha)!; }
  async createBlob(bytes: Uint8Array) { return this.putBlob(bytes); }
  async commit(parent: Head, changes: Change[], message: string): Promise<Head> {
    this.calls.push('commit');
    const tree = { ...(this.trees.get(parent.treeSha) ?? {}) };
    for (const c of changes) {
      if ('delete' in c) delete tree[c.path];
      else if ('blobSha' in c) tree[c.path] = c.blobSha;
      else tree[c.path] = this.putBlob(new TextEncoder().encode(c.content));
    }
    const treeSha = this.id('t');
    this.trees.set(treeSha, tree);
    const sha = this.id('c');
    this.commits.set(sha, { tree: treeSha, parent: parent.sha, message, date: new Date().toISOString() });
    return { sha, treeSha };
  }
  async updateRef(sha: string) {
    if (this.failNextUpdate) {
      const fn = this.failNextUpdate;
      this.failNextUpdate = null;
      await fn();
      return false;
    }
    if (this.commits.get(sha)!.parent !== this.head) return false;
    this.head = sha;
    return true;
  }
  async listCommits(path: string): Promise<CommitInfo[]> {
    const out: CommitInfo[] = [];
    for (let c = this.head; c; c = this.commits.get(c)!.parent) {
      const cm = this.commits.get(c)!;
      const cur = this.trees.get(cm.tree)![path];
      const prev = cm.parent ? this.trees.get(this.commits.get(cm.parent)!.tree)![path] : undefined;
      if (cur !== prev) out.push({ sha: c, date: cm.date, message: cm.message });
    }
    return out;
  }
  async readFileAt(path: string, ref: string) {
    const cm = this.commits.get(ref);
    const sha = cm ? this.trees.get(cm.tree)![path] : undefined;
    return sha ? new TextDecoder().decode(this.blobs.get(sha)!) : null;
  }
  commitUrl(sha: string) { return `https://example.test/commit/${sha}`; }
}
