# Wasteland Behemoths — agent orientation

An **original** hex-map strategy game. One player commands a giant bio-mech Behemoth against 1–3 AI warlords in the browser.
This is not a port: see `PLAN.md` D1 for why.
Credit the author as **evilgouki**. Never write the owner's real name, email or home path in this repo (KB rules.md rule 11).

- **Knowledge base:** `docs/knowledge-base/` is the `dragoonant/tabletop-kb` submodule (`git submodule update --init`).
  Apply its `rules.md` standing rules without re-asking. At the end of every milestone, update its `wasteland-behemoths.md` entry and add cross-project lessons to its `gotchas.md` (rule 19). Edit and push the KB repo, then bump the submodule pointer here.
- **Rules:** `docs/spec/10-rules.md` holds the rule ids, the balance record and the `RULING:` lines. Tests are named by rule id. Balance changes need a sim or bench number.
- **Decisions:** `PLAN.md`. **State and next steps:** `STATUS.md`. Rewrite STATUS in place; do not append to it.

## Commands
```bash
npm install
npm run dev        # http://localhost:5173
npm test           # rules tests, 30-game sim with invariants, save round-trip, AI bench
npm run bench      # AI vs random only (gate: at least 95% wins)
npm run e2e        # Playwright: rules 22, 24, 25, text sweep (PW_PORT, default 4317)
npm run gates      # all of the above
npm run build      # dist/, relative base (works under /<repo>/ on Pages)
```

## Layout
- `src/engine/`: pure, deterministic and plain-JSON state, with no DOM code. `rules.ts` (setup, turn flow, `applyAction`, queries that own every number), `cards.ts`, `map.ts`, `hex.ts`, `rng.ts`, `ai.ts` (`planAction`, `randomAction`), `save.ts` (the rule-22 envelope).
- `src/ui/board.ts`: the SVG board. Tiles are the only pick targets (rule 25), and there are no native tooltips (rule 8). `src/main.ts`: app state, panel, input, AI playback, autosave.
- `tests/engine.test.ts` (Vitest), `tests/e2e/game.e2e.ts` (Playwright).

## House rules that bite here
- The UI never does rules maths: add a query to `rules.ts` and display that.
- Every accepted action goes through `perform()` in `main.ts`, which appends it to `ui.actions` and autosaves.
- Escape every inserted string with `esc()`, apostrophes included.
- Cloud sessions: a Bash command the safety check cannot parse (Python heredocs, long chains) is refused. Write scripts with the Write tool and run them by path.
