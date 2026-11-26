import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { useApp } from '../../src/app/store';
import * as store from '../../src/storage/db';
import type { DocumentFile } from '../../src/storage/models';
import { resetSyncForTests, setGitApi, syncNow } from '../../src/sync/engine';
import { mergeDocuments } from '../../src/sync/merge';
import { FakeGit } from './fakeGit';

async function wipe() {
  await Promise.all(store.db.tables.map((t) => t.clear()));
  resetSyncForTests();
}

describe('sync engine', () => {
  beforeEach(wipe);

  it('bootstraps an empty repo with a first commit, then commits the project', async () => {
    const git = new FakeGit();
    setGitApi(git);
    const p = await store.createProject('My Script');
    expect(await syncNow()).toBe(true);
    expect(git.calls).toContain('bootstrap');
    const files = git.files();
    expect(Object.keys(files)).toContain('README.md');
    expect(Object.keys(files)).toContain('library.json');
    expect(Object.keys(files)).toContain(`projects/${p.path}/project.json`);
    const docs = await store.getDocuments(p.id);
    for (const d of docs) {
      expect(files[`projects/${p.path}/documents/${d.id}.json`]).toBeTruthy();
      expect(files[`projects/${p.path}/documents/${d.id}.fountain`]).toBeDefined();
    }
    expect(JSON.parse(files['library.json']).projects[0].name).toBe('My Script');
    expect(await store.db.syncQueue.count()).toBe(0);
    expect(useApp.getState().sync.state).toBe('synced');
  });

  it('batches several saves into one commit with the right message', async () => {
    const git = new FakeGit();
    setGitApi(git);
    const p = await store.createProject('Batch');
    await syncNow();
    const before = git.log().length;
    const script = (await store.getDocuments(p.id))[0];
    for (let i = 0; i < 5; i++) {
      script.lines[0].text = `Edit ${i}`;
      await store.saveDocument(script, 1);
    }
    await syncNow();
    expect(git.log().length).toBe(before + 1);
    expect(git.log()[0]).toBe('Edit: Batch / Script');
    const saved = JSON.parse(git.files()[`projects/${p.path}/documents/${script.id}.json`]) as DocumentFile;
    expect(saved.lines[0].text).toBe('Edit 4');
  });

  it('uses the snapshot message when given one', async () => {
    const git = new FakeGit();
    setGitApi(git);
    const p = await store.createProject('Snap');
    await syncNow();
    const script = (await store.getDocuments(p.id))[0];
    script.lines[0].text = 'x';
    await store.saveDocument(script);
    await syncNow('Snapshot: First draft');
    expect(git.log()[0]).toBe('Snapshot: First draft');
  });

  it('merges on a non-fast-forward and retries', async () => {
    const git = new FakeGit();
    setGitApi(git);
    const p = await store.createProject('Merge');
    const script = (await store.getDocuments(p.id))[0];
    script.lines = [store.makeLine('action', 'One.'), store.makeLine('action', 'Two.')];
    await store.saveDocument(script);
    await syncNow();
    const path = `projects/${p.path}/documents/${script.id}.json`;

    // Local edit to line 1.
    await new Promise((r) => setTimeout(r, 5));
    const local = (await store.getDocument(script.id))!;
    local.lines[0] = { ...local.lines[0], text: 'One, edited here.', updatedAt: new Date().toISOString() };
    await store.saveDocument(local);

    // Another device edits line 2 and pushes first.
    git.failNextUpdate = async () => {
      const head = (await git.getHead())!;
      const remote = JSON.parse(git.files()[path]) as DocumentFile;
      remote.lines[1] = { ...remote.lines[1], text: 'Two, edited on the phone.', updatedAt: new Date().toISOString() };
      remote.lines.push({ ...store.makeLine('action', 'Three, new on the phone.') });
      remote.updatedAt = new Date().toISOString();
      const c = await git.commit(head, [{ path, content: JSON.stringify(remote) }], 'Edit: Merge / Script');
      git.head = c.sha;
    };
    expect(await syncNow()).toBe(true);
    const merged = JSON.parse(git.files()[path]) as DocumentFile;
    expect(merged.lines.map((l) => l.text)).toEqual(['One, edited here.', 'Two, edited on the phone.', 'Three, new on the phone.']);
    expect((await store.getDocument(script.id))!.lines.length).toBe(3);
    expect(useApp.getState().notice).toBe('Merged changes from another device.');
  });

  it('pulls projects created on another device', async () => {
    const git = new FakeGit();
    setGitApi(git);
    const p = await store.createProject('Remote One');
    await syncNow();
    // A fresh device: empty database, same repo.
    await wipe();
    setGitApi(git);
    await syncNow();
    const projects = await store.listProjects();
    expect(projects.map((x) => x.name)).toEqual(['Remote One']);
    expect((await store.getDocuments(p.id)).length).toBe(3);
  });

  it('removes a deleted project from the repo', async () => {
    const git = new FakeGit();
    setGitApi(git);
    const p = await store.createProject('Gone');
    await syncNow();
    await store.removeProject(p.id);
    await syncNow();
    expect(Object.keys(git.files()).some((f) => f.startsWith(`projects/${p.path}/`))).toBe(false);
    expect(JSON.parse(git.files()['library.json']).projects).toEqual([]);
  });

  it('keeps a document that was deleted remotely but edited here', async () => {
    const git = new FakeGit();
    setGitApi(git);
    const p = await store.createProject('Keep');
    await syncNow();
    const script = (await store.getDocuments(p.id))[0];
    // Remote deletes the project.
    const head = (await git.getHead())!;
    const tree = await git.getTree(head.treeSha);
    const c = await git.commit(head, tree.filter((e) => e.path.startsWith(`projects/${p.path}/`)).map((e) => ({ path: e.path, delete: true as const })), 'Remove');
    git.head = c.sha;
    // Local edit happens before the next sync.
    script.lines[0].text = 'Still writing this.';
    await store.saveDocument(script);
    await syncNow();
    expect((await store.getProject(p.id))?.name).toBe('Keep');
    expect(git.files()[`projects/${p.path}/documents/${script.id}.json`]).toContain('Still writing this.');
  });

  it('reports signed out when there is no API', async () => {
    setGitApi(null);
    await store.createProject('Local only');
    expect(await syncNow()).toBe(false);
    expect(useApp.getState().sync.state).toBe('signedout');
    expect(await store.db.syncQueue.count()).toBeGreaterThan(0);
  });
});

