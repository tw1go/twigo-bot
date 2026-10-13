#!/usr/bin/env python3
"""Adds high terrain to a map json (plain Python 3, no packages; seeded, so the same input gives the same map).

  apply_high_terrain.py slums   <slums.json> <out.json> [--protect protect-slums.json] [--seed N]
  apply_high_terrain.py warrens <built warrens.json> <warrens-layout.json> <out.json> [--protect protect-warrens.json] [--seed N]

The Slums (CONTEXT.md "Ground"): rock bluffs along the back edges (the NW and NE edges, rows and cols near 0: stepped
down from level 5, blocked: nobody climbs them), stepped mesas (some with a ramp up: lookouts), a raised crest along Wire
Ridge (with ramps), chasms (sinkholes one level down, canyons two levels down with land bridges across them: void
ground, blocked), rubble fields (cracked ground with rubble and boulders, blocked) and heaved road slabs beside the road.
It keeps clear (with 3 tiles round each): the gates and arrivals, the camp (safeZone), the canal, the bridges and the
road (concrete, plate and planks ground), the golem pit, the Warren Gate, the lantern post, every existing ramp, every
non-dressing object (3x3 and bigger, or animated), and whatever the --protect file names ({"tiles": [[col,row]...],
"rects": [[c0,r0,c1,r1]...]}). Dressing props (small ones) under new terrain go. Mob spawns and mini bosses that land
somewhere bad move to the nearest good tile of their zone. Every feature is checked as it goes in: from arrive.town, every
spawn, mini boss, pit floor tile, the Warren Gate's and the lantern post's arrivals must stay reachable (the game's step
rules: same level, or along a ramp; no cut corners); a feature that breaks that is dropped and said so.

The Scrap Warrens: the junk walls get taller and stepped (level 1 + how far from the floor, up to 4; material scrap, a
junk spire on some tops) and the floor collapses into pits (void, one level down) along walls and in the mini boss
arenas' corners, never touching the start room, exit warp, shutters, the Shanty Hall, boss tiles, guards, checkpoints or
pack spawns, every path kept at least 2 tiles wide (every floor tile stays in some 2x2 of floor) and every floor tile
reachable with the shutters open, and with them shut nobody leaves area 1.
"""

import json
import random
import sys
from collections import deque

LEVEL_MAX = 5
LEVEL_MIN = -2
MARGIN = 3
DIRS8 = [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)]
DIRS4 = [(1, 0), (-1, 0), (0, 1), (0, -1)]
# One step "up" a ramp (the game's RAMP_STEP).
RAMP_STEP = {'ne': (0, -1), 'nw': (-1, 0), 'se': (1, 0), 'sw': (0, 1)}


def log(msg):
    print(f'[terrain] {msg}')


