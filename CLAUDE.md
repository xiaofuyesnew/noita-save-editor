# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

A **Node.js + web UI save editor for Noita** (the game by Nolla Games), operating on `save00` save-slot data. The project lives at the repository root — Hono backend in `server/`, Vite + Vue 3 frontend in `frontend/` (pnpm workspace sub-package: Pinia / Naive UI / UnoCSS / vue-i18n, plain JS with `@antfu/eslint-config`, no TypeScript), Electron desktop shell in `electron/`, prebuilt data dictionaries in `data/`, tests in `test/`. The server serves `frontend/dist/` when it exists, falling back to the legacy no-build page in `web/` (kept until M8 per-card acceptance completes, then deleted). The researched implementation plan and per-milestone log live in `docs/save-editor-plan.md`. (Until 2026-07-17 the project sat under `editor/`; it has been hoisted to the root.)

The repo also hosts a **snapshot copy of a real save slot** at `save00/` (gitignored, machine-local). The live save the game actually uses is at:

```
C:\Users\xiaof\AppData\LocalLow\Nolla_Games_Noita\save00
```

The snapshot is the editor's default workspace (the in-app pull/push sync targets the live location) and doubles as the full-fidelity test fixture. Checkouts without it (e.g. CI) automatically fall back to the minimal committed fixtures in `test/fixtures/save00/` — see `test/setup.js` for the resolution order.

**Package manager: use `pnpm`** (not npm or yarn). The version is pinned via the `packageManager` field in `package.json`, and only `pnpm-lock.yaml` is committed. Common commands (run from the repo root): `pnpm install`, `pnpm dev` (Hono on 5710 + vite HMR dev server), `pnpm build` (vite build → `frontend/dist`), `pnpm lint` (@antfu/eslint-config, frontend only), `pnpm start` (browser mode on 127.0.0.1:5710, serves built frontend), `pnpm start:desktop` (Electron), `pnpm test`, `pnpm dist` (builds frontend then Windows NSIS + portable packages). `.npmrc` configures npmmirror mirrors for the electron runtime and electron-builder binaries (direct GitHub downloads are TLS-reset on this network); `pnpm-workspace.yaml` lists the `frontend` package and approves electron's postinstall via `allowBuilds`.

## Workflow

- **Noita must be closed** before copying edits back to the live location — the game rewrites the save on autosave and on exit, which would clobber your changes.
- Back up before overwriting either side (the editor UI's pull/push buttons do this automatically, with process detection):
  - Refresh snapshot from live: `cp -r "$USERPROFILE/AppData/LocalLow/Nolla_Games_Noita/save00" D:/workspace/noita-save-editor/`
  - Apply edits to live: `cp -r D:/workspace/noita-save-editor/save00 "$USERPROFILE/AppData/LocalLow/Nolla_Games_Noita/"`
- After editing any XML, verify it is still well-formed (`python` here is only the Windows Store stub, use PowerShell):
  `powershell -Command "[xml](Get-Content -Raw 'save00/player.xml') > $null; 'OK'"`
- The XML is Noita's own serializer output: one attribute per line with a trailing space, `<E key value>` entries for maps. Make minimal, surgical edits; don't reformat files. The `server/xml/` pipeline round-trips these files byte-identically — run `pnpm test` after touching it.
- Stats files contain localized strings (this install plays in Chinese, e.g. `killed_by="图尔索 | 近战"`) — keep encoding intact.

## Save architecture

Editable XML vs. opaque binary is the key distinction:

- `save00/player.xml` — the entire player as an entity/component tree. Key parts:
  - `_Transform` — world position.
  - `DamageModelComponent` — `hp` / `max_hp` in internal units where **1 unit = 25 displayed HP** (`hp="4"` shows as 100 HP in-game; cross-checked against session stats which record `hp="100"`).
  - `WalletComponent` — `money` (gold).
  - Child entity `inventory_quick` — the quick-bar: wand entities (tags contain `wand`) and potions. Each wand has an `AbilityComponent` (mana, `mana_max`, `mana_charge_speed`, `gun_config` capacity/spread/reload) and child entities for its spells, each carrying `ItemActionComponent action_id="LIGHT_BULLET"` etc.
  - Child entity `inventory_full` — the spell bag (loose spells).
- `save00/world_state.xml` — per-run world state: `WorldStateComponent` (run flags, weather, `lua_globals` such as `ORB_MAP_STRING` and `visited_biomes`, orbs found this run) and `PlayerStatsComponent` (`max_hp` in the same ×25 units).
- `save00/mod_config.xml` — enabled/disabled mod list.
- `save00/persistent/` — progression that survives across runs (deaths):
  - `flags/` — one file per flag; **the file's existence is the flag** (contents are an easter-egg string, "why are you looking here"). Naming: `action_*` (spell cast/progress), `card_unlocked_*` (spell unlocked for the spawn pool), `perk_picked_*`, `miniboss_*`, `essence_*`. Create/delete files to toggle progression.
  - `orbs_new/` — one file per collected orb, named by orb index (`0`–`10`).
  - `bones_new/item*.xml` — full wand entity XMLs from previous (dead) runs; the game can respawn these wands in future runs.
- `save00/stats/` — `sessions/<timestamp>_stats.xml` + `_kills.xml` per run (includes `world_seed`, `killed_by`, playtime); `stats_<enemy>.xml` per-enemy-type lifetime kill/death maps.
- **Binary / do not hand-edit:** `world/` (terrain chunks `world_<x>_<y>.png_petri` — a custom format despite the name — plus `area_*.bin`/`entities_*.bin` entity stripes and `world_sim.bin`, `world_tree.bin`, `world_pixel_scenes.bin`), `mod_settings.bin`, and `session_numbers.salakieli` (encrypted). Treat `world/` + `world_state.xml` as one consistent unit; mixing an edited world state with stale chunk data can corrupt the run.
