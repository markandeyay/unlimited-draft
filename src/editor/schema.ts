import { type MarkSpec, type Node as PMNode, type NodeSpec, Schema } from 'prosemirror-model';
import { ELEMENT_TYPES, type ElementType } from '../layout/geometry';
import type { InlineMark, Line, MarkKind } from '../storage/models';

const attrs = {
  id: { default: '' },
  dual: { default: null },
  sceneNumber: { default: null },
  omitted: { default: false },
  revisionColor: { default: null },
  revisionMarked: { default: false },
  align: { default: null },
  pageBreakBefore: { default: false },
  bullet: { default: false },
  imageRef: { default: null },
  createdAt: { default: '' },
  updatedAt: { default: '' },
  device: { default: null },
  history: { default: null },
};

/** ProseMirror reserves the node name "text", so the Text element is stored as "general". */
export const nodeName = (t: ElementType): string => (t === 'text' ? 'general' : t);

function elementSpec(type: ElementType): NodeSpec {
  return {
    content: 'text*',
    group: 'element',
    attrs,
    defining: true,
    parseDOM: [{
      tag: `div.el-${type}`,
      getAttrs: (dom) => {
        const d = dom as HTMLElement;
        return { id: d.getAttribute('data-id') ?? '', dual: d.getAttribute('data-dual'), align: d.getAttribute('data-align') };
      },
    }],
    toDOM(node) {
      const a: Record<string, string> = { class: `el el-${type}`, 'data-id': node.attrs.id, 'data-type': type };
      if (node.attrs.dual) a['data-dual'] = node.attrs.dual;
      if (node.attrs.align) a['data-align'] = node.attrs.align;
      if (node.attrs.bullet) a['data-bullet'] = '1';
      if (node.attrs.omitted) a['data-omitted'] = '1';
      if (node.attrs.revisionColor) a['data-rev'] = node.attrs.revisionColor;
      if (type === 'image' && node.attrs.imageRef) a['data-image'] = node.attrs.imageRef;
      return ['div', a, 0];
    },
  };
}

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'element+' },
  text: { group: 'inline' },
};
// Action first so it is the default block type.
nodes.action = elementSpec('action');
for (const t of ELEMENT_TYPES) if (t !== 'action') nodes[nodeName(t)] = elementSpec(t);
// Plain pasted paragraphs become action lines.
(nodes.action.parseDOM as any[]).push({ tag: 'p' }, { tag: 'div' }, { tag: 'li' }, { tag: 'h1' }, { tag: 'h2' }, { tag: 'h3' });

const simpleMark = (tag: string, cls: string, extra: string[] = []): MarkSpec => ({
  parseDOM: [{ tag }, ...extra.map((t) => ({ tag: t }))],
  toDOM: () => [tag, { class: cls }, 0],
});

const marks: Record<string, MarkSpec> = {
  bold: simpleMark('b', 'm-b', ['strong']),
  italic: simpleMark('i', 'm-i', ['em']),
  underline: simpleMark('u', 'm-u'),
  strike: simpleMark('s', 'm-s', ['strike', 'del']),
  color: {
    attrs: { value: { default: '#000000' } },
    parseDOM: [{ tag: 'span[data-color]', getAttrs: (d) => ({ value: (d as HTMLElement).getAttribute('data-color') }) }],
    toDOM: (m) => ['span', { 'data-color': m.attrs.value, style: `color:${m.attrs.value}` }, 0],
  },
  highlight: {
    attrs: { value: { default: '#fff59d' } },
    parseDOM: [{ tag: 'mark', getAttrs: (d) => ({ value: (d as HTMLElement).getAttribute('data-hl') ?? '#fff59d' }) }],
    toDOM: (m) => ['mark', { 'data-hl': m.attrs.value, style: `background:${m.attrs.value}` }, 0],
  },
};

export const schema = new Schema({ nodes, marks });

export const nodeType = (t: ElementType) => schema.nodes[nodeName(t)] ?? schema.nodes.action;
/** Element type of a top-level node. */
export const elType = (node: PMNode): ElementType => (node.type.name === 'general' ? 'text' : (node.type.name as ElementType));

