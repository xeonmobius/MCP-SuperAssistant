import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { getSkillEnablementStateDetailed, saveSkillEnablementState } from '../utils/storage';
import { createLogger } from '@extension/shared/lib/logger';

const logger = createLogger('useSkillStore');

export interface SkillItem {
  name: string;
  description: string;
}

export interface SkillState {
  availableSkills: SkillItem[];
  enabledSkills: Set<string>;
  isLoadingEnablement: boolean;
  /**
   * Bumped on every local enable/disable mutation. `loadSkillEnablementState`
   * captures this before its async storage read and aborts the apply if the
   * value changed, so a toggle made while a load is in flight is not clobbered
   * by stale stored data.
   */
  loadGeneration: number;

  setAvailableSkills: (skills: SkillItem[]) => void;
  enableSkill: (name: string) => void;
  disableSkill: (name: string) => void;
  enableAllSkills: () => void;
  disableAllSkills: () => void;
  isSkillEnabled: (name: string) => boolean;
  loadSkillEnablementState: () => Promise<void>;
}

export const useSkillStore = create<SkillState>()(
  devtools(
    (set, get) => ({
      availableSkills: [],
      enabledSkills: new Set(),
      isLoadingEnablement: false,
      loadGeneration: 0,

      setAvailableSkills: (skills: SkillItem[]) => {
        set(state => {
          // Clean up enabledSkills: remove names no longer in availableSkills.
          const availableNames = new Set(skills.map(s => s.name));
          const cleanedEnabled = new Set(
            [...state.enabledSkills].filter(name => availableNames.has(name))
          );
          return { availableSkills: skills, enabledSkills: cleanedEnabled };
        });
        logger.debug(`[SkillStore] Available skills updated: ${skills.length}`);
        get().loadSkillEnablementState();
      },

      enableSkill: (name: string) => {
        set(state => {
          const newSet = new Set([...state.enabledSkills, name]);
          saveSkillEnablementState(newSet).catch(err =>
            logger.error('[SkillStore] Failed to save skill enablement:', err)
          );
          return { enabledSkills: newSet, loadGeneration: state.loadGeneration + 1 };
        });
      },

      disableSkill: (name: string) => {
        set(state => {
          const newSet = new Set(state.enabledSkills);
          newSet.delete(name);
          saveSkillEnablementState(newSet).catch(err =>
            logger.error('[SkillStore] Failed to save skill enablement:', err)
          );
          return { enabledSkills: newSet, loadGeneration: state.loadGeneration + 1 };
        });
      },

      enableAllSkills: () => {
        set(state => {
          const newSet = new Set(state.availableSkills.map(s => s.name));
          saveSkillEnablementState(newSet).catch(err =>
            logger.error('[SkillStore] Failed to save skill enablement:', err)
          );
          return { enabledSkills: newSet, loadGeneration: state.loadGeneration + 1 };
        });
      },

      disableAllSkills: () => {
        const newSet = new Set<string>();
        saveSkillEnablementState(newSet).catch(err =>
          logger.error('[SkillStore] Failed to save skill enablement:', err)
        );
        set(state => ({ enabledSkills: newSet, loadGeneration: state.loadGeneration + 1 }));
      },

      isSkillEnabled: (name: string): boolean => {
        return get().enabledSkills.has(name);
      },

      loadSkillEnablementState: async () => {
        set({ isLoadingEnablement: true });
        const myGeneration = get().loadGeneration;
        try {
          const detailed = await getSkillEnablementStateDetailed();
          const state = get();

          // A toggle happened while we were reading — do NOT overwrite it.
          if (state.loadGeneration !== myGeneration) {
            set({ isLoadingEnablement: false });
            return;
          }

          // Storage read failed: keep current in-memory state, do not default-on.
          if (detailed.error) {
            set({ isLoadingEnablement: false });
            return;
          }

          // Never saved before -> default all available skills ON.
          // Saved as `[]` (explicitly disabled all) is preserved as-is.
          if (!detailed.hasSavedState && state.availableSkills.length > 0) {
            const allEnabled = new Set(state.availableSkills.map(s => s.name));
            set({ enabledSkills: allEnabled, isLoadingEnablement: false });
            await saveSkillEnablementState(allEnabled);
          } else {
            set({ enabledSkills: detailed.set, isLoadingEnablement: false });
            logger.debug(`[SkillStore] Loaded ${detailed.set.size} enabled skills`);
          }
        } catch (error) {
          logger.error('[SkillStore] Failed to load skill enablement:', error);
          set({ isLoadingEnablement: false });
        }
      },
    }),
    { name: 'SkillStore', store: 'skill' }
  )
);
