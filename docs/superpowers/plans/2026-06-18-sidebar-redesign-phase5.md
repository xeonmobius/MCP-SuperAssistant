# Sidebar Redesign — Phase 5 (Token-Migration Polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Finish the "one source of truth for tokens" success criterion — migrate the remaining legacy `slate-*` / `bg-white` / `dark:bg-slate-*` surfaces on the **always-visible** redesigned components to Phase-0 tokens, and drop the documented dead code. No behavior changes; pure className swaps + dead-code removal. This is the final redesign phase.

**Architecture:** Direction-B tokens are defined in `shadowDom.ts` `generateLight/DarkThemeVariables` (foundation hotfix) and exposed as Tailwind utilities (`bg-surface`, `text-ink`, `text-muted`, `border-line`, `bg-ground`, `bg-off-soft`, `text-off`, `ok/con/off/err`, `rounded-card/pill`, `shadow-soft`). The legacy `slate-*` + `dark:slate-*` classes predate the redesign and rely on the old `#theme-variables` override system; replacing them with token utilities makes each surface flip correctly in both light + dark via the single token source. Scrollbar utilities (`scrollbar-thumb-slate-*`) are left as-is (cross-browser inconsistent, Firefox ignores most).

**Tech Stack:** React 18, TypeScript, Tailwind (content-scoped). No new deps. No logic changes.

---

## Scope

**IN** (always-visible redesigned surfaces):
- `Sidebar.tsx` — header (post-branding-removal), Push-Content-Mode card, misc primary surfaces. Drop stale comments.
- `AvailableTools.tsx` — group-header block + leaf-row containers (className only; preserve the indeterminate `ref` logic untouched). Drop the dead `handleExecute`.
- `InputArea.tsx` — the textarea.

**OUT (documented Non-Goals):**
- `InstructionManager.tsx` (23 `slate-*` hits) — tucked inside MoreDrawer, explicitly relocated-as-is in Phase 3; a dedicated migration pass can follow if wanted.
- `Sidebar.tsx` → `SidebarShell` decomposition (935 LOC; structural refactor, not polish — deferred).
- Scrollbar utility migration (cross-browser; Firefox ignores most scrollbar styling).
- Subjective spacing/visual tweaking — needs the user's eyes (they're smoke-testing in Firefox); they can direct specific nits after this phase.

---

## Token-mapping cheat-sheet (apply per occurrence; `dark:*` variants DROP since the token flips)

