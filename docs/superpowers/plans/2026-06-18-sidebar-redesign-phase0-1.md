# Sidebar Redesign — Phase 0 (Tokens) + Phase 1 (ConnectionBadge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the design-token foundation and replace the 1103-LOC `ServerStatus` panel with a one-row `ConnectionBadge` (+ inline `ConnectionError`), the first two independently-shippable milestones of the sidebar redesign (spec: `docs/superpowers/specs/2026-06-18-sidebar-redesign-design.md`).

**Architecture:** Tokens ship as CSS custom properties in one file (transport that survives the sidebar's Shadow DOM + `!important` layer) and are mirrored into the content Tailwind theme so `bg-ground` / `text-ink` utilities exist. `ConnectionBadge` is driven by a pure `getConnectionState()` mapper (the TDD surface) over the existing `useConnectionStatus()` store hook — no store/hook/adapter changes. The old `ServerStatus.tsx` is swapped out of `Sidebar.tsx` and deleted once verified.

**Tech Stack:** React 18, TypeScript, Tailwind (content-scoped, `important: true` for Shadow DOM), Zustand (`useConnectionStatus`), Vitest (root, pure-function tests).

**Spec reconciliation (one deviation, flagged):** The spec said "reuse `packages/tailwind-config` as the single source." In reality `pages/content/tailwind.config.ts` is intentionally standalone (Shadow DOM needs `important: true` + its own `content` globs), and the shared package is an empty base. Tokens therefore live in `pages/content/src/styles/tokens.css` (content-local). This keeps one source of truth *within content* without forcing a Shadow-DOM-hostile shared config. Phases 2-5 plans inherit this.

---

## File Structure

| File | Action | Responsibility | Target LOC |
|---|---|---|---|
| `pages/content/src/styles/tokens.css` | **Create** | All design tokens as CSS vars (light default + dark override) | ~40 |
| `pages/content/src/tailwind-input.css` | **Modify** | `@import` the tokens file once | +1 |
| `pages/content/tailwind.config.ts` | **Modify** | Extend `theme.colors` to expose tokens as utilities | +~20 |
| `pages/content/src/components/sidebar/ServerStatus/connectionState.ts` | **Create** | Pure mapper: `ConnectionStatus` → badge view-state | ~35 |
| `pages/content/__tests__/connectionState.test.ts` | **Create** | TDD tests for the mapper | ~50 |
| `pages/content/src/components/sidebar/ServerStatus/ConnectionBadge.tsx` | **Create** | Presentational one-row status, reads store | ~80 |
| `pages/content/src/components/sidebar/ServerStatus/ConnectionError.tsx` | **Create** | Inline expand for error state | ~40 |
| `pages/content/src/components/sidebar/ServerStatus/index.ts` | **Modify** | Re-export `ConnectionBadge` as default | +1 |
| `pages/content/src/components/sidebar/Sidebar.tsx` | **Modify** | Swap `<ServerStatus>` → `<ConnectionBadge>` (line ~797), fix import | ~3 lines |
| `pages/content/src/components/sidebar/ServerStatus/ServerStatus.tsx` | **Delete** | Removed once wired + verified | — |

---

## Phase 0 — Design Tokens

### Task 1: Create the tokens CSS file

**Files:**
- Create: `pages/content/src/styles/tokens.css`

- [ ] **Step 1: Create the tokens file with the full B palette (light default + dark override)**

```css
/* pages/content/src/styles/tokens.css */
/* Sidebar redesign tokens — Direction B ("Arc / Friendly").
   Light is the default; dark applies under [data-theme="dark"] or .theme-dark
   (both selectors are used by different parts of the host theme detector —
   keep both until Sidebar theme application is confirmed in Task 9). */

:root,
.mcp-sidebar,
[data-theme='light'],
.theme-light {
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
}

[data-theme='dark'],
.theme-dark {
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
  --shadow-soft: 0 1px 3px rgba(0, 0, 0, 0.3);
}

@media (prefers-reduced-motion: reduce) {
  .mcp-sidebar * {
    transition: none !important;
    animation: none !important;
  }
}
```

- [ ] **Step 2: Import the tokens file from the content CSS entry**

File: `pages/content/src/tailwind-input.css`. Add this line at the very top (above existing content):

```css
@import './styles/tokens.css';
```

If that file does not exist or is not the real entry, run `rg -l "tailwind" pages/content/src --type css` to find the entry and import there instead. Do not proceed until the import is in the file Vite actually bundles.

### Task 2: Expose tokens as Tailwind utilities

**Files:**
- Modify: `pages/content/tailwind.config.ts`

- [ ] **Step 1: Extend the theme with token-mapped colors and radii**

Replace the empty `theme.extend` block so the file becomes:

```ts
import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  important: true, // Use !important for all utilities to ensure they override Shadow DOM styles
  corePlugins: {
    preflight: true,
  },
  theme: {
    extend: {
      colors: {
        ground: 'var(--ground)',
        surface: 'var(--surface)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        line: 'var(--line)',
        'accent-from': 'var(--accent-from)',
        'accent-to': 'var(--accent-to)',
        ok: { DEFAULT: 'var(--ok)', soft: 'var(--ok-soft)' },
        con: { DEFAULT: 'var(--con)', soft: 'var(--con-soft)' },
        off: { DEFAULT: 'var(--off)', soft: 'var(--off-soft)' },
        err: { DEFAULT: 'var(--err)', soft: 'var(--err-soft)' },
      },
      borderRadius: {
        row: 'var(--radius-row)',
        card: 'var(--radius-card)',
        pill: 'var(--radius-pill)',
      },
      boxShadow: {
        soft: 'var(--shadow-soft)',
      },
    },
  },
} satisfies Config;
```

### Task 3: Verify Phase 0 builds and commit

- [ ] **Step 1: Type-check**

Run from repo root: `pnpm type-check`
Expected: exits 0, no errors.

- [ ] **Step 2: Build the content package**

Run from repo root: `pnpm build`
Expected: completes; `pages/content/dist` regenerates. If it fails on the CSS import path, fix the path from Task 1 Step 2.

- [ ] **Step 3: Lint**

Run from repo root: `pnpm lint`
Expected: no new errors in the modified files.

- [ ] **Step 4: Commit Phase 0**

```bash
git add pages/content/src/styles/tokens.css pages/content/src/tailwind-input.css pages/content/tailwind.config.ts
git commit -m "feat(sidebar): add design tokens (Direction B) — phase 0

CSS-var token layer (light + dark) wired into content Tailwind theme.
No UI change yet; utilities (bg-ground, text-ink, ok/con/off/err, radii) now available.
prefers-reduced-motion guard included."
```

---

## Phase 1 — ConnectionBadge (replace ServerStatus)

### Task 4: Write the failing test for `getConnectionState`

**Files:**
- Test: `pages/content/__tests__/connectionState.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// pages/content/__tests__/connectionState.test.ts
import { describe, it, expect } from 'vitest';
import { getConnectionState } from '../src/components/sidebar/ServerStatus/connectionState';
import type { ConnectionStatus } from '../src/types/stores';

describe('getConnectionState', () => {
  it('maps connected to the ok variant with no spinner', () => {
    const s = getConnectionState('connected', false);
    expect(s.variant).toBe('ok');
    expect(s.label).toBe('Connected');
    expect(s.showSpinner).toBe(false);
    expect(s.expandError).toBe(false);
  });

  it('maps connecting to the con variant with a spinner', () => {
    const s = getConnectionState('connecting', false);
    expect(s.variant).toBe('con');
    expect(s.showSpinner).toBe(true);
    expect(s.expandError).toBe(false);
  });

  it('maps reconnecting to the con variant, labelled Reconnecting, with a spinner', () => {
    const s = getConnectionState('reconnecting', false);
    expect(s.variant).toBe('con');
    expect(s.label).toBe('Reconnecting');
    expect(s.showSpinner).toBe(true);
  });

  it('maps disconnected to the off variant with no error expansion', () => {
    const s = getConnectionState('disconnected', false);
    expect(s.variant).toBe('off');
    expect(s.label).toBe('Disconnected');
    expect(s.expandError).toBe(false);
  });

  it('maps error to the err variant and expands the error detail', () => {
    const s = getConnectionState('error', true);
    expect(s.variant).toBe('err');
    expect(s.label).toBe('Connection failed');
    expect(s.expandError).toBe(true);
  });

  it('treats an undefined status defensively as disconnected', () => {
    const s = getConnectionState(undefined as unknown as ConnectionStatus, false);
    expect(s.variant).toBe('off');
    expect(s.label).toBe('Disconnected');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from repo root: `pnpm vitest run pages/content/__tests__/connectionState.test.ts --reporter=dot`
Expected: FAIL — `getConnectionState` is not defined (module does not exist yet).

### Task 5: Implement `getConnectionState`

**Files:**
- Create: `pages/content/src/components/sidebar/ServerStatus/connectionState.ts`

- [ ] **Step 1: Write the mapper**

```ts
// pages/content/src/components/sidebar/ServerStatus/connectionState.ts
import type { ConnectionStatus } from '@src/types/stores';

export type BadgeVariant = 'ok' | 'con' | 'off' | 'err';

export interface ConnectionState {
  variant: BadgeVariant;
  label: string;
  showSpinner: boolean;
  expandError: boolean;
}

export function getConnectionState(
  status: ConnectionStatus | undefined,
  hasError: boolean,
): ConnectionState {
  switch (status) {
    case 'connected':
      return { variant: 'ok', label: 'Connected', showSpinner: false, expandError: false };
    case 'connecting':
      return { variant: 'con', label: 'Connecting', showSpinner: true, expandError: false };
    case 'reconnecting':
      return { variant: 'con', label: 'Reconnecting', showSpinner: true, expandError: false };
    case 'error':
      return { variant: 'err', label: 'Connection failed', showSpinner: false, expandError: true };
    case 'disconnected':
    default:
      return { variant: 'off', label: 'Disconnected', showSpinner: false, expandError: false };
  }
}

export const VARIANT_TAG_CLASS: Record<BadgeVariant, string> = {
  ok: 'bg-ok-soft text-ok',
  con: 'bg-con-soft text-con',
  off: 'bg-off-soft text-off',
  err: 'bg-err-soft text-err',
};
```

- [ ] **Step 2: Run the test to verify it passes**

Run from repo root: `pnpm vitest run pages/content/__tests__/connectionState.test.ts --reporter=dot`
Expected: PASS — 6 tests.

- [ ] **Step 3: Commit**

```bash
git add pages/content/src/components/sidebar/ServerStatus/connectionState.ts pages/content/__tests__/connectionState.test.ts
git commit -m "feat(sidebar): add getConnectionState mapper — phase 1

Pure ConnectionStatus -> badge view-state mapper with full unit coverage.
No UI yet; consumed by ConnectionBadge next."
```

### Task 6: Build `ConnectionError`

**Files:**
- Create: `pages/content/src/components/sidebar/ServerStatus/ConnectionError.tsx`

- [ ] **Step 1: Write the inline error component**

```tsx
// pages/content/src/components/sidebar/ServerStatus/ConnectionError.tsx
import React from 'react';

interface ConnectionErrorProps {
  message: string;
  attempts: number;
  maxAttempts: number;
  onRetry: () => void;
}

const ConnectionError: React.FC<ConnectionErrorProps> = ({ message, attempts, maxAttempts, onRetry }) => {
  const exhausted = attempts >= maxAttempts && maxAttempts > 0;
  return (
    <div className="mt-2 rounded-card bg-err-soft p-2">
      <code className="block break-all text-[10px] leading-snug text-err font-mono">{message}</code>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] text-muted">
          {exhausted ? `Max retries (${maxAttempts}) reached` : `Attempt ${attempts}/${maxAttempts}`}
        </span>
        <button
          type="button"
          onClick={onRetry}
          disabled={exhausted}
          className="ml-auto rounded-pill bg-ink px-2.5 py-1 text-[10px] font-semibold text-surface disabled:opacity-40"
        >
          Retry
        </button>
      </div>
    </div>
  );
};