class Map:
    """The map's grids, with the game's walking rules."""

    def __init__(self, data):
        self.d = data
        self.cols, self.rows = data['size']
        self.H = data.get('height') or [[0] * self.cols for _ in range(self.rows)]
        self.B = data['blocked']
        self.G = data['ground']
        self.W = data.get('walls') or [[''] * self.cols for _ in range(self.rows)]
        self.ramps = {(r['col'], r['row']): r for r in data.get('ramps', [])}
        data['height'] = self.H
        data['walls'] = self.W

    def inside(self, c, r):
        return 0 <= c < self.cols and 0 <= r < self.rows

    def level(self, c, r):
        c = min(self.cols - 1, max(0, c))
        r = min(self.rows - 1, max(0, r))
        return self.H[r][c]

    def walkable(self, c, r, extra_open=None):
        if not self.inside(c, r):
            return False
        if extra_open and (c, r) in extra_open:
            return True
        return not self.B[r][c] and self.H[r][c] >= 0

    def ramp_link(self, t, o, rp):
        if not rp:
            return False
        dc, dr = RAMP_STEP[rp['dir']]
        up = o == (t[0] + dc, t[1] + dr)
        down = o == (t[0] - dc, t[1] - dr)
        other = self.ramps.get(o)
        if rp['part'] == 1:
            if down:
                return not other and self.level(*o) == self.level(*t)
            if up:
                return other is not None and other['part'] == 2 and other['dir'] == rp['dir']
        else:
            if down:
                return other is not None and other['part'] == 1 and other['dir'] == rp['dir']
            if up:
                return not other and self.level(*o) == self.level(*t) + 1
        return False

    def can_step(self, a, b, extra_open=None):
        """The game's Heights.canStep and WalkGrid.canStep: b walkable, same level or a ramp's link; no cut corners."""
        if not self.walkable(*b, extra_open):
            return False
        if self.H[b[1]][b[0]] < 0:
            return False
        dc, dr = b[0] - a[0], b[1] - a[1]
        if dc and dr:
            via_c, via_r = (a[0] + dc, a[1]), (a[0], a[1] + dr)
            if not (self.walkable(*via_c, extra_open) and self.walkable(*via_r, extra_open)):
                return False
            return self.levels_ok(a, via_c) and self.levels_ok(via_c, b) and self.levels_ok(a, via_r) and self.levels_ok(via_r, b)
        return self.levels_ok(a, b)

    def levels_ok(self, a, b):
        ra, rb = self.ramps.get(a), self.ramps.get(b)
        if not ra and not rb:
            return self.level(*a) == self.level(*b)
        return self.ramp_link(a, b, ra) or self.ramp_link(b, a, rb)

    def flood(self, start, extra_open=None):
        seen = {tuple(start)}
        q = deque([tuple(start)])
        while q:
            c, r = q.popleft()
            for dc, dr in DIRS8:
                n = (c + dc, r + dr)
                if n in seen or not self.inside(*n):
                    continue
                if self.can_step((c, r), n, extra_open):
                    seen.add(n)
                    q.append(n)
        return seen

    def snapshot(self):
        return (json.dumps(self.H), json.dumps(self.B), json.dumps(self.G), json.dumps(self.W), json.dumps(self.d['ramps']), json.dumps(self.d['objects']))

    def restore(self, snap):
        self.H[:] = json.loads(snap[0])
        self.B[:] = json.loads(snap[1])
        self.G[:] = json.loads(snap[2])
        self.W[:] = json.loads(snap[3])
        self.d['ramps'][:] = json.loads(snap[4])
        self.d['objects'][:] = json.loads(snap[5])
        self.ramps = {(r['col'], r['row']): r for r in self.d['ramps']}


def rect_tiles(rect):
    c0, r0, c1, r1 = rect
    return [(c, r) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)]


def grow(tiles, m, cols, rows):
    out = set()
    for c, r in tiles:
        for dc in range(-m, m + 1):
            for dr in range(-m, m + 1):
                n = (c + dc, r + dr)
                if 0 <= n[0] < cols and 0 <= n[1] < rows:
                    out.add(n)
    return out


def footprint(o):
    fw, fh = o.get('footprint', [1, 1])
    return [(o['col'] + dc, o['row'] + dr) for dc in range(fw) for dr in range(fh)]


def load_protect(path, cols, rows):
    if not path:
        return set()
    with open(path) as f:
        p = json.load(f)
    tiles = {tuple(t) for t in p.get('tiles', [])}
    for rect in p.get('rects', []):
        tiles.update(rect_tiles(rect))
    return grow(tiles, MARGIN, cols, rows)


# ── The Slums ──

