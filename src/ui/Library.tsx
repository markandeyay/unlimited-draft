import { Clock, EllipsisVertical, FileUp, Folder as FolderIcon, FolderPlus, Library as LibraryIcon, Pencil, Plus, Search, Trash2, User } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { openProject } from '../app/project';
import { useApp } from '../app/store';
import { type SearchHit, highlightParts, searchAll } from '../search';
import * as store from '../storage/db';
import type { Folder, ProjectFile } from '../storage/models';
import { actions, ask, confirmDialog } from './actions';
import { MenuList } from './MenuBar';
import { SaveStatus } from './Panels';
import css from './library.module.css';

type View = { kind: 'recents' } | { kind: 'all' } | { kind: 'folder'; id: string };
type Sort = 'edited' | 'name' | 'created';

const ago = (iso: string) => {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)} d ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};

export function Library() {
  const version = useApp((s) => s.libraryVersion);
  const auth = useApp((s) => s.auth);
  const [projects, setProjects] = useState<ProjectFile[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [view, setView] = useState<View>({ kind: 'all' });
  const [sort, setSort] = useState<Sort>('edited');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [menu, setMenu] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const dragId = useRef<string | null>(null);
  const reload = () => setTick((t) => t + 1);

  useEffect(() => {
    void Promise.all([store.listProjects(), store.getFolders()]).then(([p, f]) => { setProjects(p); setFolders(f); });
  }, [version, tick]);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => { void searchAll(query).then((h) => { if (live) setHits(h); }); }, 180);
    return () => { live = false; clearTimeout(t); };
  }, [query, version, tick]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menu]);

  const folderName = (id?: string) => folders.find((f) => f.id === id)?.name;
  const shown = useMemo(() => {
    let list = projects;
    if (view.kind === 'folder') {
      const ids = new Set([view.id, ...folders.filter((f) => f.parentId === view.id).map((f) => f.id)]);
      list = list.filter((p) => p.folderId && ids.has(p.folderId));
    }
    if (view.kind === 'recents') list = list.filter((p) => p.openedAt).sort((a, b) => (b.openedAt ?? '').localeCompare(a.openedAt ?? '')).slice(0, 12);
    else if (sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'created') list = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    else list = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return list;
  }, [projects, folders, view, sort]);

  const matchedProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : [];
  }, [projects, query]);

  const addFolder = async (parentId?: string) => {
    const name = await ask(parentId ? 'New Subfolder' : 'New Folder', { label: 'Folder name', value: '', confirmText: 'Create' });
    if (!name?.trim()) return;
    await store.saveFolders([...folders, { id: store.newId(), name: name.trim(), parentId }]);
    reload();
  };
  const renameFolder = async (f: Folder) => {
    const name = await ask('Rename Folder', { label: 'Folder name', value: f.name, confirmText: 'Rename' });
    if (!name?.trim()) return;
    await store.saveFolders(folders.map((x) => (x.id === f.id ? { ...x, name: name.trim() } : x)));
    reload();
  };
  const deleteFolder = async (f: Folder) => {
    if (!(await confirmDialog('Delete Folder', `Delete the folder "${f.name}"? Projects inside it are kept and moved to All Projects.`, 'Delete', true))) return;
    const gone = new Set([f.id, ...folders.filter((x) => x.parentId === f.id).map((x) => x.id)]);
    for (const p of projects) if (p.folderId && gone.has(p.folderId)) await store.updateProject(p.id, (x) => { x.folderId = undefined; }, false);
    await store.saveFolders(folders.filter((x) => !gone.has(x.id)));
    if (view.kind === 'folder' && gone.has(view.id)) setView({ kind: 'all' });
    reload();
  };
  const moveTo = async (projectId: string, folderId?: string) => {
    await store.updateProject(projectId, (p) => { p.folderId = folderId; }, false);
    reload();
  };
  const create = async () => {
    const name = await ask('New Project', { label: 'Project name', value: 'Untitled Project', confirmText: 'Create' });
    if (name === null) return;
    const p = await store.createProject(name.trim() || 'Untitled Project', { folderId: view.kind === 'folder' ? view.id : undefined });
    await openProject(p.id);
  };
  const projectMenu = (p: ProjectFile) => [
    { label: 'Open', action: () => void openProject(p.id) },
    { label: 'Rename...', action: async () => { const n = await ask('Rename Project', { label: 'Project name', value: p.name, confirmText: 'Rename' }); if (n?.trim()) { await store.renameProject(p.id, n.trim()); reload(); } } },
    { label: 'Duplicate', action: async () => { await store.duplicateProject(p.id); reload(); } },
    { label: 'Move to', sub: [{ label: 'No folder', action: () => void moveTo(p.id, undefined) }, ...folders.map((f) => ({ label: f.parentId ? `${folderName(f.parentId)} / ${f.name}` : f.name, action: () => void moveTo(p.id, f.id) }))] },
    'sep' as const,
    { label: 'Remove...', action: async () => { if (await confirmDialog('Remove Project', `Remove "${p.name}"? It is deleted from this device and from the scripts repo.`, 'Remove', true)) { await store.removeProject(p.id); reload(); } } },
  ];

  const folderRow = (f: Folder, depth: number) => (
    <button
      key={f.id}
      className={`${css.sideItem} ${view.kind === 'folder' && view.id === f.id ? css.sideActive : ''} ${dropOn === f.id ? css.sideDrop : ''}`}
      style={{ paddingLeft: 16 + depth * 18 }}
      onClick={() => setView({ kind: 'folder', id: f.id })}
      onDragOver={(e) => { e.preventDefault(); setDropOn(f.id); }}
      onDragLeave={() => setDropOn(null)}
      onDrop={(e) => { e.preventDefault(); setDropOn(null); if (dragId.current) void moveTo(dragId.current, f.id); }}
      data-testid="folder"
    >
      <FolderIcon size={15} />
      <span className={css.sideLabel}>{f.name}</span>
      <span className={css.folderTools} onClick={(e) => e.stopPropagation()}>
        {depth === 0 && <span role="button" title="New subfolder" onClick={() => void addFolder(f.id)}><FolderPlus size={13} /></span>}
        <span role="button" title="Rename" onClick={() => void renameFolder(f)}><Pencil size={13} /></span>
        <span role="button" title="Delete" onClick={() => void deleteFolder(f)}><Trash2 size={13} /></span>
      </span>
    </button>
  );

  const title = view.kind === 'recents' ? 'Recents' : view.kind === 'all' ? 'All Projects' : folderName(view.id) ?? 'Folder';
  const searching = query.trim().length >= 2;

  return (
    <div className={css.lib} data-testid="library">
      <div className={css.side}>
        <div className={css.brand}><img src="/icon.svg" alt="" />Unlimited Draft</div>
        <button className={`${css.sideItem} ${view.kind === 'recents' ? css.sideActive : ''}`} onClick={() => setView({ kind: 'recents' })}><Clock size={15} /><span className={css.sideLabel}>Recents</span></button>
        <button
          className={`${css.sideItem} ${view.kind === 'all' ? css.sideActive : ''} ${dropOn === 'all' ? css.sideDrop : ''}`}
          onClick={() => setView({ kind: 'all' })}
          onDragOver={(e) => { e.preventDefault(); setDropOn('all'); }}
          onDragLeave={() => setDropOn(null)}
          onDrop={(e) => { e.preventDefault(); setDropOn(null); if (dragId.current) void moveTo(dragId.current, undefined); }}
        >
          <LibraryIcon size={15} /><span className={css.sideLabel}>All Projects</span>
        </button>
        <div className={css.sideHead}>Folders<button title="New folder" onClick={() => void addFolder()} data-testid="new-folder"><FolderPlus size={15} /></button></div>
        {folders.filter((f) => !f.parentId).map((f) => [folderRow(f, 0), ...folders.filter((c) => c.parentId === f.id).map((c) => folderRow(c, 1))])}
        <div className={css.sideFoot}>
          {auth.login
            ? <div className={css.sideItem} style={{ cursor: 'default' }}><User size={15} /><span className={css.sideLabel}>{auth.login}</span></div>
            : <a className={css.sideItem} href="/api/auth/login" style={{ textDecoration: 'none' }}><User size={15} /><span className={css.sideLabel}>Sign in with GitHub</span></a>}
          <SaveStatus />
        </div>
      </div>
      <div className={css.main}>
        <div className={css.top}>
          <div className={css.search}>
            <Search size={16} />
            <input placeholder="Search every script" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="library-search" />
          </div>
          <div className={css.spacer} />
          <select className={css.sort} value={sort} onChange={(e) => setSort(e.target.value as Sort)} title="Sort">
            <option value="edited">Last edited</option>
            <option value="name">Name</option>
            <option value="created">Created</option>
          </select>
          <button className="ud-btn secondary" style={{ height: 32 }} onClick={actions.importFile}><FileUp size={15} />Import</button>
          <button className="ud-btn" style={{ height: 32 }} onClick={create} data-testid="new-project"><Plus size={15} />New Project</button>
        </div>
        <div className={css.body}>
          {searching ? (
            <div data-testid="search-results">
              <div className={css.heading}>Search results</div>
              {matchedProjects.length > 0 && <div className={css.groupTitle}>Projects</div>}
              {matchedProjects.map((p) => (
                <button key={p.id} className={css.hit} onClick={() => void openProject(p.id)}><div className={css.hitText}>{p.name}</div></button>
              ))}
              <div className={css.groupTitle}>Lines</div>
              {hits.length === 0 && <div className={css.emptyLib} style={{ padding: 20 }}>No matching lines.</div>}
              {hits.map((h) => (
                <button key={`${h.docId}:${h.lineId}`} className={css.hit} data-testid="search-hit" onClick={() => void openProject(h.projectId, h.docId, h.lineId)}>
                  <div className={css.hitTitle}>{h.projectName} / {h.docName}</div>
                  <div className={css.hitText}>{highlightParts(h.text, query).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}</div>
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className={css.heading}>{title}</div>
              {shown.length === 0 && (
                <div className={css.emptyLib}>
                  {projects.length === 0 ? 'No projects yet. Create your first script.' : 'Nothing here yet.'}
                  <br />
                  <button className="ud-btn" style={{ marginTop: 14, height: 34 }} onClick={create}><Plus size={15} />New Project</button>
                </div>
              )}
              <div className={css.grid}>
                {shown.map((p) => (
                  <div
                    key={p.id}
                    className={css.proj}
                    draggable
                    data-testid="project-card"
                    onDragStart={() => { dragId.current = p.id; }}
                    onDragEnd={() => { dragId.current = null; }}
                    onClick={() => void openProject(p.id)}
                  >
                    <div className={css.thumb}>{p.name}<small>written by</small></div>
                    <div className={css.meta}>
                      <div className={css.name} title={p.name}>{p.name}</div>
                      <div className={css.sub}>
                        <span>{p.pageCount} {p.pageCount === 1 ? 'page' : 'pages'}</span>
                        <span>{ago(p.updatedAt)}</span>
                        {p.folderId && folderName(p.folderId) && <span>{folderName(p.folderId)}</span>}
                      </div>
                    </div>
                    <button className={css.projMenu} title="Project menu" data-testid="project-menu" onClick={(e) => { e.stopPropagation(); setMenu(menu === p.id ? null : p.id); }}>
                      <EllipsisVertical size={15} />
                    </button>
                    {menu === p.id && (
                      <div style={{ position: 'absolute', top: 32, right: 6, zIndex: 20 }} onClick={(e) => e.stopPropagation()}>
                        <MenuList items={projectMenu(p)} onClose={() => setMenu(null)} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
