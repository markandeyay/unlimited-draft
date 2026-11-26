// Light PDF helpers that do not pull in pdf-lib.
import type { Comment, DocumentFile, Settings } from '../storage/models';

export interface PdfOptions {
  includeTitlePage: boolean;
  sceneNumbers: boolean;
  revisionAsterisks: boolean;
  /** PDF with notes: prints Note elements and comments. */
  includeNotes: boolean;
  hideShots?: boolean;
  pageFrom?: number;
  pageTo?: number;
  comments?: Comment[];
  /** Print only these line ids (filter reports). */
  onlyIds?: Set<string>;
  heading?: string;
}


export function defaultPdfOptions(s: Settings, doc?: DocumentFile): PdfOptions {
  return {
    includeTitlePage: s.pdf.includeTitlePage,
    sceneNumbers: !!doc?.sceneNumbers.enabled,
    revisionAsterisks: s.pdf.revisionAsterisks,
    includeNotes: s.pdf.includeNotes,
  };
}


export function pdfFileName(title: string, s: Settings): string {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const safe = title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Untitled';
  return `${safe} - ${s.pdf.draftName.trim() || date}.pdf`;
}


export function downloadBytes(bytes: Uint8Array, name: string, type = 'application/pdf') {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  (window as any).__lastDownload = { name, size: bytes.length };
}
