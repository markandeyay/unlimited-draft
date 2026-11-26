import { useEffect, useState } from 'react';
import { mergeSettings, setSettingsPersister, useSettings } from '../settings/settings';
import { SpellLayer } from '../spell/SpellLayer';
import * as store from '../storage/db';
import { onRemoteChange, setGitApi, startSync, syncNow } from '../sync/engine';
import { createGitHubApi } from '../sync/github';
import { DialogHost } from '../ui/Dialogs';
import { Library } from '../ui/Library';
import { Shell } from '../ui/Shell';
import { openProject, refreshProject } from './project';
import { activeDoc, navigate, parseRoute, useApp } from './store';

async function checkAuth() {
  try {
    const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
    const type = r.headers.get('content-type') ?? '';
    if (r.ok && type.includes('json')) {
      const me = (await r.json()) as { login: string; avatar?: string; repo: string };
      await store.db.settings.put({ key: 'repo', value: me.repo });
      await store.db.settings.put({ key: 'authCache', value: { login: me.login, avatar: me.avatar } });
      useApp.setState({ auth: { checked: true, login: me.login, avatar: me.avatar } });
      setGitApi(createGitHubApi(me.repo));
      startSync();
      void syncNow();
      return;
    }
    useApp.setState({ auth: { checked: true }, sync: { ...useApp.getState().sync, state: 'signedout' } });
  } catch {
    // Offline: show who was signed in last time; sync waits until the cookie can be checked again.
    const cached = (await store.db.settings.get('authCache'))?.value;
    useApp.setState({ auth: { checked: true, ...(cached ?? {}) }, sync: { ...useApp.getState().sync, state: 'offline' } });
    window.addEventListener('online', () => void checkAuth(), { once: true });
  }
}

export function App() {
  const route = useApp((s) => s.route);
  const project = useApp((s) => s.project);
  const dark = useSettings((s) => s.settings.display.darkMode);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      const saved = await store.loadSettings();
      useSettings.getState().replace(mergeSettings(saved));
      setSettingsPersister((s) => { void store.saveSettings(s); });
      const r = parseRoute(location.pathname, location.search);
      if (r.name === 'project') {
        const ok = await openProject(r.projectId, r.docId, r.lineId);
        if (!ok) navigate({ name: 'library' }, true);
      } else {
        useApp.setState({ route: r });
      }
      setReady(true);
      void navigator.storage?.persist?.().catch(() => undefined);
      onRemoteChange(() => {
        const st = useApp.getState();
        useApp.setState({ libraryVersion: st.libraryVersion + 1 });
        if (!st.project) return;
        const before = activeDoc(st)?.updatedAt;
        void refreshProject().then(() => {
          const now = useApp.getState();
          const after = activeDoc(now);
          if (after && after.updatedAt !== before) {
            // The open document changed on another device: remount the editor with the merged lines.
            const id = now.activeDocId;
            useApp.setState({ activeDocId: null });
            setTimeout(() => useApp.setState({ activeDocId: id }), 0);
          }
        });
      });
      void checkAuth();
    })();
    const pop = () => {
      const r = parseRoute(location.pathname, location.search);
      if (r.name === 'project') void openProject(r.projectId, r.docId, r.lineId);
      else useApp.setState({ route: r, project: null, docs: [], activeDocId: null });
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);

  useEffect(() => { document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => { document.title = project ? `${project.name} - Unlimited Draft` : 'Unlimited Draft'; }, [project?.name]);

  if (!ready) return null;
  return (
    <>
      {route.name === 'project' && project ? <Shell /> : <Library />}
      {route.name === 'project' && project && <SpellLayer />}
      <DialogHost />
    </>
  );
}
