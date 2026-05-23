# Skills Management UI

## Problem
Skills (skill_* pseudo-tools) are mixed into the MCP tools list with no visual distinction. User wants a dedicated section to see which skills are detected and enable/disable them independently.

## Design

### New Components
- `AvailableSkills` — collapsible card in sidebar, mirrors AvailableTools pattern
- `useSkillStore` — Zustand store for skill enablement state

### Storage
- Key: `mcp_skill_enablement` in chrome.storage.local
- Format: string array of enabled skill names
- Default: all skills enabled

### Filtering
- AvailableTools filters out skill_* tools
- Only enabled skills are included as pseudo-tools in mcp:get-tools response

### Files Changed
- NEW: pages/content/src/stores/skill.store.ts
- NEW: pages/content/src/components/sidebar/AvailableSkills/AvailableSkills.tsx
- NEW: chrome-extension/src/skills/__tests__/skill-store.test.ts
- MOD: pages/content/src/components/sidebar/AvailableTools/AvailableTools.tsx (filter skills)
- MOD: pages/content/src/components/sidebar/Sidebar.tsx (add AvailableSkills)
- MOD: chrome-extension/src/background/index.ts (respect skill enablement)
- MOD: pages/content/src/hooks/useStores.ts (export useSkillEnablement)
