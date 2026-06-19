# Sidebar Redesign — Foundation Hotfix (Token Vars Survive Shadow-DOM Transform)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix the Phase-0 token foundation so design-token CSS variables (`--surface`, `--ink`, `--ground`, `ok/con/off/err`, etc.) actually apply in **both light and dark mode**. Today they only apply in dark (broken in light), because the shadow-root CSS injector mangles `:host`-first selectors.

**Root cause:** `shadowDom.ts:66` runs `css.replace(/(^|\})([^{}]+)\{/, '$1:host $2 {')` — it prefixes the **first selector of every rule** with `:host `. Phase-0 `tokens.css` defined light tokens on `:host,` (first selector) → becomes `:host :host,` (matches nothing). Dark survived only because `:host.dark` was the *last* selector (un-mangled) and the host gets `.dark`. So `--surface`/`--ink`/`--ground`/etc. were never defined in light mode → every `bg-surface` / `text-ink` utility across Phases 0-3 resolved to nothing (transparent cards, inherited text). Never caught because no visual smoke was done.

**Fix:** Move the token definitions onto the codebase's **direct-injection** theme path — `generateLightThemeVariables()` and `generateDarkThemeVariables()` in `shadowDom.ts`. These return CSS injected as `<style id="theme-variables">` directly into the shadow root (`applyDarkMode`/`applyLightMode`, called from `BaseSidebarManager.tsx:75,82`), **bypassing the mangling transform**, so `:host { --surface: … }` works natively. The old theme vars (`--bg-primary`, etc.) already live here — this is the intended mechanism. Then delete the now-redundant `tokens.css`.

**Tech Stack:** React/TypeScript/Tailwind unchanged. The Tailwind config's `surface: 'var(--surface)'` mappings stay — they reference the vars by name; only WHERE the vars are defined changes.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `pages/content/src/utils/shadowDom.ts` | **Modify** | Add design-token vars to `generateLightThemeVariables()` + `generateDarkThemeVariables()` `:host` blocks; add the reduced-motion guard to both |
| `pages/content/src/styles/tokens.css` | **Delete** | Redundant (vars now defined in the generators); its `:host`-first selectors were the bug |
| `pages/content/src/tailwind-input.css` | **Modify** | Remove the `@import './styles/tokens.css';` line |

**Untouched:** `tailwind.config.ts` (the `var(--surface)` color mappings stay valid), all components (they consume utilities, not the vars directly).

---

## Task 1: Add tokens to the theme generators

**Files:**
- Modify: `pages/content/src/utils/shadowDom.ts`

- [ ] **Step 1: Read** `generateDarkThemeVariables()` (starts `:183`) and `generateLightThemeVariables()` (starts `:271`). Each returns a template string whose first block is `:host { …old vars… }`.

- [ ] **Step 2: Add the LIGHT tokens** to the `:host { }` block inside `generateLightThemeVariables()` (after the existing `--shadow-color: rgba(0, 0, 0, 0.1);` line):

```css
      /* Sidebar redesign design tokens — Direction B (light) */
      --ground: #f6f5f9;
      --surface: #ffffff;
      --ink: #1f1d2b;
      --muted: #6b6480;
      --line: rgba(80, 60, 140, 0.08);
      --accent-from: #a78bfa;
      --accent-to: #f0abfc;
      --ok: #10b981;
      --ok-soft: #ecfdf5;
      --con: #d97706;
      --con-soft: #fef3c7;
      --off: #6b6480;
      --off-soft: #f1f0f4;
      --err: #b91c1c;
      --err-soft: #fee2e2;
      --radius-row: 8px;
      --radius-card: 12px;
      --radius-pill: 9999px;
      --shadow-soft: 0 1px 3px rgba(80, 60, 140, 0.08);
```

- [ ] **Step 3: Add the DARK tokens** to the `:host { }` block inside `generateDarkThemeVariables()` (after the existing `--shadow-color: rgba(0, 0, 0, 0.3);` line):

```css
      /* Sidebar redesign design tokens — Direction B (dark) */
      --ground: #15141c;
      --surface: #1d1b26;
      --ink: #ece9f5;
      --muted: #9a93ad;
      --line: rgba(220, 210, 255, 0.1);
      --accent-from: #a78bfa;
      --accent-to: #f0abfc;
      --ok: #34d399;
      --ok-soft: rgba(52, 211, 153, 0.15);
      --con: #fbbf24;
      --con-soft: rgba(251, 191, 36, 0.15);
      --off: #9a93ad;
      --off-soft: rgba(154, 147, 173, 0.15);
      --err: #f87171;
      --err-soft: rgba(248, 113, 113, 0.15);
      --radius-row: 8px;
      --radius-card: 12px;
      --radius-pill: 9999px;
      --shadow-soft: 0 1px 3px rgba(0, 0, 0, 0.3);
```

- [ ] **Step 4: Add the reduced-motion guard to BOTH generator returns** (theme-agnostic, so identical in both). Append just before the closing backtick of each template string:

```css

    /* ponytail: respect prefers-reduced-motion across the whole shadow tree */
    @media (prefers-reduced-motion: reduce) {
      :host * {
        transition: none !important;
        animation: none !important;
      }
    }
```

