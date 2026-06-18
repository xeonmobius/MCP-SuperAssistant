# Sidebar Redesign — Visual + IA Overhaul (Direction B: "Arc / Friendly")

## Problem
The MCP-SuperAssistant sidebar UI is **dated, cluttered, and confusing**, with **no motion/feedback**. The code behind it is oversized and hard to maintain: `Sidebar.tsx` (960 LOC) and `ServerStatus.tsx` (1103 LOC) each do too much; six panels stack vertically in a 320px rail, producing poor hierarchy and endless scroll.

Goal: a complete visual + information-architecture redesign of the **sidebar** that keeps every feature, collapses the giant files into focused components, and adds the motion/feedback layer the UI currently lacks. Driven by three tools: **Impeccable** (design), **Ponytail** (minimalism — write less, use stdlib/native first), and **motion via CSS** (not Remotion — that was a misnomer; Remotion is for video, irrelevant here).

## Constraints
- **No feature cuts.** All six panels stay accessible: Connection status, Tools, Skills, Settings (primary); Input area, Instructions (secondary).
- **No new runtime dependencies by default.** Motion is CSS-first (Tailwind transitions + CSS). Framer Motion is an explicit, opt-in upgrade path only if CSS orchestration proves insufficient — the extension is injected into every page, so bundle size matters.
- **Keep the plumbing untouched:** Zustand stores (`ui.store.ts`, `pages/content/src/types/stores.ts`), hooks (`useTheme`, `useSidebarState`, `useUserPreferences`, `useConnectionStatus`), the adapter system (`useCurrentAdapter`), and MCP communication (`useMcpCommunication`).
- **Keep shadcn/ui primitives** (`button`, `card`, `dialog`); add a token layer on top, do not fork the primitives.
- **Keep light / dark / system theme** cycle. Direction B ships both variants.
- **Reuse `packages/tailwind-config`** as the single source for design tokens (it already exists in the monorepo).
- Must not break existing transports (SSE / WebSocket / StreamableHTTP / Native / Builtin).

## Non-Goals
- Redesigning the popup or options page (sidebar only this round).
- New features, new tools, new MCP protocol surface.
- Changing state management, the adapter system, or i18n.
- Server-side / background-script logic changes.

## Design Decisions (approved)

### Visual language — Direction B ("Arc / Friendly")
Soft, rounded, warm, pastel. Chosen over Linear/dev-tool (A) and Native/calm (C). Pill segment navigation, white cards on a tinted ground, violet→pink gradient accent, generous spacing, soft shadows.

### Information architecture
- **Connection status → one row** (was a 1103-LOC panel). Four states render inline: Connected (green pulse + latency), Connecting (spinner), Disconnected (Reconnect pill), Error (expands inline with message + Retry — **no modal**).
- **Tools / Skills / Settings → segmented pill nav**, one visible at a time. Kills the vertical scroll.
- **Input + Instructions → "More" drawer**, collapsed by default, animated open. These are the two features marked non-primary.
- **Tools & Skills share one component** (`ResourceList` + `ResourceRow`) — they are nearly identical UIs today; DRY them.

### Motion model (CSS-first)
- **State cross-fade:** connection states swap via React `key` + opacity transition (exit/enter).
- **"More" drawer:** animate with the `grid-template-rows: 0fr → 1fr` trick — no JS height measurement, no layout thrash.
- **Toggles:** CSS transition on a transform-origin dot (the shadcn Switch pattern, themed).
- **List stagger:** `animation-delay: calc(var(--i) * 30ms)` on filter/swap.
- **Hover/focus:** soft elevation + accent ring; respect `prefers-reduced-motion`.
- **Upgrade path:** if state-machine cross-fades exceed what keyed-opacity handles cleanly, adopt Framer Motion's `AnimatePresence` (documented ceiling, opt-in).

## Design Tokens
Live in `packages/tailwind-config` (CSS variables + Tailwind theme extension). Both light and dark.

| Token | Light | Dark |
|---|---|---|
| `--ground` | `#f6f5f9` | `#15141c` |
| `--surface` | `#ffffff` | `#1d1b26` |
| `--ink` | `#1f1d2b` | `#ece9f5` |
| `--muted` | `#6b6480` | `#9a93ad` |
| `--line` | `rgba(80,60,140,.08)` | `rgba(220,210,255,.10)` |
| `--accent-from` | `#a78bfa` | `#a78bfa` |
| `--accent-to` | `#f0abfc` | `#f0abfc` |
| `--ok` / `--con` / `--off` / `--err` | green/amber/gray/red | same, slightly desaturated |

Radii: `8` (rows), `12` (cards), `99` (pills/tags). Spacing scale: `4 / 8 / 12 / 16 / 20`. Shadow: `0 1px 3px var(--line)`.

## Component Architecture (target)

Current → target. Every target file **≤ 250 LOC** (most far under).

