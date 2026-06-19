# Sidebar Redesign — Phase 3 (MoreDrawer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tuck **InputArea** + **InstructionManager** behind a new animated `<MoreDrawer>` at the sidebar's bottom, remove the **Instructions** pill (→ 3 pills: Tools/Skills/Settings — the approved mockup's end state), and clean up the dormant InputArea code.

**Architecture:** One new component (`MoreDrawer`) — a CSS-animated bottom drawer using the `grid-template-rows: 0fr→1fr` trick (no JS height measurement, no React unmount). It renders InputArea + InstructionManager **once** and toggles their visibility via the grid collapse — critical because InstructionManager owns a module-level `instructionsState` singleton + 500ms poll that must keep running (unmounting breaks `MCPPopover`). Sidebar wires it in at the bottom (the dormant InputArea slot), provides an `onSubmitInput` callback (adapter.insertTextIntoInput → triggerSubmission), drops the Instructions tab + pane, and deletes the dormant comment block + dead state/handler/import.

**Tech Stack:** React 18, TypeScript, Tailwind (content-scoped), Zustand hooks (unchanged). Phase 0 tokens (`bg-ground`, `bg-surface`, `text-ink`, `text-muted`, `border-line`, `shadow-soft`, `rounded-card`, `rounded-pill`). Icons `chevron-down` + `menu` confirmed in the Icon union.

---

## Spec Reconciliation (two deviations, both forced by recon — flagged)

1. **"Slim InstructionManager to InstructionList ~110 LOC" → DROPPED.** Recon proved InstructionManager is **not** a list of toggleable items — it's two text panels (auto-generated instructions string + custom-instructions string with enable/edit). Slimming to 110 LOC would mean deleting the custom-instructions feature (a regression). It's 505 LOC of dense pub/sub statefulness that works correctly wherever mounted. Relocate as-is; do not rewrite. (Full decomposition is a separate, optional cleanup.)

2. **"Relocate InputArea" → RESURRECT.** InputArea is **dormant** (commented out at `Sidebar.tsx:906-927`; import at `:9`, `isInputMinimized` at `:278`, `toggleInputMinimize` at `:514` all dead). Phase 3 revives it into the drawer with proper onSubmit wiring. **Flag for the user:** this re-enables a feature that's currently turned off. If you'd rather keep InputArea disabled, skip Task 3 and the drawer holds only Instructions (say so at plan review).

**Non-Goals:** rewriting InputArea→InputComposer / InstructionManager→InstructionList (above); `Sidebar.tsx` decomposition into `SidebarShell` (deferred — 935 LOC, not blocking); Phase 4 motion polish (this phase adds the one drawer animation only); Phase 5 dark/spacing polish.

---

## File Structure

| File | Action | Responsibility | Target LOC |
|---|---|---|---|
| `pages/content/src/components/sidebar/MoreDrawer/MoreDrawer.tsx` | **Create** | Animated bottom drawer (grid-rows), owns open/close, renders InputArea + InstructionManager once | ~75 |
| `pages/content/src/components/sidebar/InputArea/InputArea.tsx` | **Modify** | Strip the redundant `<Card>`/"Input Area" header (drawer provides the surface); keep the form. Drop vestigial `onToggleMinimize` from the interface (unused — header button was commented out) | 99→~70 |
| `pages/content/src/components/sidebar/Sidebar.tsx` | **Modify** | Add `handleInputSubmit` (adapter wiring); mount `<MoreDrawer>` at the bottom; remove the Instructions pill + pane; delete dormant comment block + `isInputMinimized` + `toggleInputMinimize` + dead InputArea import | ~30 lines net |

`InstructionManager.tsx` is **untouched** (relocated via props, not edited). `MoreDrawer` gets a new folder (matches the `ServerStatus/`/`AvailableSkills/` convention).

---

## Task 1: Create `MoreDrawer`

**Files:**
- Create: `pages/content/src/components/sidebar/MoreDrawer/MoreDrawer.tsx`

- [ ] **Step 1: Write the component**

