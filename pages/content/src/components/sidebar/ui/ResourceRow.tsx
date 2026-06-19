import React, { useState } from 'react';
import { cn } from '@src/lib/utils';
import Icon from './Icon';

interface ResourceRowProps {
  name: string;
  description?: string;
  isEnabled: boolean;
  onToggle: () => void;
  /** Optional extra detail rendered when expanded (e.g. a tool's schema block). */
  renderDetail?: () => React.ReactNode;
  /** Accessible label suffix for the toggle. */
  kindLabel?: string;
}

const ResourceRow: React.FC<ResourceRowProps> = ({
  name,
  description,
  isEnabled,
  onToggle,
  renderDetail,
  kindLabel = 'item',
}) => {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = Boolean(description || renderDetail);

  return (
    <div className={cn('rounded-row', !isEnabled && 'opacity-60')}>
      <div className="flex items-center gap-2 py-1.5">
        {hasDetail && (
          <button
            type="button"
            aria-label={expanded ? `Collapse ${name}` : `Expand ${name}`}
            aria-expanded={expanded}
            onClick={() => setExpanded((e) => !e)}
            className="text-muted hover:text-ink"
          >
            <Icon name="chevron-right" className={cn('transition-transform', expanded && 'rotate-90')} />
          </button>
        )}
        <input
          type="checkbox"
          checked={isEnabled}
          onChange={onToggle}
          aria-label={`Toggle ${kindLabel} ${name}`}
          className="h-3.5 w-3.5 accent-[var(--accent-from)]"
        />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">{name}</span>
        {!isEnabled && <span className="text-[10px] text-off">Disabled</span>}
      </div>
      {expanded && hasDetail && (
        <div className="pb-2 pl-7 text-[11px] leading-snug text-muted">
          {description || 'No description available.'}
          {renderDetail?.()}
        </div>
      )}
    </div>
  );
};

export default ResourceRow;