(Placing it inside the generated string means it's injected directly — no transform mangling — and `:host *` correctly covers all descendants of the shadow host.)

- [ ] **Step 5: Type-check + build**

`pnpm type-check` — zero new errors (shadowDom.ts is plain TS; a template-string edit can't add type errors, but confirm).
`pnpm build` — completes. (Runtime injection isn't exercised by build, but a template-string syntax error would surface here.)

- [ ] **Step 6: Commit**

```bash
git add pages/content/src/utils/shadowDom.ts
git commit -m "fix(sidebar): define design tokens via theme generators (shadow-DOM transform fix)

Phase-0 tokens.css defined light tokens on ':host,' (first selector) which
shadowDom.ts:66 mangles to ':host :host,' (matches nothing) -> light-mode
tokens never applied. Move all token vars + the reduced-motion guard into
generateLightThemeVariables/generateDarkThemeVariables, whose output is
injected directly as #theme-variables (bypassing the transform), so ':host'
works natively. Dark already worked (:host.dark was last selector); this
fixes light + makes both robust."
```

---

## Task 2: Delete the redundant `tokens.css`

**Files:**
- Delete: `pages/content/src/styles/tokens.css`
- Modify: `pages/content/src/tailwind-input.css` (remove the `@import`)

- [ ] **Step 1: Remove the import.** In `pages/content/src/tailwind-input.css`, delete the line `@import './styles/tokens.css';` (it was line 1 — confirm). Leave the rest of the file intact.

- [ ] **Step 2: Delete the file.**

```bash
git rm pages/content/src/styles/tokens.css
```

(If the `styles/` directory becomes empty, leave it — don't force-remove the dir.)

- [ ] **Step 3: Verify the Tailwind utilities still resolve.** The utilities (`bg-surface`, `text-ink`, etc.) are defined in `tailwind.config.ts` as `var(--surface)` etc. Those vars now come from the generators. Confirm nothing else imported `tokens.css`: `rg "tokens.css" pages/content/src`. Expected: zero matches after the edit.

- [ ] **Step 4: Type-check + build + tests**

`pnpm type-check` — zero new errors.
`pnpm build` — completes (proves the CSS still compiles without the deleted import).
`pnpm vitest run pages/content/__tests__ --reporter=dot` — all **55** pass.

- [ ] **Step 5: Commit**

```bash
git add pages/content/src/tailwind-input.css pages/content/src/styles/tokens.css
git commit -m "chore(sidebar): remove redundant tokens.css (vars moved to shadowDom generators)

Its ':host'-first selectors were the light-mode bug (mangled by the shadow-DOM
transform). Token vars now live in generateLight/DarkThemeVariables. Tailwind
config utilities (var(--surface) etc.) resolve against the injected #theme-variables."
```

---

## Task 3: Final verify

- [ ] **Step 1: Full gate**

`pnpm type-check` (baseline ~11 errors, zero new).
`pnpm vitest run pages/content/__tests__ --reporter=dot` — 55 pass.
`pnpm build` — green.
`cd pages/content && pnpm lint` (no `--fix`) — no new errors in `shadowDom.ts`.

- [ ] **Step 2: Manual smoke (load unpacked extension) — the real proof**
  - **Light mode:** sidebar opens, ConnectionBadge shows a white `bg-surface` card with dark `text-ink` text (NOT transparent). SidebarNav pills visible on `bg-ground`. ResourceRows legible. MoreDrawer "More" bar visible.
  - **Dark mode:** toggle theme, tokens swap (dark surfaces, light ink).
  - Toggle a tool/skill — colors stay token-driven.
  - `prefers-reduced-motion` (OS setting) → MoreDrawer opens instantly, no animation.
  - **This is the smoke that's been pending since Phase 0.** If light mode now renders correctly, the foundation is fixed.

---

## Self-Review

**1. Root-cause coverage:** light tokens now defined on `:host` via direct injection (survives) — fixes light. Dark tokens also on `:host` via the dark generator — dark stays fixed (and no longer relies on the fragile "last-selector" luck). Reduced-motion guard on `:host *` via direct injection — now actually fires (was dead `.mcp-sidebar *`). ✓

**2. No regression to old theme vars:** the additions are NEW var names (`--surface`, `--ink`, …) — they don't touch `--bg-primary`, `--text-primary`, etc. Old consumers unaffected. ✓

**3. Tailwind config unchanged:** `tailwind.config.ts` still maps `surface: 'var(--surface)'` etc.; the vars are now defined by the generators. Utilities resolve identically. ✓

**4. Both generators updated symmetrically:** light tokens in `generateLightThemeVariables`, dark tokens in `generateDarkThemeVariables`, reduced-motion in both. ✓

**5. Risk:** the only shared-infra file touched is `shadowDom.ts`, and the edits are purely additive inside two template-string returns. Build/type-check/tests are the gate. The real confirmation is the visual smoke (Step 2).

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-06-18-sidebar-redesign-foundation-hotfix.md`. This is a small, well-specified fix — single implementer dispatch (no per-task review subagents needed; controller verifies via the gate + the user's visual smoke).

Recommended: execute subagent-driven on a `fix/sidebar-token-foundation` branch, merge to main + push, then do the visual smoke. Proceed?
