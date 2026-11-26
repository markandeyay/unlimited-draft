// Scene numbering. Pure: no DOM.

export interface SceneLine { id: string; type: string; sceneNumber?: string }

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Unlocked: scenes are numbered in order from `start`.
 * Locked: scenes that already have a number keep it; a new scene after "12" becomes "12A", then "12B".
 */
export function computeSceneNumbers(lines: readonly SceneLine[], opts: { locked: boolean; start: number }): Map<string, string> {
  const out = new Map<string, string>();
  if (!opts.locked) {
    let n = opts.start;
    for (const l of lines) if (l.type === 'scene') out.set(l.id, String(n++));
    return out;
  }
  let lastBase = String(opts.start - 1);
  let suffix = 0;
  for (const l of lines) {
    if (l.type !== 'scene') continue;
    if (l.sceneNumber) {
      out.set(l.id, l.sceneNumber);
      lastBase = l.sceneNumber;
      suffix = 0;
    } else {
      const base = lastBase.replace(/[A-Z]+$/, '');
      const startAt = lastBase.length > base.length ? LETTERS.indexOf(lastBase.slice(base.length)) + 1 : 0;
      const idx = startAt + suffix;
      out.set(l.id, `${base}${LETTERS[idx % 26]}${idx >= 26 ? Math.floor(idx / 26) : ''}`);
      suffix++;
    }
  }
  return out;
}
