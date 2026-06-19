# Sidebar Redesign — Phase 2 (Segmented Nav + Shared ResourceRow) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy underline tab nav with a Direction-B pill segmented control, promote Skills from inside the Tools pane to its own tab, and DRY the genuinely-shared leaf row into one token-styled `ResourceRow` used by both lists — while token-migrating both lists' primary surfaces for visual consistency with `ConnectionBadge`.

**Architecture:** Two new presentational components: `SidebarNav` (controlled pill segmented control — `activeTab` stays as local `useState` in `Sidebar.tsx:275`, intentionally not in the store per the existing comment) and `ResourceRow` (the toggle+expand leaf row, identical between tools and skills). `AvailableSkills` and `AvailableTools` adopt `ResourceRow` for their leaf rows and migrate their card/header surfaces to the Phase 0 tokens. No store changes, no behavior changes — pure presentational/IA refactor. The full parameterized `ResourceList` merge from the spec is **deferred** (see Spec Reconciliation).

**Tech Stack:** React 18, TypeScript, Tailwind (content-scoped, `important: true`), Zustand hooks (unchanged), Vitest (root, pure-function tests). Tokens from Phase 0 (`bg-surface`, `text-ink`, `text-muted`, `ok/con/off/err`, `rounded-card`/`rounded-pill`, `shadow-soft`, `accent-from`/`accent-to`).

---

## Spec Reconciliation (one deviation, flagged)

The spec (`docs/superpowers/specs/2026-06-18-sidebar-redesign-design.md`) said: "Tools & Skills share one component (`ResourceList` + `ResourceRow`) — they are nearly identical UIs today; DRY them."

**Recon proved the premise wrong.** `AvailableTools.tsx` (710 LOC) has 2-tier server-prefix grouping, a pending-changes batch (Save/Discard), search, sort, refresh, group-level indeterminate checkboxes, and is double-carded. `AvailableSkills.tsx` (143 LOC) is flat, no search, no grouping, toggles commit immediately. They are **not** nearly identical; only the **leaf row** (checkbox + chevron + name + expand-detail) is genuinely shared.

Forcing both into one parameterized `ResourceList` would need ≥5 boolean flags (`searchable`, `groupable`, `batched`, `refreshable`, `renderDetail`) — a code smell that serves two masters. Ponytail: don't build that. This plan instead extracts only the truly-shared `ResourceRow` and keeps each list's own logic. The full merge is a **Non-Goal** until a real second use-case for the parameterized list appears.

**Second deviation:** the approved mockup showed 3 pills (Tools/Skills/Settings). That is the **end state after Phase 3** (which moves Instructions into the "More" drawer). This phase ships **4 pills** (Tools/Skills/Instructions/Settings) so Instructions stays accessible — no feature goes missing mid-redesign. Phase 3 reduces it to 3.

---

## File Structure

| File | Action | Responsibility | Target LOC |
|---|---|---|---|
| `pages/content/src/components/sidebar/ui/ResourceRow.tsx` | **Create** | Shared leaf row: toggle + expand chevron + name + optional detail | ~70 |
| `pages/content/src/components/sidebar/ui/SidebarNav.tsx` | **Create** | Controlled pill segmented control (token-styled) | ~45 |
| `pages/content/src/components/sidebar/ui/index.ts` | **Modify** | Export `ResourceRow`, `SidebarNav` | +2 |
| `pages/content/src/components/sidebar/AvailableSkills/AvailableSkills.tsx` | **Modify** | Use `ResourceRow`, migrate surfaces to tokens, fix dead `zap` icon → `lightning` | ~143→~120 |
| `pages/content/src/components/sidebar/AvailableTools/AvailableTools.tsx` | **Modify** | Use `ResourceRow` for leaf rows, migrate primary surfaces to tokens, drop the outer double-`Card`, drop dead `useToolExecution()` destructure | 710→~600 |
| `pages/content/src/components/sidebar/Sidebar.tsx` | **Modify** | Replace underline nav (`:844-878`) with `<SidebarNav>`, add `'availableSkills'` to `activeTab` union (`:275`), move `<AvailableSkills>` from Tools pane (`:900`) to its own pane | ~30 lines changed |

