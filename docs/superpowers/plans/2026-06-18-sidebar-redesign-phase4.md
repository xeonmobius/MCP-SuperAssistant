# Sidebar Redesign — Phase 4 (Motion Pass) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the "feels alive" motion layer the user flagged missing — state-change cross-fades, hover feedback, and smooth expand — CSS-first, no new dependencies. Respect `prefers-reduced-motion` (guard already in place via the foundation hotfix).

**Architecture:** One shared setup (keyframes + helper classes in the `shadowDom.ts` theme generators — the direct-injection path, because `@keyframes` in the Tailwind-compiled CSS would be mangled by the `:host`-prefix transform), then surgical class additions to three components. No Framer Motion (CSS handles all of it). MoreDrawer is already animated (Phase 3); SidebarNav already transitions; list-stagger and a sliding pill indicator are deliberately **out of scope** (YAGNI — low value, high complexity).

**Tech Stack:** React 18, TypeScript, Tailwind (utilities survive the transform; only `@keyframes` needs the generator path). Reduced-motion guard: `shadowDom.ts` `@media (prefers-reduced-motion: reduce) { :host * { transition/animation: none !important } }` already covers everything.

---

## Scope (what's in / what's out)

**IN:**
- Shared `@keyframes sidebar-fade-in` + `sidebar-slide-up` + helper classes (in both generators).
- ConnectionBadge: key the status row by `state.variant` so it remounts + enter-fades on state change; add card hover elevation.
- ResourceRow: row hover background; expand-detail fade-in.
- ConnectionError: fade-in on appearance.

