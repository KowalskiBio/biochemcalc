# Codebase Notes — BioCal (biochemcalc)

> Reference for safe feature work. Reconnaissance date: 2026-10-12 (branch: fresh clone).
> Read this before touching anything. Section 8 ("Do not break") is the important one.

---

## 1. What it is

**BioCal** — a generator of randomized biochemistry calculation problems. Teachers author
**question templates** (text with `[[variable]]` placeholders + a formula + constants);
the app samples values, evaluates the formula, correctly rounds, generates believable wrong
answers (spread options, decoys, a second-correct "alternace"), and exports tests in the
**IS MU** university format. Students practise in the browser (timed tests, streak runs,
leaderboard). **UI language is Czech.**

License: AGPL-3.0-or-later, © Vojtěch Rejtar. Live at biocal.ubch.sci.muni.cz.

## 2. Architecture — one Rust core, two transports

```
React 19 / TS / Tailwind / Radix (src/)
   ├── JSON over HTTP ──→ axum server (src-tauri/src/http)      ← web path
   └── Tauri commands ──→ desktop app (src-tauri/src/lib.rs)    ← desktop path
            └── BOTH call shared `do_*` business functions (src-tauri/src/commands)
                     ├── engine/   formula evaluation, variant generator, IS MU export
                     └── db/       SQLite (47 migrations, 23 repos)
```

Key facts:

- The **Rust side does the real work**: formula engine, generation, IS MU export, SQLite,
  auth/sessions, SMTP email. Tauri commands are thin adapters locking `AppState.db` and
  calling `pub do_*` / repo functions reused by the axum handlers.
- The frontend **ts-parses formulas too, but only for live preview**. The Rust engine is
  authoritative. Any change to formula semantics must be made in BOTH
  `src/lib/math-utils.ts` and `src-tauri/src/engine/formula.rs` (and `answer_targets.rs`).
- Web frontend **does not use Tauri IPC** — `src/lib/api.ts` POSTs to `/api/cmd/<command>`
  (see `src/lib/http.ts`, Vite proxies `/api` → `localhost:8080` in dev, `vite.config.ts:48`).
  ~73 Tauri commands exist only for the desktop build; HTTP routes mirror them
  (`http/routes/cmd.rs:890-984`).
- Auth (login/register/reset), practice, tests, streaks, reports are **HTTP-only** —
  no Tauri commands. Desktop is effectively single-user teacher-only.
- `AppState` = `Mutex<Connection>` + data dir + `Mailer` + `public_base_url`, shared by both.

### Backend layout (`src-tauri/src/`)

| Path | Role |
|---|---|
| `engine/` | `formula.rs` (evalexpr-based eval + molar masses), `generator.rs` (~5,900 lines: sampling, rounding, distractors, constraints), `variable_extractor.rs`, `answer_targets.rs`, `export_writer.rs` (IS MU `.txt`) |
| `db/` | `schema.rs` (~2,470 lines, **47 idempotent migrations**, `CURRENT_USER_VERSION = 47`) + `repos/` (23 repos, one per entity) + `biomolecule_seed.rs` (built-in Biomolekuly dataset) |
| `commands/` | `crud.rs` (~3,110 lines), `generation.rs`, `importer.rs`; HTTP-only: `auth.rs`, `practice.rs`, `test_session.rs`, `streak_run.rs`, `reports.rs` |
| `http/` | axum router + SPA fallback, DB-backed session-cookie middleware with role gating (`require_teacher`, `require_admin`, `require_calculations`), `routes/{auth,cmd,student}.rs` |
| `bin/` | `biochemcalc-server` (web entrypoint, env-configured), `import_bulk_json`, `reparse_test1` |
| `email.rs` | SMTP (lettre) password reset; `Disabled` mode just logs the link |
| `lib.rs` | Tauri app: registers **70 commands**, seeds constants/atomic weights, file logger + panic hook |

Notable deps (Rust): `evalexpr` (formula eval — *not* hand-rolled on the Rust side),
`rusqlite` bundled, `axum` 0.8, `argon2`, `lettre`.

### Frontend layout (`src/`)

