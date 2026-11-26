import { useState } from 'react';
import { openProject } from '../../app/project';
import { useApp } from '../../app/store';
import { ELEMENT_LABELS, TOOLBAR_ORDER } from '../../editor/flow';
import type { PlainLine } from '../../import/fountain';
import { type Imported, importBytes } from '../../import/writerduet';
import type { ElementType } from '../../layout/geometry';
import { useSettings } from '../../settings/settings';
import * as store from '../../storage/db';
import { Dialog, Field } from '../Dialogs';
import css from '../dialogs.module.css';

async function readPdf(bytes: Uint8Array): Promise<Imported> {
  const [pdfjs, worker, imp] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    import('../../pdf/import'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pages = await imp.extractPdfPages(bytes, pdfjs as any);
  return { ...imp.classifyPdf(pages), format: 'PDF' };
}

export default function ImportDialog() {
  const close = useApp((s) => s.closeDialog);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [format, setFormat] = useState('');
  const [lines, setLines] = useState<PlainLine[] | null>(null);

  const load = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const isPdf = /\.pdf$/i.test(file.name) || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);
      const r = isPdf ? await readPdf(bytes) : importBytes(bytes, file.name);
      if (!r.lines.length) { setError('No script lines were found in that file.'); setLines(null); return; }
      setLines(r.lines);
      setFormat(r.format);
      setName((r.title && r.title.length < 80 ? r.title : '') || file.name.replace(/\.[^.]+$/, ''));
    } catch (e) {
      setError(`Could not read that file: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  const create = async () => {
    if (!lines) return;
    setBusy(true);
    const p = await store.createProject(name.trim() || 'Imported Script', {
      lines: lines.map((l) => store.makeLine(l.type, l.text, l.dual ? { dual: l.dual } : {})),
      pdf: useSettings.getState().settings.pdf,
    });
    close();
    await openProject(p.id);
  };
  const setType = (i: number, t: ElementType) => setLines((ls) => ls!.map((l, k) => (k === i ? { ...l, type: t } : l)));

  return (
    <Dialog title="Import" size={lines ? 'wide' : undefined} footer={lines ? <>
      <button className="ud-btn secondary" onClick={() => setLines(null)}>Choose another file</button>
      <button className="ud-btn" onClick={create} disabled={busy} data-testid="import-create">Import as new project</button>
    </> : undefined}>
      {!lines && (
        <>
          <label className={css.drop} style={{ display: 'block', cursor: 'pointer' }}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void load(e.dataTransfer.files[0]); }}>
            {busy ? 'Reading file...' : 'Choose a file or drop it here.'}
            <br />
            WriterDuet (.wdz), Final Draft (.fdx), Fountain (.fountain, .txt) or a PDF script.
            <input type="file" accept=".wdz,.fdx,.fountain,.txt,.json,.pdf,.spmd,application/pdf" style={{ display: 'none' }} data-testid="import-file" onChange={(e) => void load(e.target.files?.[0])} />
          </label>
          {error && <p style={{ color: '#ff8a80' }} data-testid="import-error">{error}</p>}
          <p className={css.hint}>Every import creates a new project. You can check each line's type before importing.</p>
        </>
      )}
      {lines && (
        <>
          <Field label="Project name"><input className="ud-input" value={name} onChange={(e) => setName(e.target.value)} data-testid="import-name" /></Field>
          <p className={css.hint} style={{ marginTop: 0 }}>Read as {format}: {lines.length} lines. Fix any wrong guesses with the menus on the right.</p>
          <div className={css.preview} data-testid="import-preview">
            {lines.slice(0, 1500).map((l, i) => (
              <div key={i} className={`${css.pv} ${css[`pv-${l.type}`] ?? ''}`}>
                <span>{l.text || ' '}</span>
                <select value={l.type} onChange={(e) => setType(i, e.target.value as ElementType)} title="Line type">
                  {TOOLBAR_ORDER.map((t) => <option key={t} value={t}>{ELEMENT_LABELS[t]}</option>)}
                </select>
              </div>
            ))}
            {lines.length > 1500 && <div className={css.hint}>Showing the first 1500 lines. All {lines.length} will be imported.</div>}
          </div>
        </>
      )}
    </Dialog>
  );
}
