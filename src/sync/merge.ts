// Line-by-line merge of one document edited on two devices. Pure, no I/O.
import type { DocumentFile, Line } from '../storage/models';

const same = (a: Line, b: Line) =>
  a.text === b.text && a.type === b.type && a.dual === b.dual && JSON.stringify(a.marks ?? []) === JSON.stringify(b.marks ?? [])
  && !!a.omitted === !!b.omitted && a.sceneNumber === b.sceneNumber && !!a.revisionMarked === !!b.revisionMarked;

/**
 * Merge `remote` into `local`.
 * - A line changed on one side only takes that side.
 * - A line changed on both sides takes the newer `updatedAt`; the other version goes into the line's history.
 * - A line that exists on one side only is kept if it was created or edited after `lastSyncAt`
 *   (it is new there), otherwise it was deleted on the other side and is dropped.
 */
export function mergeDocuments(local: DocumentFile, remote: DocumentFile, lastSyncAt: string): DocumentFile {
  const L = new Map(local.lines.map((l) => [l.id, l]));
  const R = new Map(remote.lines.map((l) => [l.id, l]));
  const newer = remote.updatedAt > local.updatedAt ? remote : local;
  const older = newer === remote ? local : remote;
  const N = newer === remote ? R : L;
  const O = newer === remote ? L : R;

  const pick = (id: string): Line | null => {
    const a = L.get(id), b = R.get(id);
    if (a && b) {
      if (same(a, b)) return a.updatedAt >= b.updatedAt ? a : b;
      const aChanged = a.updatedAt > lastSyncAt, bChanged = b.updatedAt > lastSyncAt;
      if (aChanged && !bChanged) return a;
      if (bChanged && !aChanged) return b;
      const win = a.updatedAt >= b.updatedAt ? a : b;
      const lose = win === a ? b : a;
      const history = [...(win.history ?? []), ...(lose.history ?? []), { text: lose.text, type: lose.type, at: lose.updatedAt }]
        .sort((x, y) => x.at.localeCompare(y.at)).slice(-20);
      return { ...win, history };
    }
    const only = (a ?? b)!;
    return only.updatedAt > lastSyncAt || only.createdAt > lastSyncAt ? only : null;
  };

  const out: Line[] = [];
  const done = new Set<string>();
  // Lines that exist only on the older side are placed after the line they followed there.
  const followers = new Map<string, Line[]>();
  let prev = '';
  for (const l of older.lines) {
    if (!N.has(l.id)) {
      const arr = followers.get(prev) ?? [];
      arr.push(l);
      followers.set(prev, arr);
    } else {
      prev = l.id;
    }
  }
  const emit = (id: string) => {
    if (done.has(id)) return;
    done.add(id);
    const line = pick(id);
    if (line) out.push(line);
  };
  for (const l of followers.get('') ?? []) emit(l.id);
  for (const l of newer.lines) {
    emit(l.id);
    for (const f of followers.get(l.id) ?? []) emit(f.id);
  }
  void O;
  if (!out.length) out.push(...newer.lines.slice(0, 1));
  return {
    ...newer,
    lines: out,
    updatedAt: new Date().toISOString(),
  };
}