| Path | Role |
|---|---|
| `main.tsx` → `App.tsx` | Entry; `App.tsx:109` routes; role split `RequireAuth` → `TeacherRoutes`/`StudentRoutes` |
| `pages/` | ~30 screens (teacher under `AppShell`: topics/sets/databaze/vzorce/bulk-import/constants/history/hlaseni/leaderboard/settings + biomolekuly; student under `StudentShell`: practice/test/ucen/mistr/results/leaderboard/settings + biomolekuly) |
| `components/` | Feature dialogs + layout shells + shadcn `ui/` primitives. **`questions/question-detail-dialog.tsx` (~125 KB) is the largest, most critical, untested file** — the teacher's whole editing surface |
| `stores/` | Zustand only: `auth-store` (cookie-based, not persisted), `databaze-store` (**persisted localStorage, client-local, NOT server-backed**), `ui-store` (persisted theme; in-memory `lastSection`), `drag-store` (carry), `generation-store` (per-set variants + difficulty) |
| `lib/` | API clients (`api.ts`, `student-api.ts`, `auth-api.ts`, `reports-api.ts` → `http.ts`), plus the mirror engine: `math-utils.ts` (**1,621 lines — tokenizer/parser/AST evaluator/LaTeX**), `chemical-formula-parser.ts`, `periodic-table-data.ts` (canonical atomic weights), bulk-import/verify, `formula-checker.ts`, `render-question-text.tsx`, `types.ts` (**must match Rust models exactly**, header comment `:2`) |
| `i18n/cs.ts` | Single Czech string dictionary, imported directly as `cs` — **no i18n runtime/provider**. All new UI text goes here |

State flow: pages call API clients via `useState`/`useEffect` (no React Query), pass props.
Constants are fetched per-page with no shared cache.

## 3. The domain model (core concepts)

- **Topic** (*téma*) → **Category** (*skupina*, points restricted to **2|3|4**) → **Set** (*sada*)
  → **Template** (question): text with `[[X]]` placeholders.
- **Variable**: symbol, range (min/max/step), significant digits, notation (`auto|scientific|normal`),
  or string-valued (element/salt pools). **Comparison constraints** between variables keep
  samples chemically sensible.
- **Formula** per answer; **several answers** per template; optional decoy formulas
  (*návnady*, typical-mistake results); `alternace` = second correct option.
- **Constants** (server-side, seeded), **atomic weights** (`periodic-table-data.ts` = source
  of truth for molar mass), **databáze** entries (`M_NaCl`-style molar masses + paired
  constants like an acid with its Ka — stored client-side in localStorage!).
- Formula language: `+ - * / ^ × · ∙`, unary minus, parens, `%` postfix, `sqrt sin cos tan
  log ln abs exp`, `pi`/`e`, multi-assignment with `;`, `—` starts a comment, `M_<formula>`
  molar masses (hydrates with `.`/`*`/`·`/`∙`), scientific notation `7.2e-10`.
- Generation: difficulty presets drive option spread (closed) / tolerance (open, ±50/30/10/5 %).
  Export writer produces IS MU `.txt` with Czech decimal commas, real ×/minus, e-notation.

## 4. Root data files (test fixtures only — not referenced by `src/`)

| File | Use |
|---|---|
| `bulk_import_payload.json` (~45 KB) | Default input of `import_bulk_json` bin. Schema: `BulkImportTemplatesPayload` |
| `test1_bulk.json` | **Byte-identical duplicate** of the above; used by `importer.rs` tests |
| `test1_parsed.json` (~25 KB) | Older parse format; only used by `reparse_test1` bin |

All three are in `.ragignore`. Don't delete without updating `importer.rs` tests/bins.

## 5. Tests & commands

```bash
npm install
npm run dev:local   # backend :8080 (local DB copy) + Vite :1420 — normal web dev
npm run db:pull     # pull live DB snapshot into .local-dev/ (read-only vs VM)
npm run tauri dev   # desktop app
npm test            # Vitest (13 test files, all colocated in __tests__/)
npm run check       # Biome lint + format (CI gate)
npm run build       # tsc --noEmit + vite build
cargo test --manifest-path src-tauri/Cargo.toml
```

