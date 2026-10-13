# NZ Driving Simulator

Browser trainer for the New Zealand restricted licence practical test. Three.js + TypeScript + Vite, no backend.

Live build: https://alexgurov99-code.github.io/licence/

Project brief, architecture and stage plan: [CLAUDE.md](CLAUDE.md).

## Development

Requires Node.js 22.13+.

```sh
npm install
npm run dev        # local dev server at http://localhost:5173
npm run check      # lint + typecheck + tests (run before committing)
npm run build      # production build into dist/
```

Every push to `main` is checked and deployed to GitHub Pages by `.github/workflows/deploy.yml`.
Pull requests run the same checks without deploying.

## Controls

| Key | Action |
| --- | --- |
| W / S | Accelerator / brake (pressed in smoothly while held) |
| A / D | Steer left / right |
| 1 / 2 / 3 / 4 | Gear P / R / N / D (leaving P needs the brake held) |
| Enter | Start / stop the engine (starts only in P with the brake held) |
| Space | Handbrake on / off |
| B | Seat belt |
| Q / E | Left / right indicator (press again to switch off) |
| H | Hazard lights |
| C | Driver's seat view / view from behind |
| Arrows (hold) | Look: ↑ rear-view mirror, ← / → door mirrors, ↓ back; ↓+← / ↓+→ over the shoulder |
| `` ` `` | Debug panel |
| N | New town (only while the debug panel is open) |

A drive starts parked on the left shoulder of a side street, with the engine off, in P, with the handbrake on and the belt off.

## Town and seed

The town is generated from a seed: the same seed always gives the same streets, junctions, signs and houses.
The seed is in the address, e.g. `…/licence/?seed=abc`; without one, a new seed is made up and written into the address,
so reloading the page or sharing the link gives the same town.

Key bindings live in `src/input/keymap.ts`; all tunable numbers live in `src/config.ts`.