```tsx
// pages/content/src/components/sidebar/MoreDrawer/MoreDrawer.tsx
import React, { useState } from 'react';
import { cn } from '@src/lib/utils';
import { Icon } from '../ui';
import InputArea from '../InputArea/InputArea';
import InstructionManager from '../Instructions/InstructionManager';

interface MoreDrawerProps {
  /** Called when the user submits the input textarea. */
  onSubmitInput: (text: string) => void;
  /** Legacy adapter object passed through to InstructionManager. */
  adapter: any;
  /** Formatted tools list passed through to InstructionManager. */
  tools: Array<{ name: string; schema: string; description: string }>;
}

const MoreDrawer: React.FC<MoreDrawerProps> = ({ onSubmitInput, adapter, tools }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex-shrink-0 border-t border-line bg-ground">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="more-drawer-content"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-off-soft"
      >
        <Icon
          name="chevron-down"
          className={cn('text-muted transition-transform duration-200', open && 'rotate-180')}
        />
        <span className="text-[11px] font-semibold text-ink">More</span>
        <span className="ml-auto text-[10px] text-muted">Input &amp; Instructions</span>
      </button>

      {/* ponytail: grid-rows 0fr->1fr animates height without JS measurement and
          WITHOUT unmounting children — InstructionManager must stay mounted
          (instructionsState singleton + 500ms poll feed MCPPopover). */}
      <div
        id="more-drawer-content"
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="max-h-[50vh] space-y-3 overflow-y-auto px-4 pb-4 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-600">
            <section>
              <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Insert into chat
              </h4>
              <InputArea onSubmit={onSubmitInput} />
            </section>
            <section>
              <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Instructions
              </h4>
              <InstructionManager adapter={adapter} tools={tools} />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MoreDrawer;
```

- [ ] **Step 2: Type-check + build**

