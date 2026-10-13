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

## Controls (stage 0)

| Key | Action |
| --- | --- |
| W | Accelerate |
| S | Brake; at a standstill, reverse |
| A / D | Steer left / right |
| `` ` `` | Debug panel |

Key bindings live in `src/input/keymap.ts`; all tunable numbers live in `src/config.ts`.
