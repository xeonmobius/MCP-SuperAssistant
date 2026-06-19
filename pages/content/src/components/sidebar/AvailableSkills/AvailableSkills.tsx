import { useState } from 'react';
import { useSkillEnablement } from '@src/hooks/useStores';
import { Typography, Icon, ResourceRow } from '../ui';
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
          <Icon name="lightning" size="sm" className="text-amber-500" />
          <Typography variant="h4" className="font-semibold text-ink">
            Available Skills
          </Typography>
        </div>
        <Typography variant="small" className="text-muted">
          No skills detected. Configure skills directories in Server Settings and ensure @modelcontextprotocol/server-filesystem is in your proxy config.
        </Typography>
      </div>
    );
  }

  return (
    <div className={cn('rounded-card border border-line bg-surface shadow-soft divide-y divide-line', className)}>
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-off-soft transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center gap-2">
          <Icon
            name="chevron-right"
            size="sm"
            className={cn('transition-transform duration-200 text-muted', isExpanded && 'rotate-90')}
          />
          <Icon name="lightning" size="sm" className="text-amber-500" />
          <Typography variant="h4" className="font-semibold text-ink">
            Available Skills
          </Typography>
          <span className="text-xs bg-off-soft text-off px-2 py-0.5 rounded-full">
            {enabledCount}/{totalCount}
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className="px-4 py-2">
          <div className="flex gap-2 mb-2">
            <button
              onClick={enableAllSkills}
              className="text-xs px-2 py-1 rounded bg-off-soft hover:bg-off text-off transition-colors">
              Enable All
            </button>
            <button
              onClick={disableAllSkills}
              className="text-xs px-2 py-1 rounded bg-off-soft hover:bg-off text-off transition-colors">
              Disable All
            </button>
          </div>

          <div className="space-y-0 divide-y divide-line">
            {availableSkills.map(skill => (
              <ResourceRow
                key={skill.name}
                name={skill.name}
                description={skill.description}
                isEnabled={isSkillEnabled(skill.name)}
                onToggle={() => handleToggleSkill(skill.name)}
                kindLabel="skill"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AvailableSkills;
