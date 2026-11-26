"""Build the pagination golden fixture from a WriterDuet PDF export.

Usage: python scripts/make-golden.py <export.pdf> tests/layout/fixtures/wd-golden.json

Words are replaced by random letters of the same length (same word, same replacement), so the
fixture keeps every line length, sentence end and speaker identity without publishing the script.
Requires pymupdf.
"""
import json, random, re, sys
import pymupdf

src, dst = sys.argv[1], sys.argv[2]
doc = pymupdf.open(src)
rng = random.Random(7)
words = {}

def scramble_word(m):
    w = m.group(0)
    key = w.lower()
    if key not in words:
        words[key] = ''.join(rng.choice('abcdefghijklmnopqrstuvwxyz') for _ in key)
    out = words[key]
    return ''.join(c.upper() if o.isupper() else c for c, o in zip(out, w))

def scramble(t):
    return re.sub(r"[A-Za-z]+", scramble_word, t)

pages = []
for p in list(doc)[1:]:
    rows = []
    for b in p.get_text('dict')['blocks']:
        for l in b.get('lines', []):
            for s in l['spans']:
                if s['text'].strip():
                    rows.append({'row': round((s['origin'][1] - 80.25) / 12), 'x': round(s['origin'][0], 2),
                                 'text': s['text'], 'bold': 'Bold' in s['font']})
    rows.sort(key=lambda r: r['row'])
    pages.append(rows)

elements, expected = [], []
prev = None
for pi, rows in enumerate(pages):
    exp = []
    for r in rows:
        x, t, row = r['x'], r['text'], r['row']
        if row == -3:
            continue  # page number
        st = scramble(t.replace('(MORE)', '\x00').replace("(CONT'D)", '\x01')).replace('\x00', '(MORE)').replace('\x01', "(CONT'D)")
        exp.append([row, round(x / 7.2, 3), st.rstrip(' ')])
        if row < 0 or row >= 54:
            prev = None if row >= 54 else prev
            continue
        if x == 108.0:
            typ = 'scene' if r['bold'] else 'action'
        elif x == 252.0:
            typ = 'character'
        elif x == 180.0:
            typ = 'dialogue'
        elif x == 208.8:
            typ = 'parenthetical'
        else:
            typ = 'transition'
        cont = prev is not None and prev['text'].endswith(' ') and prev['x'] == x
        if cont:
            elements[-1]['text'] += st
        else:
            if typ == 'action' and prev is not None and prev['x'] == 108.0:
                same_page_adjacent = prev['page'] == pi and row - prev['row'] == 1
                wrapped_over_page = prev['page'] != pi and prev['row'] == 53 and row == 0 and not re.search(r'[.?!]$', prev['text'])
                if same_page_adjacent or wrapped_over_page:
                    typ = 'text'
            if typ == 'character':
                st = re.sub(r" \(CONT'D\)$", '', st)
            elements.append({'type': typ, 'text': st})
        prev = {'text': t, 'x': x, 'row': row, 'page': pi}
    expected.append(exp)

for i, e in enumerate(elements):
    e['id'] = f'L{i:04d}'
    e['text'] = e['text'].rstrip(' ')
json.dump({'source': 'WriterDuet Quick Export, text scrambled', 'elements': elements, 'pages': expected}, open(dst, 'w'), indent=0)
print(len(elements), 'elements', len(expected), 'pages')