describe('mergeDocuments', () => {
  const base = (lines: [string, string, string][], updatedAt: string): DocumentFile => ({
    schema: 1, id: 'd', projectId: 'p', kind: 'script', name: 'Script',
    settings: { header: { left: '', center: '', right: '' }, footer: { left: '', center: '', right: '' }, sceneContinueds: false, sceneNumberStart: 1, sceneNumberSide: 'both' },
    lines: lines.map(([id, text, at]) => ({ id, type: 'action', text, createdAt: '2026-01-01T00:00:00Z', updatedAt: at })),
    sceneNumbers: { enabled: false, locked: false }, revision: { tracking: false, color: 'Blue' }, updatedAt,
  });
  const sync = '2026-06-01T00:00:00Z';
  const old = '2026-05-01T00:00:00Z';

  it('takes the side that changed', () => {
    const local = base([['a', 'A local', '2026-06-02T00:00:00Z'], ['b', 'B', old]], '2026-06-02T00:00:00Z');
    const remote = base([['a', 'A', old], ['b', 'B remote', '2026-06-03T00:00:00Z']], '2026-06-03T00:00:00Z');
    expect(mergeDocuments(local, remote, sync).lines.map((l) => l.text)).toEqual(['A local', 'B remote']);
  });

  it('takes the newer line when both changed and keeps the other in history', () => {
    const local = base([['a', 'A local', '2026-06-02T00:00:00Z']], '2026-06-02T00:00:00Z');
    const remote = base([['a', 'A remote', '2026-06-03T00:00:00Z']], '2026-06-03T00:00:00Z');
    const m = mergeDocuments(local, remote, sync);
    expect(m.lines[0].text).toBe('A remote');
    expect(m.lines[0].history?.[0].text).toBe('A local');
  });

  it('keeps new lines from both sides and drops lines deleted on one side', () => {
    const local = base([['a', 'A', old], ['n1', 'New local', '2026-06-02T00:00:00Z'], ['c', 'C', old]], '2026-06-02T00:00:00Z');
    local.lines[1].createdAt = '2026-06-02T00:00:00Z';
    const remote = base([['a', 'A', old], ['b', 'B', old], ['n2', 'New remote', '2026-06-03T00:00:00Z']], '2026-06-03T00:00:00Z');
    remote.lines[2].createdAt = '2026-06-03T00:00:00Z';
    // b was deleted locally, c was deleted remotely.
    const texts = mergeDocuments(local, remote, sync).lines.map((l) => l.text);
    expect(texts).toContain('New local');
    expect(texts).toContain('New remote');
    expect(texts).not.toContain('B');
    expect(texts).not.toContain('C');
    expect(texts[0]).toBe('A');
  });
});