export default ConnectionError;
```

### Task 7: Build `ConnectionBadge`

**Files:**
- Create: `pages/content/src/components/sidebar/ServerStatus/ConnectionBadge.tsx`

- [ ] **Step 1: Write the one-row badge component**

```tsx
// pages/content/src/components/sidebar/ServerStatus/ConnectionBadge.tsx
import React from 'react';
import { useConnectionStatus } from '@src/hooks';
import { useMcpCommunication } from '@src/hooks/useMcpCommunication';
import { getConnectionState, VARIANT_TAG_CLASS } from './connectionState';
import ConnectionError from './ConnectionError';

const ConnectionBadge: React.FC = () => {
  const { status, isReconnecting, error, serverConfig, connectionAttempts, maxRetryAttempts } =
    useConnectionStatus();
  const { reconnect } = useMcpCommunication();

  const state = getConnectionState(status, Boolean(error));
  const serverName = serverConfig?.name || serverConfig?.url || 'MCP server';
  const showRetryButton = state.variant === 'off';

  return (
    <div className="rounded-card bg-surface p-2.5 shadow-soft">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={[
            'inline-block h-2.5 w-2.5 shrink-0 rounded-pill',
            state.variant === 'ok' ? 'bg-ok' : '',
            state.variant === 'con' ? 'bg-con' : '',
            state.variant === 'off' ? 'bg-off' : '',
            state.variant === 'err' ? 'bg-err' : '',
          ].join(' ').trim()}
        />
        <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-ink">{serverName}</span>

        {state.showSpinner && (
          <span
            aria-label={isReconnecting ? 'Reconnecting' : 'Connecting'}
            className="inline-block h-3 w-3 animate-spin rounded-pill border-2 border-con-soft border-t-con"
          />
        )}

        <span className={`rounded-pill px-2 py-0.5 text-[9px] font-bold ${VARIANT_TAG_CLASS[state.variant]}`}>
          {state.label}
        </span>

        {showRetryButton && (
          <button
            type="button"
            onClick={reconnect}
            className="rounded-pill bg-off-soft px-2 py-0.5 text-[10px] font-semibold text-ink"
          >
            Reconnect
          </button>
        )}
      </div>

      {state.expandError && error ? (
        <ConnectionError
          message={String(error)}
          attempts={connectionAttempts}
          maxAttempts={maxRetryAttempts}
          onRetry={reconnect}
        />
      ) : null}
    </div>
  );
};

