import React from 'react';
import { cn } from '@src/lib/utils';

export interface NavTab {
  id: string;
  label: string;
}

interface SidebarNavProps {
  tabs: NavTab[];
  activeTab: string;
  onChange: (id: string) => void;
}

const SidebarNav: React.FC<SidebarNavProps> = ({ tabs, activeTab, onChange }) => {
  return (
    <div role="tablist" aria-label="Sidebar sections" className="flex gap-1 rounded-card bg-ground p-1">
      {tabs.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              'flex-1 rounded-pill px-2 py-1 text-[11px] font-semibold transition-colors',
              active ? 'bg-surface text-ink shadow-soft' : 'text-muted hover:text-ink',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};

export default SidebarNav;