def slums(data, protect, rnd):
    M = Map(data)
    cols, rows = M.cols, M.rows
    added = []
    skipped = []

    # What must stay as it is (with MARGIN round each).
    hard = set()
    for g in data.get('gates', {}).values():
        hard.update(tuple(t) for t in g)
    hard.update(tuple(t) for t in data.get('arrive', {}).values())
    hard.add(tuple(data['spawn']))
    hard.update(rect_tiles(data['safeZone']))
    for r in range(rows):
        for c in range(cols):
            if M.G[r][c] in ('canal', 'concrete', 'plate', 'planks'):
                hard.add((c, r))
    boss = data['boss']
    hard.update(rect_tiles(boss['arena']))
    bt = boss['tile']
    for part in boss.get('pit', {}).values():
        hard.update((bt[0] + dc, bt[1] + dr) for dc, dr in part)
    pit_floor = {(bt[0] + dc, bt[1] + dr) for dc, dr in boss.get('pit', {}).get('floor', [])}
    for rp in data['ramps']:
        hard.add((rp['col'], rp['row']))
        dc, dr = RAMP_STEP[rp['dir']]
        hard.add((rp['col'] - dc, rp['row'] - dr))
        hard.add((rp['col'] + dc, rp['row'] + dr))
    keep_ids = {'lantern-post', 'slums-warren-gate'}
    big = []
    small = []
    for o in data['objects']:
        fw, fh = o.get('footprint', [1, 1])
        if o['id'] in keep_ids or o.get('animated') or 'golem-pit' in o['id'] or fw >= 3 or fh >= 3:
            big.append(o)
            hard.update(footprint(o))
        else:
            small.append(o)
    clear = grow(hard, MARGIN, cols, rows) | protect
    zones = data['mobZones']

    def zone_of(c, r):
        for z in zones:
            c0, r0, c1, r1 = z['rect']
            if c0 <= c <= c1 and r0 <= r <= r1:
                return z
        return None

    def open_ground(c, r, lvl=None):
        return M.inside(c, r) and (c, r) not in clear and not M.B[r][c] and M.G[r][c] in ('dirt', 'dirt-junk', 'weeds', 'mud') and M.H[r][c] >= 0 and (lvl is None or M.H[r][c] == lvl)

    def drop_small_props(tiles):
        tiles = set(tiles)
        gone = [o for o in small if any(t in tiles for t in footprint(o))]
        for o in gone:
            data['objects'].remove(o)
            small.remove(o)
            for c, r in footprint(o):
                M.B[r][c] = 0
        return len(gone)

    targets = []

    def check():
        reach = M.flood(data['arrive']['town'])
        for t in targets:
            if tuple(t) not in reach:
                return tuple(t)
        return None

    def apply(name, fn):
        snap = M.snapshot()
        res = fn()
        if res is None:
            M.restore(snap)
            skipped.append(f'{name}: no room')
            return False
        lost = check()
        if lost:
            M.restore(snap)
            skipped.append(f'{name}: would cut off {lost}')
            return False
        added.append(f'{name}: {res}')
        return True

    # 1. Bluffs along the back edges: rows 0.. (the NE edge) and cols 0.. (the NW edge), stepped from level 5 down to the
    #    local ground, blocked (nobody climbs), material rock. The depth of the band wanders along the edge (seeded).
    def bluffs():
        n = 0
        depth_rows = [4 + int(2 * (0.5 + 0.5 * __import__('math').sin(c / 11.0 + rnd.random()))) for c in range(cols)]
        depth_cols = [4 + int(2 * (0.5 + 0.5 * __import__('math').sin(r / 9.0 + rnd.random()))) for r in range(rows)]
        for c in range(cols):
            for r in range(depth_rows[c]):
                n += bluff_tile(c, r, r)
        for r in range(rows):
            for c in range(depth_cols[r]):
                n += bluff_tile(c, r, c)
        return f'{n} tiles' if n else None

    def bluff_tile(c, r, dist):
        if (c, r) in clear or M.G[r][c] == 'canal' or M.H[r][c] < 0:
            return 0
        lvl = max(M.H[r][c] + 1, LEVEL_MAX - dist)
        if lvl <= M.H[r][c]:
            return 0
        M.H[r][c] = min(LEVEL_MAX, lvl)
        M.B[r][c] = 1
        M.W[r][c] = 'rock'
        drop_small_props([(c, r)])
        return 1

    # 2. Wire Ridge's crest: a band 3 wide along the ridge's back, one level up, with two ramps (a lookout).
    def crest():
        ridge = next((z for z in zones if z['id'] == 'wire-ridge'), None)
        if not ridge:
            return None
        c0, r0, c1, r1 = ridge['rect']
        base = ridge['height']
        taken = {(s[0], s[1]) for s in ridge.get('spawns', [])} | {tuple(m['tile']) for m in ridge.get('miniBosses', [])}
        # The longest run of open tiles on a band of 3 rows, tried down the ridge's back half.
        best = None
        for r in range(r0 + 4, r0 + (r1 - r0) // 2, 2):
            placed = []
            for c in range(c0 + 4, c1 - 4):
                col = [(c, rr) for rr in range(r, r + 3)]
                if all(open_ground(x, y, base) and (x, y) not in taken and not any((x + dc, y + dr) in taken for dc, dr in DIRS8) for x, y in col):
                    placed.extend(col)
            if not best or len(placed) > len(best[1]):
                best = (r, placed)
        if not best or len(best[1]) < 30:
            return None
        r, placed = best
        for c, rr in placed:
            M.H[rr][c] = base + 1
            M.W[rr][c] = 'rock'
        drop_small_props(placed)
        ramps = 0
        cols_on = sorted({c for c, _ in placed})
        for c in cols_on[::12]:
            if ramps < 3 and add_ramp(c, r + 4, 'ne', 'dirt', base, set(placed)):
                ramps += 1
        if not ramps:
            return None
        return f'{len(placed)} tiles on rows {r}-{r + 2}, {ramps} ramps'

    def add_ramp(c, r, direction, surface, low, top_tiles):
        """A ramp whose part 1 is at (c, r): part 2 one step up, the high tile after it must be in top_tiles."""
        dc, dr = RAMP_STEP[direction]
        p1, p2, high, before = (c, r), (c + dc, r + dr), (c + 2 * dc, r + 2 * dr), (c - dc, r - dr)
        for t in (p1, p2, before):
            if not M.inside(*t) or M.B[t[1]][t[0]] or M.H[t[1]][t[0]] != low or t in clear or t in M.ramps:
                return False
        if high not in top_tiles:
            return False
        for part, t in ((1, p1), (2, p2)):
            rp = {'col': t[0], 'row': t[1], 'dir': direction, 'part': part, 'surface': surface}
            data['ramps'].append(rp)
            M.ramps[t] = rp
        drop_small_props([p1, p2, before])
        return True

    # 3. Mesas: raised blocks on open ground (some stepped, +2 in the middle), about half with a ramp (lookouts).
    def mesa(i):
        for _ in range(60):
            w, h = rnd.randint(4, 7), rnd.randint(4, 6)
            c0, r0 = rnd.randint(8, cols - 8 - w), rnd.randint(8, rows - 8 - h)
            tiles = [(c, r) for r in range(r0, r0 + h) for c in range(c0, c0 + w)]
            lvl = M.H[r0][c0]
            if lvl < 0 or any(not open_ground(c, r, lvl) for c, r in tiles):
                continue
            z = zone_of(c0, r0)
            if z and any((s[0], s[1]) in set(tiles) for s in z.get('spawns', []) + [m['tile'] for m in z.get('miniBosses', [])]):
                continue
            for c, r in tiles:
                M.H[r][c] = lvl + 1
                M.W[r][c] = 'rock'
            stepped = w >= 6 and h >= 5
            if stepped:
                for c, r in tiles:
                    if c0 + 1 < c < c0 + w - 2 and r0 + 1 < r < r0 + h - 2:
                        M.H[r][c] = lvl + 2
                        M.B[r][c] = 1
            drop_small_props(tiles)
            lookout = i % 2 == 0
            if lookout:
                ok = False
                for c in range(c0, c0 + w):
                    if add_ramp(c, r0 + h + 1, 'ne', 'dirt', lvl, set(tiles)):
                        ok = True
                        break
                if not ok:
                    for r in range(r0, r0 + h):
                        if add_ramp(c0 + w + 1, r, 'nw', 'dirt', lvl, set(tiles)):
                            ok = True
                            break
                if not ok:
                    lookout = False
            if not lookout:
                for c, r in tiles:
                    M.B[r][c] = 1  # a mesa nobody reaches is solid
            return f'{w}x{h} at {c0},{r0}' + (' stepped' if stepped else '') + (' lookout' if lookout else '')
        return None

    # 4. Chasms: sinkholes (one level down) and canyons (two down, winding, with land bridges).
    def void(c, r, depth):
        M.H[r][c] = -depth
        M.B[r][c] = 1
        M.G[r][c] = 'void'
        M.W[r][c] = ''

    def sinkhole():
        for _ in range(60):
            c, r = rnd.randint(6, cols - 7), rnd.randint(6, rows - 7)
            rad = rnd.randint(1, 2)
            tiles = [(c + dc, r + dr) for dc in range(-rad, rad + 1) for dr in range(-rad, rad + 1) if abs(dc) + abs(dr) <= rad + 1]
            lvl = M.H[r][c]
            if lvl < 0 or any(not open_ground(x, y, lvl) for x, y in tiles):
                continue
            rim = grow(tiles, 1, cols, rows) - set(tiles)
            if any(M.H[y][x] != lvl or M.B[y][x] for x, y in rim):
                continue
            drop_small_props(tiles)
            for x, y in tiles:
                void(x, y, 1)
            return f'{len(tiles)} tiles at {c},{r}'
        return None

    def canyon():
        for _ in range(40):
            c, r = rnd.randint(10, cols - 11), rnd.randint(10, rows - 11)
            lvl = M.H[r][c]
            if lvl < 0 or not open_ground(c, r, lvl):
                continue
            along = rnd.choice([(1, 0), (0, 1), (1, 1), (1, -1)])
            length = rnd.randint(18, 34)
            width = rnd.randint(2, 3)
            tiles = []
            bridges = set()
            x, y = c, r
            since_bridge = 0
            for i in range(length):
                if rnd.random() < 0.3:
                    x += rnd.choice([-1, 1]) if along[0] == 0 else 0
                    y += rnd.choice([-1, 1]) if along[1] == 0 else 0
                x += along[0]
                y += along[1]
                since_bridge += 1
                bridge = since_bridge >= rnd.randint(7, 11)
                if bridge:
                    since_bridge = 0
                across = (-along[1], along[0]) if along[0] and along[1] else ((0, 1) if along[0] else (1, 0))
                for w in range(width):
                    t = (x + across[0] * w, y + across[1] * w)
                    if bridge:
                        bridges.add(t)
                    else:
                        tiles.append(t)
            if len(tiles) < 20 or any(not open_ground(x, y, lvl) for x, y in tiles) or any(not open_ground(x, y, lvl) for x, y in bridges):
                continue
            drop_small_props(tiles)
            for x, y in tiles:
                void(x, y, 2)
            return f'{len(tiles)} tiles from {c},{r}, {len(bridges)} land bridge tiles'
        return None

    # 5. Rubble fields: cracked ground with rubble and boulders; heaved slabs beside the road.
    def add_prop(pid, c, r, size):
        o = {'kind': 'prop', 'id': pid, 'col': c, 'row': r, 'footprint': [size, size], 'dressing': True}
        data['objects'].append(o)
        for x, y in footprint(o):
            M.B[y][x] = 1

    def rubble_field():
        for _ in range(60):
            c, r = rnd.randint(8, cols - 9), rnd.randint(8, rows - 9)
            rad = rnd.randint(3, 5)
            lvl = M.H[r][c]
            tiles = [(c + dc, r + dr) for dc in range(-rad, rad + 1) for dr in range(-rad, rad + 1) if dc * dc + dr * dr <= rad * rad + rad]
            good = [t for t in tiles if open_ground(*t, lvl)]
            if lvl < 0 or len(good) < len(tiles) * 0.7:
                continue
            z = zone_of(c, r)
            taken = {(s[0], s[1]) for s in (z.get('spawns', []) if z else [])} | {tuple(m['tile']) for m in (z.get('miniBosses', []) if z else [])}
            props = 0
            for x, y in good:
                M.G[y][x] = 'cracked'
            for x, y in good:
                if (x, y) in taken or rnd.random() > 0.12 or any((x + dc, y + dr) in taken for dc, dr in DIRS8):
                    continue
                if M.B[y][x]:
                    continue
                add_prop(f'slums-boulder-{rnd.randint(1, 3)}' if rnd.random() < 0.3 else f'slums-rubble-{rnd.randint(1, 6)}', x, y, 1)
                props += 1
            return f'{len(good)} cracked tiles at {c},{r}, {props} props'
        return None

    def slabs():
        n = 0
        road = [(c, r) for r in range(rows) for c in range(cols) if M.G[r][c] == 'concrete' and 60 <= r <= 130]
        rnd.shuffle(road)
        for c, r in road:
            if n >= 5:
                break
            for dc, dr in ((0, 2), (0, -3), (2, 0), (-3, 0)):
                x, y = c + dc, r + dr
                tiles = [(x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1)]
                if all(M.inside(*t) and not M.B[t[1]][t[0]] and M.G[t[1]][t[0]] in ('dirt', 'dirt-junk', 'weeds') and M.H[t[1]][t[0]] == M.H[r][c] and t not in protect for t in tiles):
                    drop_small_props(tiles)
                    add_prop(f'slums-slab-{rnd.randint(1, 3)}', x, y, 2)
                    for t in tiles:
                        M.G[t[1]][t[0]] = 'cracked'
                    n += 1
                    break
        return f'{n} slabs' if n else None

    # Targets that must stay reachable from arrive.town (spawns are moved first where terrain took their tile).
    def fix_spawns():
        moved = 0
        for z in zones:
            lvl = z['height']
            c0, r0, c1, r1 = z['rect']

            def good(c, r):
                return c0 <= c <= c1 and r0 <= r <= r1 and M.walkable(c, r) and M.H[r][c] == lvl and (c, r) not in M.ramps

            def nearest(t):
                if good(*t):
                    return t
                for rad in range(1, 20):
                    for dc in range(-rad, rad + 1):
                        for dr in range(-rad, rad + 1):
                            if max(abs(dc), abs(dr)) == rad and good(t[0] + dc, t[1] + dr):
                                return [t[0] + dc, t[1] + dr]
                return t

            for i, s in enumerate(z.get('spawns', [])):
                n = nearest(tuple(s))
                if tuple(n) != tuple(s):
                    z['spawns'][i] = list(n)
                    moved += 1
            for m in z.get('miniBosses', []):
                n = nearest(tuple(m['tile']))
                if tuple(n) != tuple(m['tile']):
                    m['tile'] = list(n)
                    moved += 1
        return moved

    def set_targets():
        targets.clear()
        for z in zones:
            targets.extend(z.get('spawns', []))
            targets.extend(m['tile'] for m in z.get('miniBosses', []))
        targets.extend(pit_floor)
        for k in ('warrens', 'lanternPost'):
            if k in data['arrive']:
                targets.append(data['arrive'][k])

    set_targets()
    lost = check()
    if lost:
        log(f'before anything: {lost} is already unreachable from arrive.town (left as is)')
    apply('bluffs', bluffs)
    apply('Wire Ridge crest', crest)
    for i in range(6):
        apply(f'mesa {i + 1}', lambda i=i: mesa(i))
    for i in range(5):
        apply(f'sinkhole {i + 1}', sinkhole)
    for i in range(3):
        apply(f'canyon {i + 1}', canyon)
    for i in range(6):
        apply(f'rubble field {i + 1}', rubble_field)
    apply('heaved slabs', slabs)
    moved = fix_spawns()
    set_targets()
    lost = check()
    if lost:
        raise SystemExit(f'[terrain] after everything, {lost} is unreachable: this should not happen')
    data.setdefault('groundKey', {})
    data['groundKey']['void'] = "a chasm's floor: never walked on (tile-slums-void-N)"
    data['groundKey']['cracked'] = 'cracked ground: broken concrete, walkable (tile-slums-cracked-N)'
    data['heightNote'] = 'Ground level per tile: -2 canyon floor, -1 sinkhole floor (both void: never walked on), 0 = Crab Basin floor, 1 = normal ground, 2 = Wire Ridge and junk mounds, 3 = the ridge crest and mesa tops, up to 5 = the bluffs along the back edges. One level = 16 px. Walking between tiles of different height is only possible on ramps. Draw rules: tiles/slums/slums-elevation-README.md and slums-high-terrain-README.md (scripts/terrain/apply_high_terrain.py adds the high terrain).'
    return added, skipped, moved


# ── The Scrap Warrens ──

def warrens(data, layout, protect, rnd):
    M = Map(data)
    cols, rows = M.cols, M.rows
    D = data['dungeon']
    added = []
    skipped = []
    # Never touched: the start room and its seal, the exit and clear warps, every shutter and its passage, the Shanty Hall
    # (the last area's rect), boss tiles and the last boss's body, guards, checkpoints and pack spawns; with 1 round each
    # for the pits, plus the --protect file (3 round those).
    never = set()
    never.update(tuple(t) for t in D['startTiles'])
    never.update(tuple(t) for t in D['seal'])
    never.update(tuple(t) for t in D['exitWarp'])
    never.update(tuple(t) for t in D.get('clearWarp', []))
    for s in D['shutters']:
        never.update(tuple(t) for t in s['tiles'])
        never.update(tuple(t) for t in s['passage'])
    for a in D['areas']:
        never.add(tuple(a['bossTile']))
        never.update(tuple(t) for t in a['guards'])
        never.add(tuple(a['checkpoint']))
    hall = max(D['areas'], key=lambda a: a['index'])
    never.update(rect_tiles(hall['rect']))
    never.update(rect_tiles(D['boss']['body']))
    for z in data['mobZones']:
        for g in z.get('groups', []):
            never.update(tuple(t) for t in g)
        never.update(tuple(t) for t in z.get('spawns', []))
    pit_clear = grow(never, 1, cols, rows) | protect
    wall_clear = grow(rect_tiles(hall['rect']), 1, cols, rows)
    floor = {(c, r) for r in range(rows) for c in range(cols) if M.H[r][c] == 0 and not M.B[r][c]}
    is_wall = lambda c, r: M.inside(c, r) and M.H[r][c] >= 1 and M.B[r][c]

    # 1. Taller, stepped walls: a wall tile's level is 1 + its distance from the nearest floor tile (up to 4).
    dist = {}
    q = deque()
    for c, r in floor:
        dist[(c, r)] = 0
        q.append((c, r))
    while q:
        c, r = q.popleft()
        for dc, dr in DIRS8:
            n = (c + dc, r + dr)
            if n in dist or not M.inside(*n):
                continue
            dist[n] = dist[(c, r)] + 1
            q.append(n)
    raised = 0
    spires = 0
    taken = {footprint_tile for o in data['objects'] for footprint_tile in footprint(o)}
    for r in range(rows):
        for c in range(cols):
            if not is_wall(c, r) or (c, r) in wall_clear:
                continue
            lvl = min(4, 1 + max(0, dist.get((c, r), 1) - 1) + 1)
            M.H[r][c] = lvl
            M.W[r][c] = 'scrap'
            raised += 1
            if lvl >= 2 and (c, r) not in taken and rnd.random() < 0.03:
                data['objects'].append({'kind': 'prop', 'id': f'slums-junk-spire-{rnd.randint(1, 3)}', 'col': c, 'row': r, 'footprint': [1, 1], 'dressing': True})
                taken.add((c, r))
                spires += 1
    added.append(f'walls: {raised} tiles stepped to levels 2-4, {spires} junk spires')

    # Checks, as the build script's.
    passages = {tuple(t) for s in D['shutters'] for t in s['passage']}
    area1 = D['areas'][0]['rect']

    def wide_enough(t):
        c, r = t
        for dc in (-1, 0):
            for dr in (-1, 0):
                block = [(c + dc + x, r + dr + y) for x in (0, 1) for y in (0, 1)]
                if all(M.walkable(*b, passages) for b in block):
                    return True
        return False

    def ok():
        reach = M.flood(data['arrive']['slums'], passages)
        for t in floor:
            if M.H[t[1]][t[0]] >= 0 and t not in reach:
                return f'{t} unreachable'
        shut = M.flood(data['arrive']['slums'])
        for c, r in shut:
            if not (area1[0] <= c <= area1[2] and area1[1] <= r <= area1[3]):
                return f'{(c, r)} out of area 1 with the shutters shut'
        for t in floor:
            if M.H[t[1]][t[0]] >= 0 and not wide_enough(t):
                return f'path too narrow at {t}'
        return None

    before = ok()
    if before:
        log(f'before the pits: {before} (as built)')

    # 2. Pits along walls: short runs of floor beside a wall, one level down; and in each arena's corners (2x2).
    def pit(tiles):
        tiles = [t for t in tiles]
        if any(t not in floor or t in pit_clear or M.H[t[1]][t[0]] < 0 for t in tiles):
            return False
        snap = M.snapshot()
        for c, r in tiles:
            M.H[r][c] = -1
            M.B[r][c] = 1
            M.G[r][c] = 'void'
        bad = ok()
        if bad:
            M.restore(snap)
            return False
        return True

    corners = 0
    for a in D['areas']:
        if a is hall:
            continue
        c0, r0, c1, r1 = a['arena']
        if c1 - c0 < 7 or r1 - r0 < 7:
            continue
        for cc, rr in ((c0, r0), (c1 - 1, r0), (c0, r1 - 1), (c1 - 1, r1 - 1)):
            if pit([(cc, rr), (cc + 1, rr), (cc, rr + 1), (cc + 1, rr + 1)]):
                corners += 1
    added.append(f'arena corner pits: {corners}')
    along = 0
    # Along walls: only where the floor runs at least 3 tiles out from the wall (rooms and wide corridors; a 3-wide tunnel
    # never loses a tile, so its every column stays open).
    def roomy(t):
        for dc, dr in DIRS4:
            if is_wall(t[0] + dc, t[1] + dr):
                if all((t[0] - dc * k, t[1] - dr * k) in floor and M.H[t[1] - dr * k][t[0] - dc * k] >= 0 for k in range(1, 4)):
                    return True
        return False

    candidates = [t for t in floor if t not in pit_clear and roomy(t)]
    rnd.shuffle(candidates)
    for c, r in candidates:
        if along >= 40 or M.H[r][c] < 0:
            continue
        direction = rnd.choice(DIRS4)
        run = [(c + direction[0] * k, r + direction[1] * k) for k in range(rnd.randint(2, 4))]
        if any(not roomy(t) for t in run):
            continue
        if pit(run):
            along += 1
    added.append(f'pits along walls: {along}')
    data['heightNote'] = 'Ground level per tile: -1 a pit (void: never walked on), 0 = the maze floor, 1-4 = its junk walls (raised, blocked; taller the further from the floor). No ramps. scripts/terrain/apply_high_terrain.py adds the pits and the stepped walls after the build.'
    return added, skipped


def main(argv):
    args = [a for a in argv if not a.startswith('--')]
    opts = {a.split('=')[0]: (a.split('=')[1] if '=' in a else None) for a in argv if a.startswith('--')}
    protect_path = opts.get('--protect')
    if protect_path is None and '--protect' in argv:
        protect_path = argv[argv.index('--protect') + 1]
        args.remove(protect_path)
    seed = int(opts.get('--seed') or 20261012)
    if '--seed' in argv and opts.get('--seed') is None:
        seed = int(argv[argv.index('--seed') + 1])
        args.remove(str(seed))
    rnd = random.Random(seed)
    if len(args) >= 3 and args[0] == 'slums':
        with open(args[1]) as f:
            data = json.load(f)
        protect = load_protect(protect_path, *data['size'])
        added, skipped, moved = slums(data, protect, rnd)
        for a in added:
            log(f'added {a}')
        for s in skipped:
            log(f'skipped {s}')
        log(f'moved {moved} mob spawn / mini boss tiles')
        with open(args[2], 'w') as f:
            json.dump(data, f, separators=(',', ':'))
        log(f'wrote {args[2]}')
        return
    if len(args) >= 4 and args[0] == 'warrens':
        with open(args[1]) as f:
            data = json.load(f)
        with open(args[2]) as f:
            layout = json.load(f)
        protect = load_protect(protect_path, *data['size'])
        added, skipped = warrens(data, layout, protect, rnd)
        for a in added:
            log(f'added {a}')
        for s in skipped:
            log(f'skipped {s}')
        with open(args[3], 'w') as f:
            json.dump(data, f, separators=(',', ':'))
        log(f'wrote {args[3]}')
        return
    raise SystemExit(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