- Vitest: `environment: "node"`, `globals: true`, alias `@` → `./src`. Well covered: math-utils,
  formula parsers, bulk import, databaze-store, decimal-input/formatted-result components.
  **Not covered: API clients, routing, stores, pages, question-detail-dialog.**
- Biome: 2-space indent, width 100, double quotes, no `any`, no default exports
  (`src/components/ui/**` excluded), `useImportType`. Run `npm run check` before commit.
- `@playwright/test` is installed but **no e2e config/specs exist**.

## 6. Design system (enforced — see DESIGN.md + design-system/)

"Benchtop lab": IBM Plex Sans/Mono, porcelain (light) / forest (dark) CSS-variable tokens,
4px base grid/radius, hairline borders, **no shadows on cards, no gradients, no emoji, no
framer-motion, no default shadcn styling**, ≤150 ms color-only transitions, stats use
`font-mono tabular`, Czech number format `1 234,56`. Check `design-system/pages/[page].md`
first, else `design-system/MASTER.md` (v2.1.0) is authoritative.

## 7. Contributor conventions (documented in repo)

1. New operations go in shared `do_*`/repo functions so both Tauri and HTTP surfaces work.
2. DB changes: **additive numbered migrations only**, bump `CURRENT_USER_VERSION`; never
   alter row counts (DEPLOY.md). Never touch the live DB; always back up before deploy.
3. Follow the design system strictly (section 6).
4. UI strings only via `i18n/cs.ts` (`cs.*`); `index.html` is `lang="cs"`.

## 8. Do not break — fragile/coupled areas

1. **`src/lib/math-utils.ts` ↔ `src-tauri/src/engine/` mirror.** The TS tokenizer/parser/
   evaluator/LaTeX and the Rust `formula.rs`/`answer_targets.rs`/`variable_extractor.rs`
   must agree, or live preview lies. Known traps: greedy scientific-notation exponents
   (`math-utils.ts:32-39`), hydrate `.` vs multiplication `∙`/`·` (`:84-120`, `:750-793`),
   `M_` formula-group scanning (`:102`), `N_A`↔`NA` aliasing (`:624`). Stored teacher
   formulas in the live DB must keep evaluating identically.
2. **Decimal-comma normalization must stay idempotent.** `normalizeDecimalCommasInText`
   (`src/lib/utils.ts:124`) is applied **on every save** (`api.ts:230`); the `(?!10\^)`
   guard prevents double-application corruption. Non-idempotent changes corrupt questions
   on the second save.
3. **`src/lib/types.ts` must match Rust models field-for-field** (`:2`). Any field
   add/rename requires a coordinated Rust change (and usually a migration).
4. **Databáze is client-local** (localStorage `databaze-store`, global, no server sync).
   Bulk import and question rendering read it directly; changing its shape/reset semantics
   changes generated questions silently.
5. **Generation defaults are scientific choices**, not UI trivia: `openDifficulty` →
   Rust `open_interval` tolerance (±50/30/10/5 %); must stay consistent with `i18n/cs.ts`
   `cs.sets` labels and engine behavior.
6. **Role routing is implicit and duplicated.** New route = edit `App.tsx` Routes AND the
   matching shell (`sidebar.tsx` / `student-shell.tsx`). Put teacher pages under the wrong
   shell and `/api/cmd/*` calls 403 (student) or a student feature leaks to teachers.
7. **`question-detail-dialog.tsx` (~125 KB, untested)** — teacher editing surface; depends
   on `variable-editor-row` and `math-utils`. The paired-constants text round-trip
   (`parsePairedConstantsText`/`serializePairedConstants`) has a test — keep that contract
   (Czech comma decimals, multiple pairs per line, one row per string value).
8. **Two theme systems**: `ui-store` (persisted, used by shells) vs `hooks/use-theme.ts`
   (raw localStorage `theme`). Editing one desyncs the other.
9. **Hardcoded physics-like assumptions**: category points ∈ {2,3,4} (enforced in
   `api.ts:291` and `validateTemplateInput:522`); default numeric variable range 1..1000
   (`bulk-import-parser.ts:256`); mass fraction `w` pinned to 0.1..0.9 (`:240`).