**Out of scope (Non-Goals):** full parameterized `ResourceList` merge; relocating Instructions to More (Phase 3); relocating InputArea (Phase 3); theme/server-config in Settings; `Sidebar.tsx` decomposition into `SidebarShell` (deferred — it's 960 LOC but not blocking the visual win).

---

## Token cheat-sheet (from Phase 0, confirmed available)

Surfaces: `bg-ground` (page), `bg-surface` (cards), `text-ink`, `text-muted`, `border-line`, `shadow-soft`. Radii: `rounded-card` (12), `rounded-pill` (9999). Status: `bg-ok-soft text-ok`, `bg-con-soft text-con`, `bg-off-soft text-off`, `bg-err-soft text-err`. Active-pill accent: `bg-gradient-to-r from-accent-from to-accent-to text-surface` (or `bg-surface shadow-soft text-ink` for a quieter active state — pick `bg-surface shadow-soft` to match ConnectionBadge's restrained look; reserve the gradient for the single most-important CTA).

`ConnectionBadge.tsx` is the reference for the token vocabulary — match it.

---

## Task 1: Create `ResourceRow`

**Files:**
- Create: `pages/content/src/components/sidebar/ui/ResourceRow.tsx`
- Modify: `pages/content/src/components/sidebar/ui/index.ts` (add export)

- [ ] **Step 1: Write the component**

```tsx
// pages/content/src/components/sidebar/ui/ResourceRow.tsx
import React, { useState } from 'react';
import { cn } from '@src/lib/utils';
import { Icon } from './Icon';

interface ResourceRowProps {
  name: string;
  description?: string;
  isEnabled: boolean;
  onToggle: () => void;
  /** Optional extra detail rendered when expanded (e.g. a tool's schema block). */
  renderDetail?: () => React.ReactNode;
  /** Accessible label suffix for the toggle. */
  kindLabel?: string;
}

const ResourceRow: React.FC<ResourceRowProps> = ({
  name,
  description,
  isEnabled,
  onToggle,
  renderDetail,
  kindLabel = 'item',
}) => {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = Boolean(description || renderDetail);

  return (
    <div className={cn('rounded-row', !isEnabled && 'opacity-60')}>
      <div className="flex items-center gap-2 py-1.5">
        {hasDetail && (
          <button
            type="button"
            aria-label={expanded ? `Collapse ${name}` : `Expand ${name}`}
            aria-expanded={expanded}
            onClick={() => setExpanded((e) => !e)}
            className="text-muted hover:text-ink"
          >
            <Icon name="chevron-right" className={cn('transition-transform', expanded && 'rotate-90')} />
          </button>
        )}
        <input
          type="checkbox"
          checked={isEnabled}
          onChange={onToggle}
          aria-label={`Toggle ${kindLabel} ${name}`}
          className="h-3.5 w-3.5 accent-accent-from"
        />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">{name}</span>
        {!isEnabled && <span className="text-[10px] text-off">Disabled</span>}
      </div>
      {expanded && hasDetail && (
        <div className="pb-2 pl-7 text-[11px] leading-snug text-muted">
          {description || 'No description available.'}
          {renderDetail?.()}
        </div>
      )}
    </div>
  );
};

export default ResourceRow;
```

- [ ] **Step 2: Export from the barrel**

In `pages/content/src/components/sidebar/ui/index.ts`, add:
```ts
export { default as ResourceRow } from './ResourceRow';
```

- [ ] **Step 3: Verify the `Icon` name `chevron-right` exists**

Run: `rg "chevron-right|'chevron" pages/content/src/components/sidebar/ui/Icon.tsx`
Confirm `chevron-right` (or the exact name `AvailableTools.tsx` already uses for its chevron — check `AvailableTools.tsx` for the existing chevron `Icon name=...` and match it). If the existing code uses a different name (e.g. `chevron`), use that exact name instead. Do not invent an icon name.

- [ ] **Step 4: Type-check + build**

`pnpm type-check` (expect only the ~13 pre-existing baseline errors; zero in `ResourceRow.tsx`).
`pnpm build` — completes.

- [ ] **Step 5: Commit**

```bash
git add pages/content/src/components/sidebar/ui/ResourceRow.tsx pages/content/src/components/sidebar/ui/index.ts
git commit -m "feat(sidebar): add shared ResourceRow component — phase 2

Token-styled leaf row (toggle + expand + name + optional detail) shared by
AvailableTools and AvailableSkills. Presentational; expand state local.
Matches ConnectionBadge token vocabulary."
```

---

## Task 2: Create `SidebarNav`

**Files:**
- Create: `pages/content/src/components/sidebar/ui/SidebarNav.tsx`
- Modify: `pages/content/src/components/sidebar/ui/index.ts` (add export)

- [ ] **Step 1: Write the component**

```tsx
// pages/content/src/components/sidebar/ui/SidebarNav.tsx
import React from 'react';
import { cn } from '@src/lib/utils';

export interface NavTab {
  id: string;
  label: string;
}

interface SidebarNavProps {
  tabs: NavTab[];
  activeTab: string;
  onChange: (id: string) => void;
}

const SidebarNav: React.FC<SidebarNavProps> = ({ tabs, activeTab, onChange }) => {
  return (
    <div role="tablist" aria-label="Sidebar sections" className="flex gap-1 rounded-card bg-ground p-1">
      {tabs.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              'flex-1 rounded-pill px-2 py-1 text-[11px] font-semibold transition-colors',
              active ? 'bg-surface text-ink shadow-soft' : 'text-muted hover:text-ink',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};

export default SidebarNav;
```

- [ ] **Step 2: Export from the barrel**

Add to `pages/content/src/components/sidebar/ui/index.ts`:
```ts
export { default as SidebarNav } from './SidebarNav';
export type { NavTab } from './SidebarNav';
```

- [ ] **Step 3: Type-check + build**

`pnpm type-check` (zero new errors), `pnpm build` green.

- [ ] **Step 4: Commit**

```bash
git add pages/content/src/components/sidebar/ui/SidebarNav.tsx pages/content/src/components/sidebar/ui/index.ts
git commit -m "feat(sidebar): add SidebarNav pill segmented control — phase 2

Controlled pill nav (role=tablist) on bg-ground track, active pill bg-surface
+ shadow-soft. Replaces the legacy underline tab nav in Sidebar next."
```

---

## Task 3: Migrate `AvailableSkills` to tokens + `ResourceRow`

**Files:**
- Modify: `pages/content/src/components/sidebar/AvailableSkills/AvailableSkills.tsx`

- [ ] **Step 1: Read the current file fully** (`pages/content/src/components/sidebar/AvailableSkills/AvailableSkills.tsx`, 143 LOC). Note the existing `Icon name="zap"` usages (latent bug — `zap` isn't in the Icon union, renders `null`).

- [ ] **Step 2: Apply these changes**

1. **Import `ResourceRow`** from `../ui` (alongside existing `Typography`, `Icon`).
2. **Replace the per-skill row JSX** (the `.map` body that renders checkbox + chevron + name + expand) with `<ResourceRow>`:
   ```tsx
   <ResourceRow
     key={skill.name}
     name={skill.name}
     description={skill.description}
     isEnabled={isSkillEnabled(skill.name)}
     onToggle={() => handleToggleSkill(skill.name)}
     kindLabel="skill"
   />
   ```
   Remove the now-dead internal `expanded` state + chevron/checkbox JSX for rows (ResourceRow owns expand).
3. **Fix the header icon:** replace `<Icon name="zap">` with `<Icon name="lightning">` (confirm `lightning` exists in `Icon.tsx`; if not, use an existing name like `tools` or drop the icon). Run `rg "name:|'lightning'|'tools'|'box'" pages/content/src/components/sidebar/ui/Icon.tsx` to pick a real name.
4. **Migrate container surfaces to tokens:** the outer `<div>` and header — replace legacy `slate-*` / `dark:slate-*` / `border-slate-*` classes on the container + header with token equivalents: card backgrounds → `bg-surface`, text → `text-ink` / `text-muted`, borders → `border-line`, count pill → `bg-off-soft text-off`. Keep structural classes (flex, padding, divide-y) as-is.
5. Keep the Enable All / Disable All buttons; restyle to tokens (`bg-surface text-ink` ghost or `text-muted` links).
6. **Preserve all behavior:** `useSkillEnablement` hook usage unchanged, `handleToggleSkill` unchanged, empty-state message unchanged, collapse state unchanged.

- [ ] **Step 3: Type-check + build + tests**

`pnpm type-check` (zero new errors in `AvailableSkills.tsx`).
`pnpm build` green.
`pnpm vitest run pages/content/__tests__ --reporter=dot` — all 55 still pass (no behavior change).

- [ ] **Step 4: Commit**

```bash
git add pages/content/src/components/sidebar/AvailableSkills/AvailableSkills.tsx
git commit -m "refactor(sidebar): AvailableSkills on ResourceRow + tokens — phase 2

- Leaf rows use shared ResourceRow (token-styled, owns expand state)
- Surfaces migrated to tokens (bg-surface, text-ink/muted, border-line)
- Fix latent bug: Icon name='zap' (rendered null) -> 'lightning'
- Behavior unchanged: hook, handleToggleSkill, empty state preserved"
```

---

## Task 4: Migrate `AvailableTools` leaf rows to `ResourceRow` + fix double-card + drop dead code

**Files:**
- Modify: `pages/content/src/components/sidebar/AvailableTools/AvailableTools.tsx` (710 LOC)

This is the largest edit. **Work carefully, preserve ALL Tools behavior** (search, 2-tier grouping, batch Save/Discard, Enable All/Disable All, refresh, group indeterminate checkboxes, loading, empty states). Only the **leaf tool rows** and the **container cards** change.

- [ ] **Step 1: Read the file fully.** Identify:
  - The two leaf-row render blocks: grouped-variant rows (~`:471-571`) and ungrouped "Individual Tools" rows (~`:592-697`). Both render `chevron + checkbox + name + (expand: description + schema <pre>)`.
  - The outer `<Card>` at `:248` AND note that `Sidebar.tsx:889` wraps `<AvailableTools>` in ANOTHER `<Card>` — double-carded.
  - The dead `useToolExecution()` destructure at `:30` (executions/isExecuting never read in render).

- [ ] **Step 2: Drop dead code**
  Remove `const { executions, isExecuting } = useToolExecution();` (line ~`:30`) and the `useToolExecution` import if now unused. Leave the `onExecute` prop in the interface (Sidebar still passes it; removing the prop is a Sidebar-side change beyond this task's scope — just stop destructuring the dead hook).

- [ ] **Step 3: Replace BOTH leaf-row blocks with `<ResourceRow>`**
  For each tool row (grouped and ungrouped), replace the chevron+checkbox+name+expand JSX with:
  ```tsx
  <ResourceRow
    key={tool.name}
    name={tool.displayName || tool.name}
    description={tool.description}
    isEnabled={isToolEnabled(tool.name)}
    onToggle={() => handleToggleTool(tool.name)}
    kindLabel="tool"
    renderDetail={
      tool.schema || tool.input_schema
        ? () => (
            <pre className="mt-1 overflow-x-auto rounded-row bg-ground p-1.5 text-[10px] text-muted">
              {JSON.stringify(tool.schema || tool.input_schema, null, 2)}
            </pre>
          )
        : undefined
    }
  />
  ```
  Keep the **group header rows** (collapsible server-prefix headers with group checkbox + indeterminate + Partial/Disabled badges) exactly as-is — those are Tools-specific, NOT ResourceRow.

- [ ] **Step 4: Fix the double-card**
  The component renders its own outer `<Card>` (`:248`). Sidebar ALSO wraps it in a `<Card>` (`Sidebar.tsx:889`). Remove the **inner** `<Card>`/`<CardHeader>`/`<CardContent>` wrapper here (or convert to a plain `<div className="rounded-card bg-surface shadow-soft">`). Task 5 will remove the outer Sidebar `<Card>`. Pick ONE home for the card — recommend keeping the card here (the component owns its surface), and Task 5 removes Sidebar's wrapper.
  If removing shadcn `Card` here, migrate the header/content surfaces to tokens: `bg-surface`, `text-ink`/`text-muted`, `border-line`, `rounded-card`, `shadow-soft`. Migrate other primary `slate-*` surfaces in the header/search/empty-state to tokens. You do NOT need to chase every legacy class — get the card, header, search input, and empty states token-consistent.

- [ ] **Step 5: Type-check + build + tests**

`pnpm type-check` (zero new errors in `AvailableTools.tsx`).
`pnpm build` green.
`pnpm vitest run pages/content/__tests__ --reporter=dot` — all 55 pass (behavior preserved). Pay attention to `tool-list.test.ts` and `skill-enablement.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add pages/content/src/components/sidebar/AvailableTools/AvailableTools.tsx
git commit -m "refactor(sidebar): AvailableTools leaf rows on ResourceRow + tokens — phase 2

- Leaf tool rows (grouped + ungrouped) use shared ResourceRow; schema via renderDetail
- Drop dead useToolExecution() destructure
- Own its single Card (fix double-card with Sidebar wrapper, removed in next task)
- Primary surfaces migrated to tokens; all Tools behavior preserved
  (search, 2-tier grouping, batch Save/Discard, bulk toggle, refresh, group indeterminate)"
```

---

## Task 5: Wire `SidebarNav` into Sidebar + promote Skills to its own tab

**Files:**
- Modify: `pages/content/src/components/sidebar/Sidebar.tsx`

- [ ] **Step 1: Extend the `activeTab` union** (line ~`:275`)

From:
```ts
const [activeTab, setActiveTab] = useState<'availableTools' | 'instructions' | 'settings'>('availableTools');
```
To:
```ts
const [activeTab, setActiveTab] = useState<'availableTools' | 'availableSkills' | 'instructions' | 'settings'>('availableTools');
```

- [ ] **Step 2: Import `SidebarNav`** (and `NavTab` type if useful):
```ts
import { SidebarNav } from './ui';
```
(Add to the existing `./ui` import line — `Typography, Toggle, ..., SidebarNav`.)

- [ ] **Step 3: Replace the underline nav block** (`:844-878`, the `<div border-b>…3 buttons…</div>`) with:
```tsx
<SidebarNav
  tabs={[
    { id: 'availableTools', label: 'Tools' },
    { id: 'availableSkills', label: 'Skills' },
    { id: 'instructions', label: 'Instructions' },
    { id: 'settings', label: 'Settings' },
  ]}
  activeTab={activeTab}
  onChange={(id) => setActiveTab(id as typeof activeTab)}
/>
```
Place it in the SAME position the old nav block occupied (after the Push-Content-Mode Card, before the tab-content area).

- [ ] **Step 4: Remove the outer `<Card>` wrapping `<AvailableTools>`** (`:889`) — the component now owns its own card (Task 4). Change `<Card><AvailableTools .../></Card>` → `<AvailableTools .../>`. Also remove the `<Card>` wrapping `<AvailableSkills>` (`:900`) for consistency if it has one.

- [ ] **Step 5: Move `<AvailableSkills>` out of the Tools pane into its own pane**
  Currently (`:900-904`) `<AvailableSkills />` renders inside the `activeTab==='availableTools'` pane. Move it to a NEW pane:
```tsx
<div hidden={activeTab !== 'availableSkills'}>
  <AvailableSkills />
</div>
```
Place this new pane alongside the others (Tools pane `:884`, Instructions pane `:908`, Settings pane `:921`). Remove `<AvailableSkills />` from the Tools pane.

- [ ] **Step 6: Type-check + build + tests**

`pnpm type-check` — zero new errors (watch for an unused-import warning if you removed the old nav's helpers).
`pnpm build` green.
`pnpm vitest run pages/content/__tests__ --reporter=dot` — all 55 pass.

- [ ] **Step 7: Commit**

```bash
git add pages/content/src/components/sidebar/Sidebar.tsx
git commit -m "feat(sidebar): pill SidebarNav + Skills as own tab — phase 2

- Replace underline tab nav (:844-878) with SidebarNav pill segmented control
- Promote AvailableSkills from inside Tools pane to its own tab
- activeTab union += 'availableSkills'; 4 tabs (Tools/Skills/Instructions/Settings)
- Remove double-Card wrappers around AvailableTools/AvailableSkills
- Instructions stays a tab (moves to More drawer in Phase 3 -> reduces to 3 pills)"
```

---

## Task 6: Final verify + manual smoke

- [ ] **Step 1: Full regression**

`pnpm type-check` (baseline ~13 errors, zero new).
`pnpm vitest run pages/content/__tests__ --reporter=dot` — 55 pass.
`pnpm build` — green.
`cd pages/content && pnpm lint` (no `--fix`) on the touched files — no NEW errors.

- [ ] **Step 2: Manual smoke (load unpacked extension)**
  - Sidebar opens; pill nav shows 4 tabs (Tools/Skills/Instructions/Settings), Tools active.
  - Click each pill → correct pane shows; Skills pane shows the skills list (no longer under Tools).
  - Toggle a tool and a skill → ResourceRow checkbox flips, "Disabled" label appears/disappears, expand chevron reveals description (+ schema for tools).
  - Search still works in Tools; group headers still collapse; Save/Discard still works.
  - Theme toggle → tokens swap (both lists legible in dark mode).

- [ ] **Step 3: Report** (no commit unless something changed)

---

## Self-Review

**1. Spec coverage (Phase 2 slice):**
- "Segmented pill nav" → SidebarNav (Task 2) wired in Sidebar (Task 5). ✓
- "Tools/Skills/Settings primary" → 4 pills this phase (Tools/Skills/Instructions/Settings); Instructions→More in Phase 3 reduces to 3. Documented deviation. ✓ (with stated reason)
- "Tools & Skills share one component" → reconciled to shared `ResourceRow` (the genuinely-identical part); full `ResourceList` merge deferred (Non-Goal). Documented. ✓
- "Keep plumbing untouched" → no store/hook/adapter changes; `activeTab` stays local per existing comment. ✓
- "Every target file ≤ 250 LOC" → SidebarNav ~45, ResourceRow ~70. AvailableTools shrinks 710→~600 (still over 250 — pre-existing; this phase reduces it, doesn't fix it; SidebarShell decomposition deferred). Note this honestly.
- "Bundle size does not increase" → no new deps; ResourceRow/SidebarNav are tiny. ✓
- "One source of truth for tokens" → both lists migrated to Phase 0 tokens. ✓

**2. Placeholder scan:** Tasks 3/4/5 use precise edit instructions with line refs + the recon findings (not "fix the styling"). The icon-name choice has an explicit verify step (don't invent). No TBD/TODO.

**3. Type consistency:** `activeTab` union extended consistently (Task 5 Step 1 + Step 3 `as typeof activeTab`). `ResourceRow` props match between definition (Task 1) and both consumers (Tasks 3, 4: `name`, `description`, `isEnabled`, `onToggle`, `kindLabel`, `renderDetail`). `SidebarNav` props (`tabs`, `activeTab`, `onChange`) match definition (Task 2) and usage (Task 5). `NavTab.id` is `string`; `onChange` receives `string`, cast to the union at the call site.

**4. Known risk:** Task 4 (AvailableTools, 710 LOC) is the biggest edit — preserve behavior via the 55-test regression gate + manual smoke. If a Tools behavior regresses, that's the place to look first.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-18-sidebar-redesign-phase2.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review, fast iteration. (Matches Phase 0/1.)

**2. Inline Execution** — batch in this session with checkpoints.

Which approach?