| Legacy | Token utility |
|---|---|
| `bg-white`, `bg-slate-50`, `bg-slate-100` | `bg-surface` |
| `dark:bg-slate-800`, `dark:bg-slate-900` | (drop — `bg-surface` flips) |
| `bg-slate-200`, `bg-slate-300` (hover/secondary fills) | `bg-ground` |
| `hover:bg-slate-100`, `hover:bg-slate-200` | `hover:bg-ground` |
| `text-slate-900`, `text-slate-800` | `text-ink` |
| `text-slate-700`, `text-slate-600`, `text-slate-500`, `text-slate-400` | `text-muted` |
| `text-slate-300`, `text-slate-200` | `text-off` |
| `border-slate-200`, `border-slate-300` | `border-line` |
| `dark:border-slate-700`, `dark:border-slate-600` | (drop — `border-line` flips) |
| `indigo-*` (accents on toggles/icons) | keep OR `accent-from` (use judgment; keep indigo if it's a deliberate non-token accent) |
| `dark:text-slate-*`, `dark:hover:bg-slate-*` | (drop the `dark:` variant, apply the light mapping; token flips) |
| Semantic state colors (`bg-green-*`, `bg-red-*`, `bg-blue-*`, `bg-yellow-*` for status badges) | map to `ok`/`err`/`con`/`off` + `-soft` where it's a status; otherwise leave |

**Rules:** preserve every structural class (`flex`, `gap-*`, `p-*`, `rounded-*`, `space-*`, `items-*`, `w-*`/`h-*`, `transition-*`, `duration-*`, `font-*`, `truncate`, `min-h-*`, `max-h-*`, etc.). Only swap color/bg/border classes. Keep all `ref=`, `onClick`, conditional logic, and `cn(...)` calls intact. After each file: `rg "slate-\|bg-white\|dark:bg-\|dark:text-slate\|dark:border-slate"` in that file should drop sharply (scrollbars excepted).

---

## Task 1: Sidebar.tsx — primary surfaces + stale comments

**Files:** `pages/content/src/components/sidebar/Sidebar.tsx`

- [ ] **Step 1:** Read the file. Locate the legacy surfaces: the header (`bg-white dark:bg-slate-800 border-slate-*`, ~`:666`), the Push-Content-Mode `<Card>` (`border-slate-200 dark:border-slate-700 dark:bg-slate-800`, ~`:802`), the pane wrappers' scrollbars (`scrollbar-thumb-slate-*` — LEAVE), and any other `slate-*`/`bg-white` on primary surfaces.

- [ ] **Step 2: Migrate the header.** The header div (post-branding-removal) `bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 ...` → `bg-surface border-b border-line ...` (drop the `dark:*` variants). The toggles' `hover:bg-slate-100 dark:hover:bg-slate-700` → `hover:bg-ground`; icon `text-indigo-600 dark:text-indigo-400` may stay (deliberate accent) or move to `text-accent-from` — keep indigo for minimal risk.

- [ ] **Step 3: Migrate the Push-Content-Mode Card.** `<Card className="sidebar-card border-slate-200 dark:border-slate-700 dark:bg-slate-800 ...">` → replace the color classes with tokens (`border-line`, `bg-surface`); keep `sidebar-card`, structural, and shadow classes. Any text inside on `text-slate-*` → `text-ink`/`text-muted`.

- [ ] **Step 4: Sweep remaining `slate-*`/`bg-white`** on primary surfaces in this file (e.g. `sidebar-inner-content` `bg-white dark:bg-slate-900` → `bg-surface`; the outer sidebar frame if it has `bg-white dark:bg-slate-800`). Leave `scrollbar-thumb-slate-*` (scrollbars are out of scope).

- [ ] **Step 5: Remove stale comments** — the `{/* Tabs for Tools/Instructions */}` comment (~`:844`, now inaccurate — tabs are Tools/Skills/Settings) and any other clearly-stale comments you introduced-aware of. Don't remove comments that are still accurate.

- [ ] **Step 6:** `pnpm type-check` (zero new) + `pnpm build` + `pnpm vitest run pages/content/__tests__ --reporter=dot` (55 pass).

- [ ] **Step 7:** Commit
```bash
git add pages/content/src/components/sidebar/Sidebar.tsx
git commit -m "style(sidebar): migrate Sidebar primary surfaces to tokens — phase 5

Header (post-branding), Push-Content-Mode card, sidebar frame: slate-*/bg-white
-> bg-surface/text-ink/text-muted/border-line (drop dark: variants, tokens flip).
Stale 'Tabs for Tools/Instructions' comment removed. Scrollbars left (cross-browser)."
```

---

## Task 2: AvailableTools.tsx — group headers + leaf containers + dead code

**Files:** `pages/content/src/components/sidebar/AvailableTools/AvailableTools.tsx`

**CRITICAL:** the group-header block has fragile indeterminate-checkbox logic (`ref={el => { if (el) el.indeterminate = ... }}` and the `isGroupEnabled`/`isGroupPartiallyEnabled` checks). **Only change classNames. Do NOT touch `ref=`, `indeterminate`, the `isGroup*` functions, or any conditional logic.** If a className swap feels entangled with logic, leave that class and note it.

- [ ] **Step 1:** Read the file. Locate: the group-header block (Partial/Disabled badges, server-prefix headers — `slate-*`/`blue-*`/`yellow-*`), the leaf-row containers (`bg-white dark:bg-slate-900` ~`:479, :516`), and the dead `handleExecute` (~`:166-169`).

- [ ] **Step 2: Migrate group-header classNames** per the cheat-sheet. Badge colors: `blue-*` (enabled/partial) → consider `ok`/`con`; `yellow-*` → `con`; neutral `slate-*` → `muted`/`off`/`line`. Use judgment; the goal is token-consistency, not a precise color match. Preserve all `ref=`/`indeterminate`/conditional logic verbatim.

- [ ] **Step 3: Migrate leaf-row containers** `bg-white dark:bg-slate-900` → `bg-surface` (drop `dark:`).

- [ ] **Step 4: Drop the dead `handleExecute`.** Remove the `handleExecute` function (~`:166-169`) — it's never invoked from JSX (confirmed in the Phase-2 review). If its removal leaves an unused import, remove that too.

- [ ] **Step 5:** `pnpm type-check` (zero new) + `pnpm build` + `pnpm vitest run pages/content/__tests__ --reporter=dot` (55 pass — behavior preserved). Pay attention to `tool-list.test.ts`.

- [ ] **Step 6:** Commit
```bash
git add pages/content/src/components/sidebar/AvailableTools/AvailableTools.tsx
git commit -m "style(sidebar): migrate AvailableTools surfaces to tokens — phase 5

Group-header block + leaf-row containers: slate-*/bg-white/blue-/yellow- ->
tokens (preserve indeterminate ref logic verbatim). Drop dead handleExecute.
Behavior unchanged; 55 tests green."
```

---

## Task 3: InputArea.tsx — textarea

**Files:** `pages/content/src/components/sidebar/InputArea/InputArea.tsx`

- [ ] **Step 1:** The textarea (~`:60`) has legacy `border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800`. Replace with `border-line bg-ground` (drop `dark:`). Keep `text-ink`/`placeholder:text-muted` if present, or add them. Keep structural (`min-h`, `resize-y`, `w-full`, etc.).

- [ ] **Step 2:** `pnpm type-check` + `pnpm build` + `pnpm vitest run pages/content/__tests__ --reporter=dot` (55 pass).

- [ ] **Step 3:** Commit
```bash
git add pages/content/src/components/sidebar/InputArea/InputArea.tsx
git commit -m "style(sidebar): migrate InputArea textarea to tokens — phase 5"
```

---

## Task 4: Final verify

- [ ] **Step 1:** `pnpm type-check` (baseline ~11, zero new). `pnpm vitest run pages/content/__tests__ --reporter=dot` — 55 pass. `pnpm build` — green. `pnpm build:firefox` — green (so the user can re-smoke). `cd pages/content && pnpm lint` (no `--fix`) on the touched files.
- [ ] **Step 2:** `rg "slate-|bg-white|dark:bg-slate|dark:text-slate|dark:border-slate" pages/content/src/components/sidebar/Sidebar.tsx pages/content/src/components/sidebar/AvailableTools/AvailableTools.tsx pages/content/src/components/sidebar/InputArea/InputArea.tsx` — count should drop sharply from the recon baseline (Sidebar 17→few, AvailableTools 15→few, InputArea 1→0); remaining hits should be scrollbars only.
- [ ] **Step 3:** Manual smoke (user) — confirm light + dark mode look consistent across the header, Tools tab (incl. group headers), and the MoreDrawer's InputArea.

---

## Self-Review

**1. Spec coverage (Phase 5 slice):**
- "One source of truth for tokens" → the always-visible redesigned surfaces now fully on tokens; only InstructionManager (deferred) + scrollbars remain legacy. ✓ (with documented deferral)
- "Dark tokens" → already handled by the foundation hotfix; this phase makes surfaces actually USE them consistently. ✓
- "Spacing pass / empty-loading skeletons" → NON-GOAL here (needs the user's eyes; subjective). Documented.

**2. Risk:** Task 2 (AvailableTools group headers) is the only delicate part — the indeterminate `ref` logic. Mitigation: className-only swaps, logic untouched, 55-test regression gate. All other tasks are straightforward className swaps.

**3. No behavior change:** no `ref=`/`onClick`/conditional/`cn()` logic altered. 55 tests stay green.

**4. The redesign ends here:** Phases 0-4 + hotfix + smoke fixes + this polish phase. Remaining (InstructionManager token migration, SidebarShell decomposition) are documented follow-ups, not blockers.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-06-18-sidebar-redesign-phase5.md`. 3 implementation tasks (one per file) + verify. Single implementer dispatch covering Tasks 1-3 is fine (all className swaps + dead-code, low-risk, 55-test gate). Proceed subagent-driven on `feat/sidebar-redesign-phase5`?