export default ConnectionBadge;
```

- [ ] **Step 2: Confirm the hook surface matches before relying on it**

Run: `rg "useConnectionStatus|reconnect" pages/content/src/hooks -A 3`
Confirm `useConnectionStatus` returns `serverConfig`, `connectionAttempts`, `maxRetryAttempts`, `error`, `isReconnecting`, and that `useMcpCommunication` exposes `reconnect`. If `reconnect` is named differently (e.g. `connect`, `retry`), use the actual name in both `ConnectionBadge` and `ConnectionError`'s `onRetry`. Do not guess — read the hook.

### Task 8: Wire `ConnectionBadge` into `Sidebar`

**Files:**
- Modify: `pages/content/src/components/sidebar/Sidebar.tsx` (import line 5, usage line ~797)
- Modify: `pages/content/src/components/sidebar/ServerStatus/index.ts` (create or update barrel)

- [ ] **Step 1: Make `ConnectionBadge` the default export of the ServerStatus barrel**

Create or overwrite `pages/content/src/components/sidebar/ServerStatus/index.ts`:

```ts
export { default } from './ConnectionBadge';
export { default as ConnectionBadge } from './ConnectionBadge';
export { getConnectionState } from './connectionState';
```

- [ ] **Step 2: Swap the import and usage in Sidebar.tsx**

In `pages/content/src/components/sidebar/Sidebar.tsx`:

Change line 5:
```ts
// from
import ServerStatus from './ServerStatus/ServerStatus';
// to
import ConnectionBadge from './ServerStatus/ConnectionBadge';
```

Change the usage at line ~797:
```tsx
// from
<ServerStatus status={serverStatus} />
// to
<ConnectionBadge />
```

(`ConnectionBadge` reads the store directly, so the `status={serverStatus}` prop is no longer needed. Leave the `serverStatus` variable in place if other code uses it; otherwise it can be removed in cleanup.)

- [ ] **Step 3: Type-check**

Run from repo root: `pnpm type-check`
Expected: exits 0. If it complains about an unused `serverStatus` or unused import, remove the now-dead bits.

### Task 9: Verify, delete the old file, commit

- [ ] **Step 1: Run the full sidebar-related test suite**

Run from repo root: `pnpm vitest run pages/content/__tests__ --reporter=dot`
Expected: all green, including the new `connectionState.test.ts` and the pre-existing `tool-list`, `system-tag`, `skill-*` tests (regression).

- [ ] **Step 2: Lint**

Run from repo root: `pnpm lint`
Expected: no new errors.

- [ ] **Step 3: Build**

Run from repo root: `pnpm build`
Expected: completes.

- [ ] **Step 4: Confirm the theme selector actually toggles dark tokens (spec open item)**

Run: `rg "data-theme|theme-dark|setAttribute.*theme|classList.*theme" pages/content/src --type ts --type tsx`
Confirm which selector the sidebar's `useTheme()` applies. If it sets neither `[data-theme="dark"]` nor `.theme-dark`, add the selector the code actually uses to the dark block in `tokens.css` (Task 1). The light default already applies via `:root`, so light works regardless.

- [ ] **Step 5: Manual smoke check (load the unpacked extension)**

Load `pages/content/dist` (or the build output the repo uses) in Chrome, open a supported chat site, open the sidebar, and confirm:
- Connected → green dot + "Connected" pill, server name shown.
- Stop the MCP server → state transitions to disconnected/error and the badge reflects it; error message expands inline with Retry.
- Toggle theme → tokens swap (if dark selector from Step 4 is wired).

- [ ] **Step 6: Delete the old ServerStatus.tsx**

```bash
git rm pages/content/src/components/sidebar/ServerStatus/ServerStatus.tsx
```

- [ ] **Step 7: Re-verify type-check + tests after deletion**

Run: `pnpm type-check && pnpm vitest run pages/content/__tests__ --reporter=dot`
Expected: green (nothing else imported the old default after Task 8 Step 1 re-pointed the barrel).

- [ ] **Step 8: Commit Phase 1**

```bash
git add pages/content/src/components/sidebar/ServerStatus/ pages/content/src/components/sidebar/Sidebar.tsx
git commit -m "feat(sidebar): replace ServerStatus panel with ConnectionBadge — phase 1

