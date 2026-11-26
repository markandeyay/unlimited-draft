import { strToU8, zipSync } from 'fflate';
import { useEffect, useState } from 'react';
import { useApp } from '../../app/store';
import { DEFAULT_FLOW, ELEMENT_LABELS, TOOLBAR_ORDER } from '../../editor/flow';
import { toFountain } from '../../import/fountain';
import type { ElementType } from '../../layout/geometry';
import { downloadBytes } from '../../pdf/util';
import { defaultElements, defaultSettings, useSettings } from '../../settings/settings';
import * as store from '../../storage/db';
import { confirmDialog } from '../actions';
import { Check, Dialog, Field } from '../Dialogs';
import css from '../dialogs.module.css';

const TABS = ['Editing', 'Display', 'Format', 'PDF', 'Page', 'Misc'] as const;
type Tab = (typeof TABS)[number];
const FLOW_TYPES: ElementType[] = ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot', 'text', 'note', 'lyrics'];

function TypeSelect({ value, onChange }: { value: ElementType; onChange: (t: ElementType) => void }) {
  return (
    <select className="ud-input" value={value} onChange={(e) => onChange(e.target.value as ElementType)}>
      {TOOLBAR_ORDER.filter((t) => t !== 'image').map((t) => <option key={t} value={t}>{ELEMENT_LABELS[t]}</option>)}
    </select>
  );
}

