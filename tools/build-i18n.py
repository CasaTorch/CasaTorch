#!/usr/bin/env python3
"""Builds app/public/i18n/<lang>.json from tools/i18n-strings.tsv (English key, then one column per language).
A key may carry a context after "|" (e.g. "Open|state"); English shows the part before it."""
import csv, json, os, sys
here = os.path.dirname(os.path.abspath(__file__)); src = os.path.join(here, 'i18n-strings.tsv'); out = os.path.join(here, '..', 'app', 'public', 'i18n')
rows = list(csv.reader(open(src, encoding='utf-8'), delimiter='\t', quoting=csv.QUOTE_NONE))
head, body = rows[0], rows[1:]
os.makedirs(out, exist_ok=True)
seen = set()
for r in body:
    if len(r) != len(head): sys.exit(f'row has {len(r)} columns, expected {len(head)}: {r[0][:60]}')
    if r[0] in seen: sys.exit(f'duplicate key: {r[0]}')
    seen.add(r[0])
for i, lang in enumerate(head[1:], 1):
    d = {r[0]: r[i] for r in body if r[i] and r[i] != r[0].split('|')[0]}
    json.dump(d, open(os.path.join(out, f'{lang}.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0, sort_keys=True)
    print(lang, len(d))
