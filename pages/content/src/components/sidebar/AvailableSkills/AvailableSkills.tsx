import { useState } from 'react';
import { useSkillEnablement } from '@src/hooks/useStores';
import { Typography, Icon } from '../ui';
import { cn } from '@src/lib/utils';
import { logMessage } from '@src/utils/helpers';

interface AvailableSkillsProps {
  className?: string;
}

const AvailableSkills: React.FC<AvailableSkillsProps> = ({ className }) => {
  const {
    availableSkills,
    enabledSkills,
    enableSkill,
    disableSkill,
    enableAllSkills,
    disableAllSkills,
    isSkillEnabled,
  } = useSkillEnablement();

  const [isExpanded, setIsExpanded] = useState(true);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);

  const enabledCount = availableSkills.filter(s => isSkillEnabled(s.name)).length;
  const totalCount = availableSkills.length;

  const handleToggleSkill = (name: string) => {
    if (isSkillEnabled(name)) {
      disableSkill(name);
    } else {
      enableSkill(name);
    }
  };

  if (totalCount === 0) {
    return (
      <div className={cn('p-4', className)}>
        <div className="flex items-center gap-2 mb-2">
          <Icon name="zap" size="sm" className="text-amber-500" />
          <Typography variant="h4" className="font-semibold text-slate-800 dark:text-slate-100">
            Available Skills
          </Typography>
        </div>
        <Typography variant="small" className="text-slate-500 dark:text-slate-400">
          No skills detected. Configure skills directories in Server Settings and ensure @modelcontextprotocol/server-filesystem is in your proxy config.
        </Typography>
      </div>
    );
  }

  return (
    <div className={cn('divide-y divide-slate-200 dark:divide-slate-700', className)}>
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center gap-2">
          <Icon
            name="chevron-right"
            size="sm"
            className={cn('transition-transform duration-200', isExpanded && 'rotate-90')}
          />
          <Icon name="zap" size="sm" className="text-amber-500" />
          <Typography variant="h4" className="font-semibold text-slate-800 dark:text-slate-100">
            Available Skills
          </Typography>
          <span className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">
            {enabledCount}/{totalCount}
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className="px-4 py-2">
          <div className="flex gap-2 mb-2">
            <button
              onClick={enableAllSkills}
              className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 transition-colors">
              Enable All
            </button>
            <button
              onClick={disableAllSkills}
              className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 transition-colors">
              Disable All
            </button>
          </div>

          <div className="space-y-0 divide-y divide-slate-100 dark:divide-slate-700/50">
            {availableSkills.map(skill => {
              const isEnabled = isSkillEnabled(skill.name);
              const isExpandedDetail = expandedSkill === skill.name;

              return (
                <div key={skill.name} className="first:rounded-t-lg last:rounded-b-lg">
                  <div
                    className="flex items-center gap-2 py-2 px-1 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/30 rounded transition-colors"
                    onClick={() => setExpandedSkill(isExpandedDetail ? null : skill.name)}>
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={() => handleToggleSkill(skill.name)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-3.5 h-3.5 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                    <Icon
                      name="chevron-right"
                      size="sm"
                      className={cn(
                        'w-3 h-3 transition-transform duration-200 text-slate-400',
                        isExpandedDetail && 'rotate-90'
                      )}
                    />
                    <span className={cn(
                      'text-sm flex-1 truncate',
                      isEnabled ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'
                    )}>
                      {skill.name}
                    </span>
                    {!isEnabled && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                        Disabled
                      </span>
                    )}
                  </div>

                  {isExpandedDetail && (
                    <div className="pl-10 pr-2 pb-2">
                      <Typography variant="small" className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed">
                        {skill.description || 'No description available.'}
                      </Typography>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default AvailableSkills;
