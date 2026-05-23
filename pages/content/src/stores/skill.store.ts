import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { getSkillEnablementState, saveSkillEnablementState } from '../utils/storage';
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

      setAvailableSkills: (skills: SkillItem[]) => {
        set({ availableSkills: skills });
        logger.debug(`[SkillStore] Available skills updated: ${skills.length}`);
        get().loadSkillEnablementState();
      },

      enableSkill: (name: string) => {
        set(state => {
          const newSet = new Set([...state.enabledSkills, name]);
          saveSkillEnablementState(newSet).catch(err =>
            logger.error('[SkillStore] Failed to save skill enablement:', err)
          );
          return { enabledSkills: newSet };
        });
      },

      disableSkill: (name: string) => {
        set(state => {
          const newSet = new Set(state.enabledSkills);
          newSet.delete(name);
          saveSkillEnablementState(newSet).catch(err =>
            logger.error('[SkillStore] Failed to save skill enablement:', err)
          );
          return { enabledSkills: newSet };
        });
      },

      enableAllSkills: () => {
        set(state => {
          const newSet = new Set(state.availableSkills.map(s => s.name));
          saveSkillEnablementState(newSet).catch(err =>
            logger.error('[SkillStore] Failed to save skill enablement:', err)
          );
          return { enabledSkills: newSet };
        });
      },

      disableAllSkills: () => {
        const newSet = new Set<string>();
        saveSkillEnablementState(newSet).catch(err =>
          logger.error('[SkillStore] Failed to save skill enablement:', err)
        );
        set({ enabledSkills: newSet });
      },

      isSkillEnabled: (name: string): boolean => {
        return get().enabledSkills.has(name);
      },

      loadSkillEnablementState: async () => {
        set({ isLoadingEnablement: true });
        try {
          const stored = await getSkillEnablementState();
          const state = get();

          if (stored.size === 0 && state.availableSkills.length > 0) {
            const allEnabled = new Set(state.availableSkills.map(s => s.name));
            set({ enabledSkills: allEnabled, isLoadingEnablement: false });
            await saveSkillEnablementState(allEnabled);
          } else {
            set({ enabledSkills: stored, isLoadingEnablement: false });
            logger.debug(`[SkillStore] Loaded ${stored.size} enabled skills`);
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
