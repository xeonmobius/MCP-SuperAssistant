// pages/content/src/components/sidebar/MoreDrawer/MoreDrawer.tsx
import React, { useState } from 'react';
import { cn } from '@src/lib/utils';
import { Icon } from '../ui';
import InputArea from '../InputArea/InputArea';
import InstructionManager from '../Instructions/InstructionManager';

interface MoreDrawerProps {
  /** Called when the user submits the input textarea. */
  onSubmitInput: (text: string) => void;
  /** Legacy adapter object passed through to InstructionManager. */
  adapter: any;
  /** Formatted tools list passed through to InstructionManager. */
  tools: Array<{ name: string; schema: string; description: string }>;
}

const MoreDrawer: React.FC<MoreDrawerProps> = ({ onSubmitInput, adapter, tools }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex-shrink-0 border-t border-line bg-ground">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="more-drawer-content"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-off-soft"
      >
        <Icon
          name="chevron-down"
          className={cn('text-muted transition-transform duration-200', open && 'rotate-180')}
        />
        <span className="text-[11px] font-semibold text-ink">More</span>
        <span className="ml-auto text-[10px] text-muted">Input &amp; Instructions</span>
      </button>

      {/* ponytail: grid-rows 0fr->1fr animates height without JS measurement and
          WITHOUT unmounting children — InstructionManager must stay mounted
          (instructionsState singleton + 500ms poll feed MCPPopover). */}
      <div
        id="more-drawer-content"
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="max-h-[50vh] space-y-3 overflow-y-auto px-4 pb-4 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-600">
            <section>
              <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Insert into chat
              </h4>
              <InputArea onSubmit={onSubmitInput} />
            </section>
            <section>
              <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Instructions
              </h4>
              <InstructionManager adapter={adapter} tools={tools} />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MoreDrawer;