10. **Inline-HTML rendering surface**: teacher-typed `_`/`^` markup is rendered via
    `rehype-raw` (`render-question-text.tsx`) — changes to escaping/`formatChemicalText`/
    KaTeX handling can open an injection hole or break all chemistry notation.
11. **Session cookie is not `Secure` yet** (noted in `deploy/biochemcalc.service`) — be
    careful before claiming HTTPS-only cookies work.
12. **No schema change without migration number + version bump**, and migrations must be
    idempotent (the existing 46 are; live DB has real teacher data — backups mandatory).

## 8b. Biomolekuly module (added 2026-10-12)

Learning module for biomolecules (amino acids + nitrogen bases built in; teachers add their
own categories). **Fully DB-backed and teacher-managed since v47** — the two built-in
categories are editable seed data like everything else.

- `src-tauri/src/db/biomolecule_seed.rs` — the built-in dataset (source of truth): the 20
  L-amino acids (PubChem canonical isomeric SMILES, neutral state; glycine the only achiral
  one) and the 5 nitrogenous bases (A/C/G/T/U, keto forms). Traits per molecule:
  `oneLetter`/`abbreviation`, `sideChain`, `charge`, `essential`, `sulfur`, `ringSystem`,
  `pairsWith`, `inDna`/`inRna`, `facts`. Inserted once by migration v47
  (`biomolecule_categories`, `biomolecules`, `biomolecule_traits`).
- `src/lib/molecules/index.ts` — the shared trait vocabulary read by the browse page and
  quiz engine (`TRAIT` keys mirroring `commands::biomolecules::traits`, `traitOf`,
  `hasTraitFlag`, `moleculeFacts`, `isAchiral` ← no `@` in SMILES, category-slug consts).
  No datasets and no category registry live here anymore.
- DB layer: `db/repos/biomolecule_repo.rs` (categories + molecules + traits in one
  `BiomoleculeData` payload; every mutation returns the fresh full dataset), validated in
  `commands/biomolecules.rs` (slugs, NOCASE-unique molecule names per category, controlled
  trait vocabulary/values, SMILES = non-empty printable ASCII ≤ 300). Routes
  (`http/routes/biomolecules.rs`): `/data` (any user), `create-category` /
  `update-category-meta` / `delete-category` / `create-molecule` / `update-molecule` /
  `delete-molecule` (teacher), `record-quiz-result` (requires Biomolekuly access + an
  existing category), `leaderboard` (any user). Teachers may rename/edit/delete built-ins;
  duplicate category names are allowed (the derived slug is uniquified).
- Frontend data: `src/lib/biomolecules-api.ts` (client), `src/stores/biomolecule-data-store.ts`
  (zustand; loads `/data` once per session, every mutation replaces the store atomically;
  `useMoleculeCategories` / `useMoleculeCategory` / `useCategoryMolecules` /
  `useBiomoleculeDataLoaded` + the `useCategoryNames()` / `useCategoryDescriptions()` hooks
  with cs built-in fallback — never read `cs.biomolekuly.categories[id]` directly).
- `src/components/ui/structure-view.tsx` — `StructureView`: SmilesDrawer SVG wrapper
  (`bondLength 24`, `explicitHydrogens: false` keeps the stereochemical wedge).
  TRANSPARENT background (SvgWrapper paints no opaque bg — verified 2.4.1 `constructSvg`),
  theme-aware bonds (`theme` prop or `useUiStore` default).
  **Orientation model**: `orientationDeg`/`mirror` transform the 2D coordinates BEFORE
  rendering by patching the instance's `preprocessor.processGraph` (pinned to
  smiles-drawer@2.4.1 internals; vertex positions + `rings[*].center` transformed so
  aromatic circles stay put). Atom labels stay upright at ANY orientation — this is the
  quiz machinery for "same structure, random orientation". Mirror still flips
  chirality (achiral-only for honest display; enantiomer distractors = flipped SMILES).
  Never CSS-rotate/mirror the finished SVG (rotates/flips text too).
- `src/lib/molecules/orientation.ts` — pure transform math (`transformPoints`,
  `pointsBoundingCenter`); unit tested in `__tests__/orientation.test.ts` (10 tests).
