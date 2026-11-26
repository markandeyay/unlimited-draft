import { useMemo, useState } from 'react';
import { useApp } from '../../app/store';
import * as cmd from '../../editor/commands';
import { currentLines, exec, getView } from '../../editor/controller';
import { getLayout } from '../../editor/layoutPlugin';
import { buildReportPdf, downloadBytes } from '../../pdf/export';
import { characterSceneIds, characterStats, dialogueIds, documentStats, nonDialogueIds, splitScenes } from '../../reports/analyze';
import { geometryFromSettings, useSettings } from '../../settings/settings';
import { makePdf } from '../actions';
import { Check, Dialog } from '../Dialogs';
import css from '../dialogs.module.css';

function pageOf(): (id: string) => number {
  const view = getView();
  const info = view ? getLayout(view.state)?.result.info : undefined;
  return (id) => (info?.get(id)?.page ?? 0) + 1;
}

async function exportReport(title: string, rows: string[]) {
  const g = geometryFromSettings(useSettings.getState().settings);
  const bytes = await buildReportPdf(title, rows, g);
  const p = useApp.getState().project;
  downloadBytes(bytes, `${p?.name ?? 'Script'} - ${title}.pdf`);
}

const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}~` : s.padEnd(n));

export default function ReportDialog({ kind }: { kind: string }) {
  const close = useApp((s) => s.closeDialog);
  const project = useApp((s) => s.project);
  const lines = useMemo(() => currentLines(), []);
  const total = useApp((s) => s.cursor.total);
  const page = useMemo(() => pageOf(), []);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const chars = useMemo(() => characterStats(lines), [lines]);
  const jump = (id: string) => { close(); setTimeout(() => exec(cmd.jumpToLine(id)), 20); };
  const toggle = (n: string) => { const s = new Set(picked); if (s.has(n)) s.delete(n); else s.add(n); setPicked(s); };
  const name = project?.name ?? 'Script';

  if (kind === 'stats') {
    const st = documentStats(lines, total);
    const rows = [
      `Pages: ${st.pages}`, `Scenes: ${st.scenes}`, `Words: ${st.words}`, `Speaking characters: ${st.characters}`,
      `Dialogue: ${st.dialoguePct}%   Action: ${st.actionPct}%`, `Estimated runtime: ${st.runtimeMin} min`, '',
      'LINES PER CHARACTER', `${pad('Character', 26)}${pad('Speeches', 10)}${pad('Lines', 8)}Words`,
      ...st.byCharacter.map((c) => `${pad(c.name, 26)}${pad(String(c.speeches), 10)}${pad(String(c.dialogueLines), 8)}${c.words}`), '',
      'SCENES PER LOCATION', ...st.byLocation.map((l) => `${pad(l.location, 46)}${l.scenes}`),
    ];
    return (
      <Dialog title="Document Statistics" size="wide" footer={<button className="ud-btn" onClick={() => exportReport('Document Statistics', rows)} data-testid="report-export">Export PDF</button>}>
        <div className={css.statGrid} data-testid="stats">
          <div className={css.stat}><b>{st.pages}</b><span>Pages</span></div>
          <div className={css.stat}><b>{st.scenes}</b><span>Scenes</span></div>
          <div className={css.stat}><b>{st.words.toLocaleString()}</b><span>Words</span></div>
          <div className={css.stat}><b>{st.characters}</b><span>Characters</span></div>
          <div className={css.stat}><b>{st.runtimeMin} min</b><span>Estimated runtime</span></div>
        </div>
        <div style={{ marginBottom: 4 }}>Dialogue {st.dialoguePct}% / Action {st.actionPct}%</div>
        <div className={css.bar} style={{ marginBottom: 14 }}><i style={{ width: `${st.dialoguePct}%` }} /></div>
        <div className={css.cols}>
          <div>
            <div className={css.section}>Lines per character</div>
            <table className={css.table}><thead><tr><th>Character</th><th>Speeches</th><th>Lines</th><th>Words</th><th>Scenes</th></tr></thead>
              <tbody>{st.byCharacter.map((c) => <tr key={c.name}><td>{c.name}</td><td>{c.speeches}</td><td>{c.dialogueLines}</td><td>{c.words}</td><td>{c.scenes}</td></tr>)}</tbody></table>
          </div>
          <div>
            <div className={css.section}>Scenes per location</div>
            <table className={css.table}><thead><tr><th>Location</th><th>Scenes</th></tr></thead>
              <tbody>{st.byLocation.map((l) => <tr key={l.location}><td>{l.location}</td><td>{l.scenes}</td></tr>)}</tbody></table>
          </div>
        </div>
      </Dialog>
    );
  }

  if (kind === 'locations') {
    const scenes = splitScenes(lines);
    const byLoc = new Map<string, typeof scenes>();
    for (const s of scenes) byLoc.set(s.location || '(no location)', [...(byLoc.get(s.location || '(no location)') ?? []), s]);
    const groups = [...byLoc.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const rows = groups.flatMap(([loc, ss]) => [loc, ...ss.map((s) => `   p.${String(page(s.id)).padEnd(4)} ${pad(s.intExt || '-', 9)} ${pad(s.time || '-', 14)} ${s.heading}`), '']);
    return (
      <Dialog title="Locations & Scenes" size="wide" footer={<button className="ud-btn" onClick={() => exportReport('Locations and Scenes', rows)} data-testid="report-export">Export PDF</button>}>
        {groups.length === 0 && <div className={css.hint}>No scenes yet.</div>}
        <table className={css.table} data-testid="locations">
          <thead><tr><th>Location</th><th>Scene</th><th>Page</th><th>INT/EXT</th><th>Time</th></tr></thead>
          <tbody>
            {groups.flatMap(([loc, ss]) => ss.map((s, i) => (
              <tr key={s.id} className={css.click} onClick={() => jump(s.id)}>
                <td>{i === 0 ? <b>{loc}</b> : ''}</td><td>{scenes.indexOf(s) + 1}</td><td>{page(s.id)}</td><td>{s.intExt}</td><td>{s.time}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </Dialog>
    );
  }

  if (kind === 'shots') {
    const scenes = splitScenes(lines);
    const shots = lines.filter((l) => l.type === 'shot').map((l) => {
      const idx = lines.indexOf(l);
      const sc = scenes.find((s) => idx >= s.start && idx < s.end);
      return { l, scene: sc ? `${scenes.indexOf(sc) + 1}. ${sc.heading}` : '', page: page(l.id) };
    });
    const rows = shots.map((s) => `p.${String(s.page).padEnd(4)} ${pad(s.l.text.toUpperCase(), 34)} ${s.scene}`);
    return (
      <Dialog title="List of Shots" size="wide" footer={<button className="ud-btn" onClick={() => exportReport('List of Shots', rows)} data-testid="report-export">Export PDF</button>}>
        {shots.length === 0 && <div className={css.hint}>There are no Shot lines in this document.</div>}
        <table className={css.table} data-testid="shots">
          <thead><tr><th>Shot</th><th>Page</th><th>Scene</th></tr></thead>
          <tbody>{shots.map((s) => <tr key={s.l.id} className={css.click} onClick={() => jump(s.l.id)}><td>{s.l.text.toUpperCase()}</td><td>{s.page}</td><td>{s.scene}</td></tr>)}</tbody>
        </table>
      </Dialog>
    );
  }

  // Filters shown in page format: dialogue, non-dialogue, character scenes.
  const isChars = kind === 'characterScenes';
  const title = kind === 'dialogue' ? 'Dialogue Filter' : kind === 'nonDialogue' ? 'Non-Dialogue Filter' : 'Character Scenes Filter';
  const ids = () => (kind === 'dialogue' ? dialogueIds(lines, picked) : kind === 'nonDialogue' ? nonDialogueIds(lines) : characterSceneIds(lines, picked));
  const label = () => (kind === 'dialogue' ? `Dialogue only${picked.size ? ` (${[...picked].join(', ')})` : ''}` : kind === 'nonDialogue' ? 'Non-dialogue only' : `Scenes with ${[...picked].join(', ')}`);
  const needPick = isChars && picked.size === 0;
  const show = () => { useApp.setState({ filter: { label: label(), onlyIds: ids() }, viewMode: 'page' }); close(); };
  const pdf = async () => {
    const r = await makePdf({ onlyIds: new Set(ids()), includeTitlePage: false, heading: label() });
    if (r) downloadBytes(r.bytes, `${name} - ${title}.pdf`);
  };
  return (
    <Dialog title={title} footer={<>
      <button className="ud-btn secondary" onClick={pdf} disabled={needPick} data-testid="report-export">Export PDF</button>
      <button className="ud-btn" onClick={show} disabled={needPick} data-testid="report-show">Show in page view</button>
    </>}>
      {kind === 'nonDialogue'
        ? <p style={{ marginTop: 0 }}>Shows the script without character names, dialogue and parentheticals.</p>
        : (
          <>
            <p style={{ marginTop: 0 }}>{isChars ? 'Pick characters to see only the scenes they speak in.' : 'Shows only dialogue. Pick characters to limit it, or leave all unchecked for everyone.'}</p>
            <div className={css.inline} data-testid="report-characters">
              {chars.length === 0 && <span className={css.hint}>No characters yet.</span>}
              {chars.map((c) => <Check key={c.name} label={`${c.name} (${c.speeches})`} checked={picked.has(c.name)} onChange={() => toggle(c.name)} />)}
            </div>
          </>
        )}
    </Dialog>
  );
}