export default function Customize({ tab: initial }: { tab?: string }) {
  const [tab, setTab] = useState<Tab>((TABS as readonly string[]).includes(initial ?? '') ? (initial as Tab) : 'Editing');
  const s = useSettings((x) => x.settings);
  const set = useSettings((x) => x.set);
  const [fmt, setFmt] = useState<ElementType>('action');
  const [repo, setRepo] = useState('');
  useEffect(() => { void store.db.settings.get('repo').then((r) => setRepo(r?.value ?? '')); }, []);
  const el = s.format.elements[fmt];
  const num = (v: string, fallback: number) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fallback; };

  const exportAll = async () => {
    const files: Record<string, Uint8Array> = {};
    const projects = await store.listProjects();
    for (const p of projects) {
      files[`${p.path}/project.json`] = strToU8(JSON.stringify(p, null, 1));
      for (const d of await store.getDocuments(p.id)) {
        files[`${p.path}/${d.name.replace(/[\\/:*?"<>|]/g, ' ')}-${d.id.slice(-5)}.json`] = strToU8(JSON.stringify(d, null, 1));
        files[`${p.path}/${d.name.replace(/[\\/:*?"<>|]/g, ' ')}-${d.id.slice(-5)}.fountain`] = strToU8(toFountain(d.lines, p.name));
      }
    }
    downloadBytes(zipSync(files), 'unlimited-draft-export.zip', 'application/zip');
  };

  return (
    <Dialog
      tabs={TABS.map((t) => <button key={t} className={`${css.tab} ${tab === t ? css.tabActive : ''}`} onClick={() => setTab(t)} data-testid={`tab-${t}`}>{t}</button>)}
    >
      {tab === 'Editing' && (
        <>
          <div className={css.section}>Editor</div>
          <Field label="Preferences:">
            <Check label="Display suggestions (autocomplete)" checked={s.editing.autocomplete} onChange={(v) => set((x) => { x.editing.autocomplete = v; })} testId="set-autocomplete" />
            <Check label="Auto-capitalization" checked={s.editing.autoCapitalize} onChange={(v) => set((x) => { x.editing.autoCapitalize = v; })} />
            <Check label="Smart quotes" checked={s.editing.smartQuotes} onChange={(v) => set((x) => { x.editing.smartQuotes = v; })} />
            <Check label="Automatic (CONT'D)" checked={s.editing.autoContd} onChange={(v) => set((x) => { x.editing.autoContd = v; })} testId="set-autocontd" />
            <Check label="Check spelling while typing" checked={s.editing.spellCheck} onChange={(v) => set((x) => { x.editing.spellCheck = v; })} />
          </Field>
          <div className={css.section}>Enter and Tab</div>
          <table className={css.table}>
            <thead><tr><th>Current line</th><th>Enter</th><th>Enter on empty line</th><th>Tab</th></tr></thead>
            <tbody>
              {FLOW_TYPES.map((t) => {
                const row = s.editing.flow[t] ?? DEFAULT_FLOW[t];
                return (
                  <tr key={t}>
                    <td>{ELEMENT_LABELS[t]}</td>
                    <td><TypeSelect value={row.enter} onChange={(v) => set((x) => { x.editing.flow[t] = { ...row, enter: v }; })} /></td>
                    <td><TypeSelect value={row.enterEmpty} onChange={(v) => set((x) => { x.editing.flow[t] = { ...row, enterEmpty: v }; })} /></td>
                    <td><TypeSelect value={row.tab} onChange={(v) => set((x) => { x.editing.flow[t] = { ...row, tab: v }; })} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ marginTop: 10 }}><button className="ud-btn secondary" onClick={() => set((x) => { x.editing.flow = JSON.parse(JSON.stringify(DEFAULT_FLOW)); })}>Reset Enter and Tab</button></div>
        </>
      )}
      {tab === 'Display' && (
        <>
          <div className={css.section}>Editor</div>
          <Field label="Preferences:">
            <Check label="Dark editor" checked={s.display.darkMode} onChange={(v) => set((x) => { x.display.darkMode = v; })} testId="set-dark" />
            <Check label="Page shadow" checked={s.display.pageShadow} onChange={(v) => set((x) => { x.display.pageShadow = v; })} />
            <Check label="Show page breaks" checked={s.display.showPageBreaks} onChange={(v) => set((x) => { x.display.showPageBreaks = v; })} />
            <Check label="Show page count" checked={s.display.showPageCount} onChange={(v) => set((x) => { x.display.showPageCount = v; })} />
          </Field>
          <Field label="Highlight:"><Check label="Highlight your line" checked={s.display.highlightCurrentLine} onChange={(v) => set((x) => { x.display.highlightCurrentLine = v; })} testId="set-highlight" /></Field>
          <Field label="Text size:">
            <select className="ud-input" value={s.display.textSize} onChange={(e) => set((x) => { x.display.textSize = parseFloat(e.target.value); })} style={{ width: 140 }}>
              <option value={0.85}>Small</option><option value={1}>Normal</option><option value={1.15}>Large</option><option value={1.3}>Larger</option>
            </select>
          </Field>
          <Field label="Page zoom:">
            <select className="ud-input" value={s.display.zoom} onChange={(e) => set((x) => { x.display.zoom = parseFloat(e.target.value); })} style={{ width: 140 }}>
              {[0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2].map((z) => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
            </select>
          </Field>
        </>
      )}
      {tab === 'Format' && (
        <>
          <Field label="Document Font:"><span>Courier Prime 12 pt (10 characters per inch)</span></Field>
          <div className={css.section}>Line Types</div>
          <Field label="Line type:">
            <select className="ud-input" value={fmt} onChange={(e) => setFmt(e.target.value as ElementType)} style={{ width: 160 }} data-testid="fmt-type">
              {TOOLBAR_ORDER.map((t) => <option key={t} value={t}>{ELEMENT_LABELS[t]}</option>)}
            </select>
          </Field>
          <Field label="Style:">
            <div className={css.inline}>
              <Check label="Bold" checked={el.bold} onChange={(v) => set((x) => { x.format.elements[fmt].bold = v; })} testId="fmt-bold" />
              <Check label="Italic" checked={el.italic} onChange={(v) => set((x) => { x.format.elements[fmt].italic = v; })} />
              <Check label="Underline" checked={el.underline} onChange={(v) => set((x) => { x.format.elements[fmt].underline = v; })} />
              <Check label="Uppercase" checked={el.uppercase} onChange={(v) => set((x) => { x.format.elements[fmt].uppercase = v; })} />
            </div>
          </Field>
          <Field label="Alignment:">
            <select className="ud-input" value={el.align} onChange={(e) => set((x) => { x.format.elements[fmt].align = e.target.value as any; })} style={{ width: 120 }}>
              <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
            </select>
          </Field>
          <Field label="Lines before:">
            <select className="ud-input" value={el.spaceBefore} onChange={(e) => set((x) => { x.format.elements[fmt].spaceBefore = parseInt(e.target.value, 10); })} style={{ width: 80 }} data-testid="fmt-space">
              {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}.0</option>)}
            </select>
          </Field>
          <Field label="Indent:">
            <div className={css.inline}>
              <span>Left (in.)</span>
              <input className="ud-input" style={{ width: 70 }} defaultValue={(el.left / 10).toFixed(2)} key={`l-${fmt}-${el.left}`} onBlur={(e) => set((x) => { x.format.elements[fmt].left = Math.round(num(e.target.value, el.left / 10) * 10); })} />
              <span>Width (characters)</span>
              <input className="ud-input" style={{ width: 70 }} defaultValue={el.width} key={`w-${fmt}-${el.width}`} onBlur={(e) => set((x) => { x.format.elements[fmt].width = Math.max(5, Math.round(num(e.target.value, el.width))); })} />
            </div>
            <span className={css.hint}>Left is measured from the left edge of the paper. 10 characters are one inch.</span>
          </Field>
          <button className="ud-btn secondary" data-testid="fmt-reset" onClick={() => set((x) => { x.format.elements = defaultElements(); })}>Reset to WriterDuet defaults</button>
        </>
      )}
      {tab === 'PDF' && (
        <>
          <div className={css.section}>PDF preferences</div>
          <Field label="Title page:"><Check label="Include title page" checked={s.pdf.includeTitlePage} onChange={(v) => set((x) => { x.pdf.includeTitlePage = v; })} /></Field>
          <Field label="Author name:"><input className="ud-input" value={s.pdf.authorName} onChange={(e) => set((x) => { x.pdf.authorName = e.target.value; })} data-testid="pdf-author" /></Field>
          <Field label="Contact block:">
            <input className="ud-input" placeholder="Address" value={s.pdf.address} onChange={(e) => set((x) => { x.pdf.address = e.target.value; })} />
            <input className="ud-input" placeholder="Phone" value={s.pdf.phone} onChange={(e) => set((x) => { x.pdf.phone = e.target.value; })} />
            <input className="ud-input" placeholder="Email" value={s.pdf.email} onChange={(e) => set((x) => { x.pdf.email = e.target.value; })} />
            <span className={css.hint}>Used on the title page of new projects and in the file name.</span>
          </Field>
          <Field label="Draft:">
            <input className="ud-input" placeholder="Draft name" value={s.pdf.draftName} onChange={(e) => set((x) => { x.pdf.draftName = e.target.value; })} />
            <input className="ud-input" placeholder="Draft date" value={s.pdf.draftDate} onChange={(e) => set((x) => { x.pdf.draftDate = e.target.value; })} />
          </Field>
          <Field label="Scene numbers:">
            <select className="ud-input" value={s.pdf.sceneNumbers} onChange={(e) => set((x) => { x.pdf.sceneNumbers = e.target.value as any; })} style={{ width: 160 }}>
              <option value="both">Left and right</option><option value="left">Left</option><option value="right">Right</option>
            </select>
          </Field>
          <Field label="Revisions:"><Check label="Print revision asterisks" checked={s.pdf.revisionAsterisks} onChange={(v) => set((x) => { x.pdf.revisionAsterisks = v; })} /></Field>
          <Field label="Notes:"><Check label="Include notes and comments" checked={s.pdf.includeNotes} onChange={(v) => set((x) => { x.pdf.includeNotes = v; })} /></Field>
        </>
      )}
      {tab === 'Page' && (
        <>
          <div className={css.section}>Page</div>
          <Field label="Paper:">
            <label className={css.check}><input type="radio" checked={s.page.paper === 'letter'} onChange={() => set((x) => { x.page.paper = 'letter'; })} /> US Letter</label>
            <label className={css.check}><input type="radio" checked={s.page.paper === 'a4'} onChange={() => set((x) => { x.page.paper = 'a4'; })} data-testid="paper-a4" /> A4</label>
          </Field>
          <Field label="Page margins:">
            <div className={css.inline}>
              {([['Left', 'marginLeftIn'], ['Right', 'marginRightIn'], ['Top', 'marginTopIn'], ['Bottom', 'marginBottomIn']] as const).map(([l, k]) => (
                <label key={k} className={css.inline}>{l} (in.)
                  <input className="ud-input" style={{ width: 62 }} defaultValue={s.page[k].toFixed(2)} key={`${k}-${s.page[k]}`} onBlur={(e) => set((x) => { x.page[k] = Math.max(0.25, Math.min(3, num(e.target.value, s.page[k]))); })} />
                </label>
              ))}
            </div>
            <button className="ud-btn secondary" style={{ alignSelf: 'flex-start' }} onClick={() => set((x) => { x.page.marginLeftIn = 1.5; x.page.marginRightIn = 1; x.page.marginTopIn = 1; x.page.marginBottomIn = 1; })}>Reset</button>
          </Field>
          <div className={css.section}>Numbering</div>
          <Field label="Page numbers:">
            <select className="ud-input" value={s.page.pageNumberPosition} onChange={(e) => set((x) => { x.page.pageNumberPosition = e.target.value as any; })} style={{ width: 170 }}>
              <option value="top-right">Top right</option><option value="top-left">Top left</option><option value="bottom-right">Bottom right</option><option value="bottom-center">Bottom center</option><option value="none">Hidden</option>
            </select>
            <Check label="Show page 1 number" checked={s.page.firstPageNumbered} onChange={(v) => set((x) => { x.page.firstPageNumbered = v; })} />
          </Field>
        </>
      )}
      {tab === 'Misc' && (
        <>
          <div className={css.section}>Settings</div>
          <Field label="Commit interval:">
            <div className={css.inline}>
              <input className="ud-input" style={{ width: 70 }} defaultValue={s.misc.commitIntervalSec} onBlur={(e) => set((x) => { x.misc.commitIntervalSec = Math.max(10, Math.min(600, Math.round(num(e.target.value, 30)))); })} />
              <span>seconds between commits while writing</span>
            </div>
          </Field>
          <Field label="Scripts repo:"><span>{repo || 'Sign in to connect'}</span></Field>
          <Field label="Local cache:">
            <button className="ud-btn secondary" style={{ alignSelf: 'flex-start' }} onClick={async () => { await store.clearLocalCache(); useApp.getState().toast('Search and history caches cleared.'); }}>Clear local cache</button>
            <span className={css.hint}>Clears the search index and history cache. Your scripts are not touched.</span>
          </Field>
          <Field label="Export:">
            <button className="ud-btn secondary" style={{ alignSelf: 'flex-start' }} onClick={exportAll} data-testid="export-zip">Export everything as a zip</button>
          </Field>
          <Field label="Reset:">
            <button className="ud-btn secondary" style={{ alignSelf: 'flex-start' }} onClick={async () => { if (await confirmDialog('Reset Settings', 'Reset every setting to its default?', 'Reset', true)) set((x) => { Object.assign(x, defaultSettings()); }); }}>Reset all settings</button>
          </Field>
        </>
      )}
    </Dialog>
  );
}