- `src/pages/biomolecules-page.tsx` — hub (`/biomolekuly`, category cards + teacher's
  new-category dialog) + category view (`/biomolekuly/:categoryId`, grid + detail dialog
  with trait rows + teacher management: inline rename, molecule add/edit via
  `MoleculeFormDialog` with live SMILES preview/`onValidityChange`, delete with confirm).
  Both routes in TeacherRoutes and StudentRoutes; nav points at the hub. Per-kind browse
  via local `CategoryBits` descriptors (cardCodeLine, cardBadges?, dialogDescription,
  detailRows) for amino-acids/nitrogen-bases/custom categories, fed by molecules from the
  store. Strings: `cs.biomolekuly.*` (+ `manage.*` block).
- **Quiz engine is family-agnostic**: `question-generator.ts` knows only `QuizMolecule`
  {id, name, smiles, oneLetter?, classKey?, achiral?} — distractor preference via
  `classKeyOf`/classKey, characteristics via injected `CharacteristicDef[]`
  (`predicate: string`, so `trait:value` ids like `charge:positive` work next to the
  curated amino-acid ones). Per-category adaptation lives in `quiz/category-quiz.ts`
  (`getCategoryQuizConfig(categoryId, molecules)`): "aminokyseliny" (oneLetter + sideChain
  classKey + the 8 curated predicates), "dusikate-baze" (ringSystem classKey, achiral → no
  mirror decoys, no letters → exactly 2 quiz types), any other category generically
  (`abbreviation` → quiz letter when every molecule has one, `charge`/`polarity` values →
  predicates, same trait = distractor classKey). `generatableQuizTypes` = the types a
  session can actually produce (≥ 4 molecules, qualifying predicate) — it drives both the
  quiz-page chips and the category page's "Procvičovat" button.
- `src/lib/molecules/quiz/` — headless quiz engine (pure, seed-deterministic, no React/DOM):
  `random.ts` (mulberry32 + pick/shuffle), `question-generator.ts` (7 question types:
  name↔letter, name↔structure, letter↔structure, characteristic — 4-option MCQ, same
  sideChain-class distractor preference, ~50% enantiomer mirror decoys on structure-option
  MCQs for chiral targets, characteristic predicates with distractors strictly from the
  complement), `quiz-session.ts` (pure reducer + `scoreSummary`), `index.ts` barrel.
  Invariants: exactly one correct, 4 options, target queue never repeats consecutively.
- `src/pages/biomolecules-quiz-page.tsx` — practice UI at `/biomolekuly/:categoryId/procvicovani`
  (both shells): reads molecules from `biomolecule-data-store`, builds the config lazily
  (redirect gates on `useBiomoleculeDataLoaded()` — unknown slug / empty category → hub,
  no generatable types → category page): setup (type chips from `generatableQuizTypes`,
  10/20/all count) → question (prompt + options, instant accent/destructive feedback,
  reveal correct on wrong, Enter = next) → results (score, per-type breakdown, restart
  with fresh seed). Finished scores POST to `/record-quiz-result` (best-effort).
- Tests: quiz engine (`__tests__/question-generator.test.ts` + `quiz-session.test.ts`,
  driving configs from `__tests__/fixtures.ts` — a TS copy of the v47 seed; update both
  when the seed changes) + orientation (10).
- smiles-drawer 2.4.1 (MIT, ~55 KB gzip) — chosen over RDKit.js (7.4 MB WASM); see §8.1
  note: TS formula engine is unrelated, no sync needed.
- Dev-machine note: `npm run check` repo-wide shows ~110 pre-existing CRLF formatter
  errors on this Windows checkout (`core.autocrlf=true` vs repo LF); untouched-file noise,
  not gate-worthy. Preview: `npm run dev:local` (now cross-platform via
  `scripts/dev-local.js` → `dev-local.ps1` on Windows / `dev-local.sh` elsewhere); first
  run bootstraps teacher `admin` / `adminpassword1` into a fresh `.local-dev` DB.
  Frontend auth is HTTP-only (`/api/auth/*`); the Tauri webview also needs the local
  server running in dev (Vite proxies `/api` → :8080) — no in-process server in lib.rs.
  PS1 script must stay ASCII-only (PS 5.1 ANSI parse gotcha: UTF-8 dashes break strings).

