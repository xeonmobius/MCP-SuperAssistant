import type React from 'react';
import type { KeyboardEvent } from 'react';
import { useState } from 'react';
import { Icon, Button } from '../ui';
import { cn } from '@src/lib/utils';
import { createLogger } from '@extension/shared/lib/logger';


const logger = createLogger('InputArea');

interface InputAreaProps {
  onSubmit: (text: string) => void;
}

const InputArea: React.FC<InputAreaProps> = ({ onSubmit }) => {
  const [inputText, setInputText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim()) {
      setIsSubmitting(true);
      try {
        // Format as user input
        const processedText = `<user>\n${inputText}\n</user>`;

        // Wait 200ms before submitting
        await new Promise(resolve => setTimeout(resolve, 300));
        onSubmit(processedText);
        await new Promise(resolve => setTimeout(resolve, 100));
        setInputText('');
      } catch (error) {
        logger.error('Error submitting input:', error);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // If Enter is pressed without Shift, submit the form
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inputText.trim()) {
        handleSubmit(e as unknown as React.FormEvent);
      }
    }
    // If Shift+Enter, allow default behavior (new line)
  };

  return (
    <div className="rounded-card border border-line bg-surface shadow-soft p-3">
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <div className="relative">
            <textarea
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter your text here... (Press Enter to submit, Shift+Enter for new line)"
              className="w-full px-3 py-2 text-sm border border-line rounded-md min-h-[100px] resize-y focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 bg-ground text-ink placeholder:text-muted"
              disabled={isSubmitting}
            />
          </div>
          <Button
            type="submit"
            disabled={isSubmitting || !inputText.trim()}
            className={cn('px-4 py-2 h-9', isSubmitting || !inputText.trim() ? 'opacity-50' : '')}
            variant={isSubmitting || !inputText.trim() ? 'outline' : 'default'}>
            {isSubmitting ? (
              <>
                <Icon name="refresh" size="sm" className="animate-spin mr-2" />
                Submitting...
              </>
            ) : (
              <>
                <Icon name="chevron-right" size="sm" className="mr-1.5" />
                Submit
              </>
            )}
          </Button>
        </form>
    </div>
  );
};

export default InputArea;