```
pages/content/src/components/sidebar/
  Sidebar.tsx              (960)  →  SidebarShell.tsx          (~120)  thin orchestrator: layout + theme + which view
  ServerStatus.tsx        (1103)  →  ConnectionBadge.tsx        (~80)   one-row status, 4 states
                                   +  ConnectionError.tsx       (~60)   inline expand on error
  AvailableTools.tsx       (710)  ┐
  AvailableSkills.tsx      (143)  ┴→  ResourceList.tsx          (~90)   shared list (props: kind=tool|skill)
                                   +  ResourceRow.tsx           (~50)   shared row + toggle
  InstructionManager.tsx   (505)  →  InstructionList.tsx        (~110)  lives inside MoreDrawer
  InputArea.tsx             (99)  →  InputComposer.tsx          (~100)  lives inside MoreDrawer
  Settings.tsx             (161)  →  SidebarSettings.tsx        (~140)  panel content (unchanged behavior)
  (new)                            +  SidebarNav.tsx            (~70)   segmented pills + More trigger
                                   +  MoreDrawer.tsx            (~80)   AnimateHeight container
  ui/  (keep, re-theme)            +  tokens consumed via Tailwind
```

`SidebarShell` owns: sidebar visibility/minimize/resize (from `useSidebarState`), theme application (`useTheme`), and which `<SidebarNav>` view is active. It renders `<ConnectionBadge>` at top, `<SidebarNav>`, the active view, and `<MoreDrawer>` at bottom. Everything below it is presentational + reads store via hooks.

`SidebarManager.tsx` (695) and `BaseSidebarManager.tsx` — the mount/portal logic — are **out of scope** for decomposition this round; only their imported child changes. (Ponytail: don't refactor what isn't blocking the redesign.)

## UX / State Model
- **Default view:** Tools pill active, ConnectionBadge shows live status, More collapsed.
- **Connection lifecycle:** connecting → connected (badge pulses then settles), error expands the badge into badge+detail inline (no navigation, no modal).
- **Empty states:** no tools/skills → card with icon + one-line CTA (e.g. "Connect a server to see tools"). Loading → 3-row skeleton (shimmer).
- **"More" open state:** drawer pushes content up (not over), InputComposer focuses, InstructionList shows active count chip.
- **Reduced motion:** all animations collapse to instant swaps.

## Phased Rollout
- **Phase 0 — Tokens.** Add token block to `packages/tailwind-config`, wire `pages/content/tailwind.config.ts`. No UI change. Shippable on its own.
- **Phase 1 — ConnectionBadge.** Replace `ServerStatus` usage with `<ConnectionBadge>` + `<ConnectionError>`. Biggest LOC win, contained blast radius. Run existing `ServerStatus`-related tests.
- **Phase 2 — Segmented nav + ResourceList.** Introduce `<SidebarNav>`, merge Tools/Skills onto `<ResourceList>`. Settings becomes the third pill.
- **Phase 3 — MoreDrawer.** Relocate `<InputComposer>` + `<InstructionList>` behind `<MoreDrawer>`. Remove their primary slots.
- **Phase 4 — Motion pass.** Cross-fade states, drawer `0fr→1fr`, toggle springs, list stagger, hover/focus, `prefers-reduced-motion` guards.
- **Phase 5 — Dark tokens + polish.** B dark variant, spacing pass, empty/loading skeletons.

Each phase is independently shippable and revertible.

## Success Criteria
- All six features still accessible; no behavior regressions (existing tests pass).
- No file in the redesign surface exceeds **250 LOC**.
- Connection status glanceable in one row across all four states.
- Tools/Skills reachable in **≤ 1 tap** from any view.
- Bundle size **does not increase** (CSS-first, zero new runtime deps).
- Every state transition, drawer toggle, and row toggle has visible motion (unless reduced-motion).
- One source of truth for color/radius/spacing (tokens); no ad-hoc hex values in components.

## Risks
- **Regressing existing behavior** — mitigate by keeping stores/hooks/adapters/MCP comm untouched; this is a presentational + IA refactor only. Existing tests (`skill-enablement`, `skill-progressive-disclosure`, `system-tag`, `tool-list`, `filesystem-mcp.integration`) must stay green each phase.
- **Tailwind config drift across packages** — mitigate by putting tokens in the shared `packages/tailwind-config` once.
- **State cross-fade orchestration in pure CSS** — keyed-opacity handles the four connection states; if it gets brittle, opt into Framer Motion (documented ceiling, Phase 4 decision point).
- **Extension CSP / bundle weight** — CSS-first avoids both; no heavy dep introduced.

## Out of Scope (explicit)
- Popup and options-page redesign.
- `SidebarManager` / `BaseSidebarManager` mount/portal refactor (untouched this round).
- New MCP tools, transport changes, background-script logic.
- State-management or adapter-system changes.