## 8c. App sections, scoped invite codes, admin (added 2026-10-14)

The app is split into **sections**: laboratory calculations and Biomolekuly (more later —
the switcher shows a disabled "We are cooking…" teaser). Victor (LLM chat) was removed
entirely (frontend, `commands/victor.rs`, routes, `reqwest`, the dead `settings_repo`).

- **Access** (`models::SectionAccess` = calculations | biomolecules | both; migration v43):
  a student's `users.sections` is copied from the invite code they registered with;
  teachers always read as `both` (`UserRecord::effective_sections`). Pre-v43 accounts
  and codes are calculations-only.
- **Invite codes are student-only** with a section scope; one live code per
  (role, sections) — minting replaces only the same-scope code. v43 revoked live
  teacher codes; `do_register` rejects any teacher code.
- **Admin** = the `protected` bootstrap account (`User.isAdmin`). `/api/auth/users*`
  (list/create/update/delete) sit behind `require_admin`; creating a user there is the
  only way to add a teacher. The protected account can't be re-roled or deleted.
- **Preferred section** (`users.preferred_section`, `POST /api/auth/preferred-section`)
  is saved server-side whenever the user picks in the switcher or the one-time
  `SectionPicker` (shown when access is `both` and nothing is saved yet — no hard-coded
  default). Single-section users see the switcher locked with an explanation.
- **Server gate**: `/api/student/*` practice/test/streak/report routes need calculations
  access (`require_calculations`); `leaderboard`/`streak-leaderboard` are shared.
- **Frontend**: `src/hooks/use-section.ts` (`useSection`: URL → section, shared pages
  `/leaderboard` `/settings` `/help` fall back to the last section then the saved
  preference; `useLandingRedirect`), `components/layout/section-switcher.tsx` (teacher
  top bar, student sidebar header), `section-picker.tsx`. Sidebars pick their nav list
  per section; `StudentRoutes` only registers the routes the student's access allows.
- **Category name/description edits**: migration v47 replaced the v44 overrides machinery
  (`biomolecule_category_overrides`, folded into `biomolecule_categories` and dropped; the
  built-in categories became editable seed rows). Teachers now rename/edit via
  `POST /api/biomolecules/update-category-meta` {categoryId, field, value} (`InlineCategoryText`
  in `biomolecules-page.tsx`); the old `/category-overrides` + `/update-category` routes are
  gone (pre-v47 app bundles calling them degrade gracefully to cs's built-in text).
  Frontend reads the text only via `useCategoryNames()` / `useCategoryDescriptions()`
  (`stores/biomolecule-data-store.ts`) — never `cs.biomolekuly.categories[id]` directly.
- **Per-section leaderboard**: `/leaderboard` renders the board of the current section.
  Calculations = practice attempts + streak boards (idle students listed only if they
  have calculations access). Biomolekuly = migration v45 `biomolecule_quiz_results`,
  one row per finished quiz, **client-graded** (the quiz runs in the browser), so the
  server only sanity-checks the score (≤ 100 questions, correct ≤ total).
  `/api/biomolecules/record-quiz-result` (`require_biomolecules`) +
  `/api/biomolecules/leaderboard` (any user, optional `categoryId`).
- TODO(biomolekuly-launch) in `App.tsx`: pop-up inviting calculations-only students to
  try Biomolekuly once it's ready.

## 9. Feature-addition checklist

1. Data-model change? → update Rust models + `src/lib/types.ts` + new migration
   (`db/schema.rs`, bump `CURRENT_USER_VERSION`) together.
2. New command? → implement `do_*` in `commands/`, register in `lib.rs`, expose route in
   `http/routes/cmd.rs` (or `student.rs`), add client fn in `src/lib/api.ts` (etc.).
3. Formula-language change? → change `math-utils.ts` AND Rust engine together, add tests in
   both (`src/lib/__tests__/math-utils.test.ts`, `cargo test`).
4. New page/route? → `App.tsx` + correct shell sidebar + role gating; strings via `cs.*`.
5. Verify: `npm run check`, `npm test`, `npm run build`, `cargo test ...`; then a smoke run
   via `npm run dev:local` (teacher flow: edit template → generate → preview → export).
