# Fix: Skills Paths UI Resets to Defaults

## Problem

The Skills Directories textarea in Server Settings instantly resets to defaults whenever the user types. The user cannot edit or save custom skills paths.

## Root Cause

`ServerStatus.tsx:317-324` — the useEffect that fetches skills paths has `[communicationMethods]` as a dependency. The `communicationMethods` object is a new reference every render (return value of `useMcpCommunication()`), so the effect fires on every render, overwriting user input with stored/default values.

Secondary issue: no `isEditingSkillsPaths` guard exists (unlike `isEditingUri` and `isEditingConnectionType` for the other fields).

## Fix

Mirror the existing pattern used for URI and connection type fields:

1. Add `isEditingSkillsPaths` boolean state
2. Set true on textarea onChange/onFocus
3. Guard useEffect — skip `setSkillsPathsInput` when editing
4. Run useEffect once on mount (`[]` dependency)
5. Reset `isEditingSkillsPaths` on save or cancel
6. In Cancel button, reset textarea from stored `skillsPaths`

## Files Changed

- `pages/content/src/components/sidebar/ServerStatus/ServerStatus.tsx`

## Tests

- Unit test: useEffect does not overwrite textarea when `isEditingSkillsPaths` is true
- Unit test: "Save Paths" persists to storage and resets editing flag
- Unit test: Cancel resets textarea to last saved value
- Unit test: initial load populates textarea from storage (or defaults)
