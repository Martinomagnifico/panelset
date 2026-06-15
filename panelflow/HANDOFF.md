# PanelFlow — handoff (PREVIEW / incubating)

> This file travels with the `/panelflow` folder. It's the self-contained context for
> when PanelFlow is copied/extracted into its own repo (Claude Code memory is keyed by
> folder path and does **not** follow a copy — this does).

PanelFlow (PF) is the **flow/navigation layer** above `PanelControl` + `PanelSet`. It
was built **test-first** and currently incubates inside the `panelset` repo as a
**temporary, un-wired sibling** (nothing imports it; it's not in the lib build).

## The hard rule: one-way dependencies
`PanelFlow → PanelControl → PanelSet`. Nothing in the panelset library may import PF.
PF consumes only the **public** surface of the layers below (instance props, events,
`setTabState`, `show/next/prev`, `addPanel/removePanel/refresh`, `getActive`,
`panels`). **Content keys** (`template`/`fields`/`title`) belong to the **render layer**
(the app, or a future PF render helper) — NOT PanelSet: PanelSet never inspects a panel,
it only shows/hides/measures finished `[role="tabpanel"]` elements. **Flow keys**
(`id`/`next`) are PF's to interpret. Neither leaks down into PS/PC.

## What's here (pure engine, test-first)
- `types.ts` — `Answers`, `NextSpec`, `FieldDef`, `StepDef` (flow keys `id`/`next` +
  loose content index signature), `FlowDef` (`{ entry, steps: Record<id, StepDef> }`).
- `resolver.ts` — `resolve(step, answers) → nextId | null`. Precedence: matched
  `cases[answers[field]]` → `default` → `null`. `null` = terminal **or**
  no-match-no-default (callers tell them apart structurally: does the step have `next`?).
- `loader.ts` — `Loader = (id) => Promise<StepDef>`; `inMemoryLoader(flow)` rejects an
  unknown id and **stamps `id` from the map key** (`{ ...step, id }`). The single async
  seam (inline / static file / lazy / mocked / real API).
- `sources.ts` — `loaderFromSource(src) → Loader`: the convenience behind a
  `data-panelflow-src` attribute. Picks one of three shapes by the string: `#id` /
  `.class` / `[attr]` (no `/`) → **inline** JSON from that element; a URL carrying a
  `:id` or `{id}` token → **per-step endpoint** (stamps the requested id); anything else
  → **static file** (fetch the whole flow once, cache, serve by id). Browser-coupled
  (uses `document`/`fetch`) — the pure engine never imports it; pass your own `Loader`
  for auth/GraphQL/transforms. NOTE the relative-path trap: `../flow.json` starts with
  `.` so the inline test must exclude paths (`startsWith('#') || (/^[.\[]/ && no '/')`).
- `engine.ts` — `FlowEngine(load, answers?)`: `start(entryId)`, `advance()`, `back()`,
  getters `nextId`/`previousId`/`canAdvance`/`canGoBack`/`window`, `peekNext()`,
  `setAnswers(patch)`. `prev` is a runtime history stack (push on advance, pop on back),
  NOT JSON back-edges. Extremes are intrinsic: entry = no prev, terminal = no next.
- `controller.ts` — `FlowController(set, load, { render, answers?, idPrefix? })` bridges
  the engine to a **structural `PanelSetLike`** (does NOT import PanelSet — keeps the
  one-way rule and makes it testable against a fake). Maintains a `[prev, current]`
  sliding window: materialises via `addPanel`, prunes via `removePanel`, re-materialises
  on back. `render(step) → HTMLElement` is injected (content rendering is the app's).
  `idPrefix` namespaces DOM panel ids so multiple flows can share a page.
- `index.ts` — public barrel.
- `fixtures.ts` — canonical branch: `q1 ─(path=a)→ q2a → done`, `q1 ─(path=b)→ done`,
  `done` terminal.
- Tests: `*.test.ts` (Vitest). Pure phases run under node; DOM phases use
  `// @vitest-environment jsdom`. `tsconfig.json` (noEmit), `env.d.ts` (stubs `*.scss`
  so the jsdom test can import the real PanelSet).

## Design decisions (and the parked one)
- **Structural vs logical next.** Structural (at an extreme) is intrinsic → PanelSet's.
  Logical (which step is next, given state) → PF's flow def.
- **Case-map baseline** for `next`. Shaped so a guard/expression form (named-guard
  registry, JSONLogic, expression strings) can slot in **without a schema break** —
  **PARKED: build none of that yet.**
- **Sliding window of 2** `[previous, current]`; the next slot materialises once an
  answer resolves the transition. DOM insert/remove lives in the controller.

## Validation & templating (DESIGN — agreed, NOT yet built)
Both are **render-layer / PF concerns fed by JSON metadata**, and both need **zero**
changes to PS/PC. The same field declaration drives two consumers — declare once:
```jsonc
"fields": [{ "name": "firstName", "type": "text", "label": "First name", "required": true }]
//   render reads name/type/label → builds the <input>;  validate reads required → gates Continue
```
- **Templating** = the injected `render(step) → HTMLElement` turning declared `fields`
  (or a `template` ref) into DOM. PanelSet only ever receives the finished panel via
  `addPanel`, so this never touches PS/PC. Spectrum: app-supplied `render` (today) →
  an optional built-in PF field renderer (the JSONForms / SurveyJS pattern) → `template`
  references. All sit above PanelSet.
- **Validation** = a planned **pure `validate.ts` beside `resolver.ts`**:
  `validateStep(step, answers) → { valid, errors }`. Recommended baseline = field-level
  `required` (+ maybe `minLength`/`pattern`); **PARK** step-level expression / cross-field
  rules (same parking rationale as the `next` guard form). Keep `valid` SEPARATE from
  `canAdvance` (structural/logical) — the UI composes `canProceed = canAdvance && valid`.
  The `errors` map feeds the disabled-state hint messaging. Currently the validated demo
  section does this gate as **app glue** (`stepValid()` in `example-pfflow.js`, opt-in via
  `data-pf-validate`) — promote it into the engine when building this for real.

## Where PS/PC *might* still need a change (analysis — only one, and it's optional)
Validation, templating, branching, lazy-load, peek: **none** need PS/PC changes. The
render→`addPanel` path is fully served by today's public API + the two KEEPER fixes.
The ONE latent seam: a **dynamic tabstrip** flow (a *new tab created per step at
runtime*). PanelSet matches triggers to panels by `[aria-controls="<id>"]` so the panel
side is fine, but **PanelControl scans its triggers once at init** (`_onElementResolved`
wires roving over `[aria-controls]`) with **no `refresh()` / MutationObserver** — so a
newly injected tab won't join the roving/keyboard model until told. That would warrant a
small, GENERAL `PanelControl.refresh()` (re-scan `[role=tab]`/`[aria-controls]`,
re-establish the roving stop) — a keeper, analogous to `PanelSet.refresh()`. Disabling an
*existing* tab already works (`setTabState`). Sequential Prev/Next wizards (like the
current demo) don't involve PanelControl at all, so they never need this.

## Two library changes in panelset (KEEPERS — they stay in PanelSet on extraction)
These are general PanelSet improvements for dynamic/windowed sets, not PF-specific:
1. **`refresh()` re-reflects verb-button ends.** Extracted `_reflectEnds()`, now called
   by `refresh()` (hence `addPanel`/`removePanel`) as well as init — so a windowed flow
   keeps Prev/Next/Finish disabled-state correct as panels appear/disappear.
2. **Empty init is valid.** `PanelSet.init` on a set with zero panels no longer errors;
   it sets up the wrapper and is ready for `addPanel()` (active/pending assigned on the
   first add via `refresh()`). This is what lets a windowed flow init an empty set and
   materialise panels into it.

## Test-first plan (CW's), status
1. Contract ✓ 2. Resolver ✓ 3. Loader ✓ 4. History+window ✓ 5. Orchestrate via
PanelSet ✓ 6. Temporary docs demo (one branching flow, same JSON across **inline →
`fetch('flow.json')` → MSW-mocked**) ✓ — all six phases done; demo verified headlessly
in Chrome (all 3 columns q1→q2a→done→back, no errors) + Safari. The demo is
**declarative**: each set carries `data-panelflow-src` and mountFlow builds its loader
with `loaderFromSource`; it uses `new PanelSet(el)` (NOT `PanelSet.init(el)` — `init`
takes a selector/config). (Note: the demo's nav uses `mousedown` preventDefault +
commit-on-`input` to avoid a Safari "blur eats the first click" quirk on a step's
text field.) The branching page has a SECOND section ("The same flow, validated") — the
identical 3 columns with `data-pf-validate`, gating Continue on field-completeness via
app glue (see Validation section above). The inline JSON (`#pf-flow` script) and
`docs/public/panelflow/flow.json` are kept identical (q1 radio + q2a text field).

## Extraction checklist (when PF gets its own repo)
- Take `/panelflow` as-is; add a `package.json` + build (mirror panelset's vite + tsc +
  vite-plugin-dts) and a `vitest.config.ts` (the stub-styles plugin is only needed while
  importing the real PanelSet in tests — likely droppable once PanelSet is a dep).
- Depend on `panelset` (peer/dep). The controller already targets the public surface via
  `PanelSetLike`, so wiring is just passing a real `PanelSet` instance.
- Leave the two KEEPER changes in PanelSet.
- Move the docs (`docs/.../panelflow/` views + the engine demo asset + nav entries);
  flip demo imports from the `panelflow` Vite alias to the package name.
- Extract WHEN PF stops needing PanelControl/PanelSet API changes to do its job, or when
  you want to publish it.

## Don'ts (project rules)
- The panelset docs must NOT name/link PanelFlow until it's published (they say "a flow
  layer" generically). The PS/PC wizard demos stay hand-wired (teaching artifacts).
