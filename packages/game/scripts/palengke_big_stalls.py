#!/usr/bin/env python3
"""Bigger stalls in the Lumang Palengke (maps/palengke.json): every square of four 2 x 2 stalls (a 4 x 4 block of stall
tiles) becomes one stall drawn at 2x on a 4 x 4 footprint (`scale: 2`; the art's top-corner anchor scales with it, so it
covers the same tiles). The blocked tiles don't change. Stalls in rows only 2 tiles deep stay as they are.

Which of the four looks it takes: the most common among them (ties: the first, top-left). Its flip: the first's.
Idempotent (stalls already at 2x are left alone). Run from packages/game:

    python3 scripts/palengke_big_stalls.py

Copying the art folder's maps/palengke/palengke.json over again loses it: run this again after.
"""
import json
from collections import Counter
from pathlib import Path

MAP = Path(__file__).resolve().parent.parent / 'public' / 'assets' / 'maps' / 'palengke.json'


def main() -> None:
    m = json.loads(MAP.read_text())
    objs = m['objects']
    small = [o for o in objs if o.get('id', '').startswith('palengke-stall-') and o.get('footprint') == [2, 2] and not o.get('scale')]
    at = {(o['col'], o['row']): o for o in small}
    used: set[int] = set()
    merged: dict[int, dict] = {}  # id(first) -> the big stall
    for o in sorted(small, key=lambda x: (x['row'], x['col'])):
        if id(o) in used:
            continue
        four = [at.get((o['col'] + dc, o['row'] + dr)) for dc, dr in ((0, 0), (2, 0), (0, 2), (2, 2))]
        if not all(x is not None and id(x) not in used for x in four):
            continue
        for x in four:
            used.add(id(x))
        looks = Counter(x['id'] for x in four)
        best = max(looks.values())
        look = next(x['id'] for x in four if looks[x['id']] == best)
        big = {**o, 'id': look, 'footprint': [4, 4], 'scale': 2}
        merged[id(o)] = big
    out = []
    for o in objs:
        if id(o) in merged:
            out.append(merged[id(o)])
        elif id(o) not in used:
            out.append(o)
    m['objects'] = out
    MAP.write_text(json.dumps(m))
    print(f'{len(merged)} big stalls from {len(merged) * 4}; {len(small) - len(merged) * 4} small left; objects {len(objs)} -> {len(out)}')


if __name__ == '__main__':
    main()