**OUT (documented Non-Goals):**
- List stagger on filter/swap (complex, low value).
- SidebarNav sliding active indicator (complex; current `transition-colors` is good).
- Framer Motion (CSS covers everything; FM is the documented upgrade path IF exit-animations are later required — CSS can't animate element exit on unmount).
- Hover elevation on the large AvailableTools/AvailableSkills cards (too much surface; kept for the small ConnectionBadge card + rows only).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `pages/content/src/utils/shadowDom.ts` | **Modify** | Add `@keyframes sidebar-fade-in`/`sidebar-slide-up` + `.sidebar-fade-in`/`.sidebar-slide-up` helper classes to both `generateLightThemeVariables()` and `generateDarkThemeVariables()` (theme-agnostic, identical) |
| `pages/content/src/components/sidebar/ServerStatus/ConnectionBadge.tsx` | **Modify** | Key the status row by `state.variant`; add `sidebar-fade-in` to it; add hover elevation (`transition-shadow hover:shadow-md`) to the card |
| `pages/content/src/components/sidebar/ServerStatus/ConnectionError.tsx` | **Modify** | Add `sidebar-slide-up` to the root |
| `pages/content/src/components/sidebar/ui/ResourceRow.tsx` | **Modify** | Add row hover bg (`hover:bg-ground transition-colors`); add `sidebar-fade-in` to the expanded detail container |

---

## Task 1: Add keyframes + helper classes to the generators

**Files:**
- Modify: `pages/content/src/utils/shadowDom.ts`

- [ ] **Step 1:** In BOTH `generateLightThemeVariables()` and `generateDarkThemeVariables()`, immediately AFTER the existing `@media (prefers-reduced-motion: reduce) { :host * { ... } }` block (and before the closing backtick), add this identical block (theme-agnostic — same in both):

```css

    /* Sidebar redesign motion — enter animations (theme-agnostic).
       Reduced-motion guard above suppresses these automatically. */
    @keyframes sidebar-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes sidebar-slide-up {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    :host .sidebar-fade-in {
      animation: sidebar-fade-in 180ms ease-out;
    }
    :host .sidebar-slide-up {
      animation: sidebar-slide-up 180ms ease-out;
    }
```

(Using `:host .sidebar-fade-in` — which is how the direct-injection path writes it — so it matches descendants carrying the class. The reduced-motion `:host *` guard already nullifies `animation` so no extra guard is needed on these classes.)

- [ ] **Step 2:** `pnpm type-check` (zero new) + `pnpm build` (completes).

- [ ] **Step 3:** Commit
```bash
git add pages/content/src/utils/shadowDom.ts
git commit -m "feat(sidebar): add sidebar-fade-in/slide-up keyframes — phase 4

Enter-animation keyframes + helper classes in the theme generators (direct-
injection path; @keyframes can't go in Tailwind CSS — the shadow-DOM transform
mangles them). Reduced-motion guard already suppresses animation via :host *."
```

---

## Task 2: Motion on ConnectionBadge + ConnectionError

**Files:**
- Modify: `pages/content/src/components/sidebar/ServerStatus/ConnectionBadge.tsx`
- Modify: `pages/content/src/components/sidebar/ServerStatus/ConnectionError.tsx`

- [ ] **Step 1: ConnectionBadge — key the status row + card hover.** Read the file. The status row is the `<div className="flex items-center gap-2">…</div>` containing the dot/spinner/label/button. Add a `key={state.variant}` to it so React remounts it when the variant changes (connected→connecting→error), and add the `sidebar-fade-in` class. Also add hover elevation to the outer card. Concretely:

  - Outer card div: change `className="rounded-card bg-surface p-2.5 shadow-soft"` → add `transition-shadow duration-150 hover:shadow-md`.
  - Status row div: change `className="flex items-center gap-2" aria-live="polite"` → `<div key={state.variant} className="flex items-center gap-2 sidebar-fade-in" aria-live="polite">`.

  Leave the error expand (`{state.expandError && error ? <ConnectionError .../> : null}`) and everything else unchanged.

- [ ] **Step 2: ConnectionError — slide-up on appearance.** Read the file. The root is `<div className="mt-2 rounded-card bg-err-soft p-2">`. Add `sidebar-slide-up`: `<div className="sidebar-slide-up mt-2 rounded-card bg-err-soft p-2">`.

- [ ] **Step 3:** `pnpm type-check` (zero new) + `pnpm build` + `pnpm vitest run pages/content/__tests__ --reporter=dot` (55 pass — no behavior change).

- [ ] **Step 4:** Commit
```bash
git add pages/content/src/components/sidebar/ServerStatus/ConnectionBadge.tsx pages/content/src/components/sidebar/ServerStatus/ConnectionError.tsx
git commit -m "feat(sidebar): motion on ConnectionBadge + ConnectionError — phase 4

- ConnectionBadge: key status row by variant -> enter-fade on state change
  (connected/connecting/reconnecting/disconnected/error); card hover elevation
- ConnectionError: slide-up on appearance (was instant pop-in)
- aria-live=polite preserved for SR announcements"
```

---

## Task 3: Motion on ResourceRow

**Files:**
- Modify: `pages/content/src/components/sidebar/ui/ResourceRow.tsx`

- [ ] **Step 1: Row hover bg + expand fade-in.** Read the file. The row container is `<div className={cn('rounded-row', !isEnabled && 'opacity-60')}>`. Add hover bg + transition: `cn('rounded-row transition-colors hover:bg-ground', !isEnabled && 'opacity-60')`. The expand detail container is `<div className="pb-2 pl-7 text-[11px] leading-snug text-muted">` — add `sidebar-fade-in` to it.

- [ ] **Step 2:** `pnpm type-check` (zero new) + `pnpm build` + `pnpm vitest run pages/content/__tests__ --reporter=dot` (55 pass).

- [ ] **Step 3:** Commit
```bash
git add pages/content/src/components/sidebar/ui/ResourceRow.tsx
git commit -m "feat(sidebar): motion on ResourceRow — phase 4

- Row hover bg (transition-colors hover:bg-ground) for pointer feedback
- Expand-detail fade-in (sidebar-fade-in) instead of instant appear"
```

---

## Task 4: Final verify + manual smoke

- [ ] **Step 1: Full gate**
`pnpm type-check` (baseline ~11, zero new). `pnpm vitest run pages/content/__tests__ --reporter=dot` — 55 pass. `pnpm build` — green. `cd pages/content && pnpm lint` (no `--fix`) — no new errors in the touched files.

- [ ] **Step 2: Manual smoke (load unpacked extension)** — this doubles as the long-pending visual confirmation of Phases 0-3 + the foundation hotfix:
  - Light mode: cards render with token backgrounds (foundation fix confirmed), ConnectionBadge hover lifts the card, rows highlight on hover, expanding a row fades the detail in.
  - Connection state change (stop/start the MCP server): the badge status row fades between states (not a hard cut).
  - Error state: ConnectionError slides up into view.
  - MoreDrawer: opens/closes smoothly (Phase 3, still working).
  - Toggle theme → motion + tokens both swap.
  - **`prefers-reduced-motion` (OS setting) → ALL animations instant** (badge, drawer, rows, error) — the `:host *` guard.

---

## Self-Review

**1. Spec coverage (Phase 4 slice):**
- "Connection states cross-fade" → keyed-by-variant enter-fade (Task 2). ✓ (enter-fade via CSS; exit-fade needs FM — documented upgrade path)
- "More drawer animates" → already done (Phase 3). ✓
- "Toggles: CSS transition" → ResourceRow hover (Task 3); the checkbox accent is already themed. ✓
- "Hover/focus: soft elevation" → card hover (Task 2) + row hover (Task 3). ✓
- "respect prefers-reduced-motion" → `:host *` guard from the hotfix (Task 1 keyframes are auto-suppressed). ✓
- List stagger: NON-GOAL (documented). Sliding pill indicator: NON-GOAL.

**2. Placeholder scan:** All edits are precise class additions / a `key` prop. No TBD. The exact keyframe CSS is given.

**3. Risk:** Task 1 touches `shadowDom.ts` (shared infra) but is purely additive (new keyframes + classes, doesn't touch existing vars/rules). Tasks 2-3 are class-string edits in components. The `key={state.variant}` remount is the one behavioral nuance — it remounts the status row on variant change (fine; the row is presentational, no internal state to lose). Reduced-motion users see no animation (guard). All CSS-first, zero new deps.

**4. The smoke is now essential:** it confirms both Phase 4 motion AND the foundation hotfix (light-mode rendering) in one pass.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-06-18-sidebar-redesign-phase4.md`. Small phase (4 tasks, 4 files). Single implementer dispatch for Tasks 1-3 + controller verify is fine (motion is low-risk class edits + additive keyframes). Proceed subagent-driven on `feat/sidebar-redesign-phase4`?
