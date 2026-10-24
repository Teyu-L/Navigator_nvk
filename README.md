# UniNav — Indoor University Navigation (MVP)

A mobile-first single-page app that finds the shortest indoor route through a
university building, across multiple floors, and draws it over the floor-plan
images. Built with **Vite + Vanilla TypeScript** (no UI framework) and an
`<canvas>` overlay on top of an `<img>`.

```
┌─ Header ──────────────────────────────┐
│  🎓 UniNav    [A] start …  ⇅  [B] end │
│  quick chips: Cafeteria · Library · …  │
├─ Map ─────────────────────────────────┤
│  <img floor plan> + <canvas overlay>   │
│  zoom controls ↗        Floor 1│2│3    │
├─ Footer ──────────────────────────────┤
│  ~101 m · ~2 min · 3 Floors            │
│  [1 Floor 1→2] [2 Floor 2→3] [3 …]     │
└───────────────────────────────────────┘
```

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
npm run preview  # serve the production build
```

### Deep links (handy for testing)

`?from=<id-or-name>&to=<id-or-name>` pre-fills both inputs and routes instantly:

```
http://localhost:5173/?from=entrance_H_in&to=Rectorate
http://localhost:5173/?from=Caffe&to=Library
```

## Project structure

| File | Responsibility | Phase |
| --- | --- | --- |
| `src/graph.ts` | Graph loading/merging, Dijkstra, multi-floor chunking, search | 1 |
| `src/ui.ts` | Searchable A/B inputs, autocomplete, floor switcher, route summary | 2 |
| `src/renderer.ts` | Canvas drawing, scaling, zoom & pan, markers | 3 |
| `src/main.ts` | Main controller wiring everything + edge cases | 4 |
| `src/types.ts` | Shared domain types | — |
| `index.html` / `src/style.css` | Mobile-first shell and styles | 2 |

### Data

```
public/maps/floor1.png … floor3.png     # floor plan images (750×750)
public/data/floor1.json … floor3.json   # per-floor graphs
scripts/generate_data.js                # derives floors 2–3 from the real floor 1 data
```

Graph JSON shape:

```json
{
  "nodes": {
    "D105": { "x": 170, "y": 521, "floor": 1, "search_aliases": ["D105", "Room D105"] }
  },
  "edges": [{ "from": "D105", "to": "D106" }]
}
```

`x`/`y` are absolute pixel coordinates in the **original** image space. The
canvas backing store is synced to the image's natural size, so 1 canvas pixel
equals 1 graph unit; zoom/pan is applied with a CSS transform on a shared
`stage` wrapper so the line never drifts from the plan.

## How it works

1. **Load & merge** — all floor graphs are fetched and merged into one node set
   and adjacency map (`GraphService.loadAndMergeGraphs`).
2. **Vertical links** — stair/elevator nodes are connected between floors
   (`stairs_X` ↔ `stairs_X_f2` ↔ `stairs_X_f3`) with a fixed floor-change cost,
   which is what makes cross-floor routing possible.
3. **Dijkstra** — `findShortestPath(start, end)` runs over the unified graph.
   Horizontal edges are weighted by Euclidean pixel distance; floor changes use
   a constant penalty so the router need not jump floors without a staircase.
4. **Chunking** — the node list is split into per-floor `RouteSegment`s, each
   remembering the floor transition (`transitionToFloor`) and the connector
   node used, so the UI can show “Floor 1 → Floor 2” steps.
5. **Render** — only the active floor's segment is drawn, plus start (green A),
   destination (red B) and a staircase marker (🛗) at the transition point.

## Edge cases handled

- Route not found → friendly “No direct path found” banner (rendering stays usable).
- Start equals destination → “same point” notice.
- Rapid floor switching → stale image loads are ignored via request tokens.
- No route on the current floor → the plan still renders, just without a line.
- Search matches both node ids and every `search_aliases` entry
  (e.g. `Dean`, `Rectorate`, `Restroom`, `Cafeteria`, `J106`).

## About floors 2 & 3 data

Only floor 1 had a hand-authored graph (`map/final_graph_floor1.json`). To make
the multi-floor MVP demonstrable, `scripts/generate_data.js` derives floors 2
and 3 from that real geometry: same corridors/stairs, room numbers remapped
(`D105 → D205 → D305`), a few landmark rooms renamed (Library, Rectorate, …),
and search aliases generated.

To use real floor 2/3 graphs, replace `public/data/floor2.json` and
`public/data/floor3.json` with the real files (keep stair node ids following the
`<stairsId>_f2` / `<stairsId>_f3` convention) and re-run `npm run dev`. No code
changes required.