- New ConnectionBadge: one-row status across connected/connecting/reconnecting/disconnected/error
- ConnectionError: inline expand on error (no modal), with Retry + attempt counter
- getConnectionState pure mapper, fully unit-tested
- ServerStatus.tsx (1103 LOC) deleted; Sidebar.tsx swap verified
- Tokens from phase 0 power the variants (ok/con/off/err)
- Stores, hooks, adapters, MCP comm untouched"
```

---

## Self-Review

**1. Spec coverage (Phase 0 + 1 slice):**
- Design Tokens section → Tasks 1-3 (full token table, light + dark, radii, shadow, reduced-motion). ✓
- "Connection status → one row, four states… Error expands inline with message + Retry — no modal" → Tasks 4-9 (mapper covers all 5 `ConnectionStatus` values incl. `reconnecting`; `ConnectionError` is inline with Retry; no modal). ✓
- "Keep the plumbing untouched" → `getConnectionState` is pure, components read existing hooks; no store/hook/adapter edits. ✓
- "Every target file ≤ 250 LOC" → connectionState ~35, ConnectionError ~40, ConnectionBadge ~80. ✓
- "Bundle size does not increase (CSS-first, zero new runtime deps)" → no new deps added. ✓
- Spec reconciliation (tokens location) documented at top of plan. ✓

Phases 2-5 (segmented nav + ResourceList, MoreDrawer, motion pass, dark-polish) are deliberately out of this plan — they get follow-on plans after the token layer + ConnectionBadge validate the approach.

**2. Placeholder scan:** No TBD/TODO. The one "verify before relying" step (Task 7 Step 2, Task 9 Step 4) gives the exact command to run and the exact fallback action — it is a verification gate, not a placeholder. All code blocks are complete.

**3. Type consistency:** `BadgeVariant` = `'ok' | 'con' | 'off' | 'err'` is defined once (connectionState.ts) and used consistently in `VARIANT_TAG_CLASS` and `ConnectionBadge`. `ConnectionState` fields (`variant`, `label`, `showSpinner`, `expandError`) match between mapper and consumers. `ConnectionStatus` imported from `@src/types/stores` matches the store's union (`'connected' | 'disconnected' | 'connecting' | 'error' | 'reconnecting'`, confirmed at `types/stores.ts:21`). Hook return fields (`serverConfig`, `connectionAttempts`, `maxRetryAttempts`, `error`, `isReconnecting`) match `useStores.ts:56-69`; `reconnect` is verified-not-guessed in Task 7 Step 2.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-18-sidebar-redesign-phase0-1.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