`pnpm type-check` — zero errors in `MoreDrawer.tsx` (baseline ~11 elsewhere). If `adapter: any` triggers the `no-explicit-any` lint rule, leave it — `InstructionManager.tsx:69` already declares `adapter: any` (pre-existing pattern), so matching it is consistent. (Don't add eslint-disable comments.)
`pnpm build` — completes.

- [ ] **Step 3: Commit**

```bash
git add pages/content/src/components/sidebar/MoreDrawer/MoreDrawer.tsx
git commit -m "feat(sidebar): add MoreDrawer (animated bottom drawer) — phase 3

CSS grid-template-rows 0fr->1fr height animation (no JS measurement).
Renders InputArea + InstructionManager once, toggles visibility via the
grid collapse — InstructionManager stays mounted (instructionsState
singleton + 500ms poll must keep running for MCPPopover). ponytail:
never unmount-on-collapse."
```

---

## Task 2: Adapt `InputArea` to be drawer-friendly

**Files:**
- Modify: `pages/content/src/components/sidebar/InputArea/InputArea.tsx`

- [ ] **Step 1: Read the current file** (99 LOC). It renders `<Card><CardHeader>"Input Area" + Icon menu</CardHeader><CardContent><form>textarea + submit Button</form></CardContent></Card>`. The header button (minimize) is commented out.

- [ ] **Step 2: Strip the Card wrapper, keep the form; drop `onToggleMinimize` from the interface**

The new interface (drop the vestigial `onToggleMinimize` — its only consumer was the commented-out header button):
```ts
interface InputAreaProps {
  onSubmit: (text: string) => void;
}
```

Replace the outer `<Card>/<CardHeader>/<CardContent>` wrappers with a plain `<div className="rounded-card border border-line bg-surface shadow-soft p-3">`. **Keep the entire `<form>` + `<textarea>` + submit `<Button>` + `handleKeyDown` + `handleSubmit` logic unchanged.** Remove the now-unused `Card`/`CardHeader`/`CardContent` imports (confirm they're not used elsewhere in the file first) and the `Icon` import if the only `Icon` was the header `menu` icon (now removed).

Result shape:
```tsx
<div className="rounded-card border border-line bg-surface shadow-soft p-3">
  <form onSubmit={handleSubmit}>
    <textarea ... />  {/* unchanged */}
    <Button ... />    {/* unchanged */}
  </form>
</div>
```

Preserve all behavior: `handleKeyDown` (Enter=submit / Shift+Enter=newline), `handleSubmit` (wrap as `<user>\n${text}\n</user>`, 300ms await, onSubmit, 100ms await, clear), the `isSubmitting` spinner state.

- [ ] **Step 3: Type-check + build**

`pnpm type-check` — zero errors in `InputArea.tsx`.
`pnpm build` — completes.

- [ ] **Step 4: Commit**

```bash
git add pages/content/src/components/sidebar/InputArea/InputArea.tsx
git commit -m "refactor(sidebar): InputArea drawer-friendly — phase 3

- Strip redundant Card/'Input Area' header (drawer provides the surface + section label)
- Drop vestigial onToggleMinimize prop (header button was commented out, unused)
- Form/textarea/handleSubmit/handleKeyDown behavior unchanged"
```

---

## Task 3: Wire `MoreDrawer` into Sidebar + drop the Instructions pill

**Files:**
- Modify: `pages/content/src/components/sidebar/Sidebar.tsx`

- [ ] **Step 1: Read the relevant sections.** Confirm current line numbers (may have shifted) of: the InputArea import (`:9`), `isInputMinimized` state (`:278`), `toggleInputMinimize` (`:514`), `adapter` useMemo (`:51-62`), `formattedTools` (`:613-617`), the `SidebarNav` tabs (`:845-854`), the Instructions pane (`:882-893`), the dormant InputArea comment block (`:906-927`).

- [ ] **Step 2: Add the import + the input-submit handler**

Add to imports:
```ts
import MoreDrawer from './MoreDrawer/MoreDrawer';
```

Add a handler near the other handlers (e.g. after `toggleInputMinimize` — which you're about to delete — or alongside `handleRefreshTools`). This revives the dormant InputArea wiring:
```ts
const handleInputSubmit = async (text: string) => {
  await adapter.insertTextIntoInput(text);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await adapter.triggerSubmission();
};
```
(Confirm `adapter` is in scope — it's the `useMemo` at `:51-62`. If `adapter` is named differently where you place this, use the real name.)

- [ ] **Step 3: Remove the Instructions pill + pane**

In the `<SidebarNav tabs={[...]}>` array, delete the `{ id: 'instructions', label: 'Instructions' }` entry → 3 pills remain (Tools/Skills/Settings).

In the `activeTab` union (`:275`), remove `'instructions'`:
```ts
const [activeTab, setActiveTab] = useState<'availableTools' | 'availableSkills' | 'settings'>('availableTools');
```

Delete the entire Instructions pane `<div hidden={activeTab !== 'instructions'}>...<InstructionManager .../></div>` (`:882-893`). (InstructionManager is now rendered inside MoreDrawer, not here.)

If removing the Instructions pane leaves the `InstructionManager` import unused at the top of Sidebar, **leave the import for now** — it may still be referenced by the dormant block; you'll resolve that in Step 5. (If you can confirm it's fully unused after Step 5, remove it.)

- [ ] **Step 4: Replace the dormant InputArea block with `<MoreDrawer>`**

Delete the entire commented-out InputArea block (`:906-927`, the `{/* ... */}` wrapping the dormant `<InputArea>`). In its place, mount the drawer:
```tsx
<MoreDrawer onSubmitInput={handleInputSubmit} adapter={adapter} tools={formattedTools} />
```
Place it in the same structural position (bottom of the sidebar, after the tab-content `<div className="flex-1 min-h-0 ...">`, as a `flex-shrink-0` sibling — MoreDrawer's root already has `flex-shrink-0`).

- [ ] **Step 5: Delete the dead InputArea-related code**

- Remove the InputArea import at `:9` IF it's now unused (it is — you removed the dormant block that referenced it; MoreDrawer owns the InputArea import now). Confirm with `rg "InputArea" pages/content/src/components/sidebar/Sidebar.tsx` returns nothing.
- Remove the `isInputMinimized` state (`:278`).
- Remove the `toggleInputMinimize` handler (`:514`).
- If the `InstructionManager` import is now unused in Sidebar (it's used inside MoreDrawer, not Sidebar anymore), remove that import too. Confirm with `rg "InstructionManager" pages/content/src/components/sidebar/Sidebar.tsx`.

- [ ] **Step 6: Verify (the gate)**

1. `pnpm type-check` — Sidebar.tsx adds **zero** new errors. (Watch for unused-variable errors from the imports/state you removed — if `isInputMinimized`/`toggleInputMinimize`/`InputArea`/`InstructionManager` are flagged as unused, you missed a reference; remove it. If something you removed IS still referenced, restore that piece.)
2. `pnpm vitest run pages/content/__tests__ --reporter=dot` — all **55** pass.
3. `pnpm build` — completes.

- [ ] **Step 7: Commit**

```bash
git add pages/content/src/components/sidebar/Sidebar.tsx
git commit -m "feat(sidebar): mount MoreDrawer + drop Instructions pill — phase 3

- Mount <MoreDrawer> at the sidebar bottom (onSubmitInput -> adapter wiring)
- Remove Instructions pill + pane -> 3 pills (Tools/Skills/Settings)
- activeTab union -= 'instructions'
- Delete dormant InputArea comment block + dead isInputMinimized state +
  toggleInputMinimize handler + unused InputArea/InstructionManager imports
- Resurrects InputArea (was commented out) inside the drawer"
```

---

## Task 4: Final verify + manual smoke

- [ ] **Step 1: Full regression**

`pnpm type-check` (baseline ~11 errors, zero new).
`pnpm vitest run pages/content/__tests__ --reporter=dot` — 55 pass.
`pnpm build` — green.
`cd pages/content && pnpm lint` (no `--fix`) on the touched files — no new errors.

- [ ] **Step 2: Manual smoke (load unpacked extension)**
  - Sidebar shows **3 pills**: Tools / Skills / Settings (no Instructions).
  - Each pill switches the correct pane.
  - At the bottom, a "More" bar with a chevron. Click → drawer animates open (smooth height, ~200ms), pushing the pane content up.
  - Inside the drawer: "Insert into chat" (textarea; type + Enter inserts into the host chat; Shift+Enter = newline) and "Instructions" (InstructionManager's two panels render + edit works).
  - **Critical:** toggle the drawer closed and reopen — InstructionManager's content is still there (it stayed mounted; instructionsState kept updating). Toggle a tool's enablement elsewhere → the generated instructions inside the (closed) drawer still regenerates (verify by reopening).
  - Toggle theme → drawer + contents legible in dark.
  - `prefers-reduced-motion` (OS setting) → drawer opens instantly, no animation.

- [ ] **Step 3: Report** (no commit unless something changed)

---

## Self-Review

**1. Spec coverage (Phase 3 slice):**
- "Input + Instructions behind 'More' drawer" → MoreDrawer (Task 1) holds both (Task 3). ✓
- "3 pills (Tools/Skills/Settings) end state" → Instructions pill removed (Task 3). ✓
- "Drawer animates open (height + fade)" → grid-rows 0fr→1fr + the inner overflow-hidden (Task 1). ✓ (fade optional; height is the core)
- "Keep plumbing untouched" → no store/hook/adapter changes; InstructionManager rendered as-is. ✓
- "Motion: respect prefers-reduced-motion" → global `.mcp-sidebar *` guard from Phase 0 covers it. ✓

**2. Placeholder scan:** No TBD. The `adapter: any` is a pre-existing pattern match (InstructionManager.tsx:69), not a placeholder. Line numbers given as recon values with "confirm/may have shifted" guidance. Icon names (`chevron-down`) confirmed in the union.

**3. Type consistency:** `MoreDrawerProps.onSubmitInput: (text: string) => void` matches InputArea's `onSubmit: (text: string) => void` (post-Task-2). `adapter`/`tools` pass through to InstructionManager's existing `InstructionManagerProps` (recon-confirmed). `activeTab` union shrinks consistently (Step 3 removes it from both the union and the tabs array). `handleInputSubmit` matches the dormant wiring (adapter.insertTextIntoInput → triggerSubmission).

**4. Critical-risk check (InstructionManager singleton):** MoreDrawer renders InstructionManager **unconditionally** (not behind `{open && ...}`) — only the grid `0fr` clips it visually. DOM stays mounted → singleton + poll keep running. Verify in Task 4 Step 2 (close/reopen + toggle tool → instructions regenerate).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-18-sidebar-redesign-phase3.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between, fast iteration. (Matches Phase 0/1/2.)

**2. Inline Execution** — batch in this session with checkpoints.

Which approach?