export function lineToNode(line: Line): PMNode {
  const type = nodeType(line.type);
  const a = {
    id: line.id, dual: line.dual ?? null, sceneNumber: line.sceneNumber ?? null, omitted: !!line.omitted,
    revisionColor: line.revisionColor ?? null, revisionMarked: !!line.revisionMarked, align: line.align ?? null,
    pageBreakBefore: !!line.pageBreakBefore, bullet: !!line.bullet, imageRef: line.imageRef ?? null,
    createdAt: line.createdAt, updatedAt: line.updatedAt, device: line.device ?? null, history: line.history ?? null,
  };
  const text = line.text.replace(/\n/g, ' ');
  if (!text) return type.create(a);
  if (!line.marks?.length) return type.create(a, schema.text(text));
  // Split the text at every mark boundary.
  const cuts = new Set<number>([0, text.length]);
  for (const m of line.marks) { cuts.add(Math.max(0, Math.min(text.length, m.from))); cuts.add(Math.max(0, Math.min(text.length, m.to))); }
  const pts = [...cuts].sort((x, y) => x - y);
  const kids: PMNode[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const from = pts[i], to = pts[i + 1];
    if (from === to) continue;
    const ms = line.marks.filter((m) => m.from <= from && m.to >= to && schema.marks[m.kind])
      .map((m) => schema.marks[m.kind].create(m.value ? { value: m.value } : undefined));
    kids.push(schema.text(text.slice(from, to), ms));
  }
  return type.create(a, kids);
}

export function linesToDoc(lines: Line[]): PMNode {
  const src = lines.length ? lines : [{ id: '', type: 'action' as const, text: '', createdAt: '', updatedAt: '' }];
  return schema.nodes.doc.create(null, src.map(lineToNode));
}

export function nodeToLine(node: PMNode): Line {
  const a = node.attrs;
  const line: Line = { id: a.id, type: elType(node), text: node.textContent, createdAt: a.createdAt, updatedAt: a.updatedAt };
  if (a.dual) line.dual = a.dual;
  if (a.sceneNumber) line.sceneNumber = a.sceneNumber;
  if (a.omitted) line.omitted = true;
  if (a.revisionColor) line.revisionColor = a.revisionColor;
  if (a.revisionMarked) line.revisionMarked = true;
  if (a.align) line.align = a.align;
  if (a.pageBreakBefore) line.pageBreakBefore = true;
  if (a.bullet) line.bullet = true;
  if (a.imageRef) line.imageRef = a.imageRef;
  if (a.device) line.device = a.device;
  if (a.history) line.history = a.history;
  const marks: InlineMark[] = [];
  let off = 0;
  node.forEach((child) => {
    const len = child.text?.length ?? 0;
    for (const m of child.marks) {
      const kind = m.type.name as MarkKind;
      const value = m.attrs.value as string | undefined;
      const last = marks.findLast((x) => x.kind === kind && x.value === value);
      if (last && last.to === off) last.to = off + len;
      else marks.push(value ? { from: off, to: off + len, kind, value } : { from: off, to: off + len, kind });
    }
    off += len;
  });
  if (marks.length) line.marks = marks;
  return line;
}

/** Convert the doc to lines, stamping updatedAt on lines that changed since `prev`. */
export function docToLines(doc: PMNode, prev?: Map<string, Line>, device?: string): Line[] {
  const at = new Date().toISOString();
  const out: Line[] = [];
  doc.forEach((node) => {
    const line = nodeToLine(node);
    const old = prev?.get(line.id);
    if (!line.createdAt) line.createdAt = at;
    if (!old) {
      if (prev) { line.updatedAt = at; if (device) line.device = device; }
      else if (!line.updatedAt) line.updatedAt = at;
    } else if (old.text !== line.text || old.type !== line.type) {
      line.updatedAt = at;
      if (device) line.device = device;
    } else {
      line.updatedAt = old.updatedAt;
      if (old.device) line.device = old.device;
    }
    out.push(line);
  });
  return out;
}
