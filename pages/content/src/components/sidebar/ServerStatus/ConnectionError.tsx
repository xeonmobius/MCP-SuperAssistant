import React from 'react';

interface ConnectionErrorProps {
  message: string;
  attempts: number;
  maxAttempts: number;
  onRetry: () => void;
  isRetrying?: boolean;
}

const ConnectionError: React.FC<ConnectionErrorProps> = ({ message, attempts, maxAttempts, onRetry, isRetrying }) => {
  const exhausted = attempts >= maxAttempts && maxAttempts > 0;
  return (
    <div className="sidebar-slide-up mt-2 rounded-card bg-err-soft p-2">
      <code className="block break-all text-[10px] leading-snug text-err font-mono">{message}</code>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] text-muted">
          {maxAttempts === 0
            ? 'Retry (unlimited)'
            : exhausted
              ? `Max retries (${maxAttempts}) reached`
              : `Attempt ${attempts}/${maxAttempts}`}
        </span>
        <button
          type="button"
          onClick={onRetry}
          disabled={exhausted || isRetrying}
          className="ml-auto inline-flex items-center gap-1.5 rounded-pill bg-ink px-2.5 py-1 text-[10px] font-semibold text-surface disabled:opacity-40"
        >
          {isRetrying && (
            <span className="inline-block h-2.5 w-2.5 animate-spin rounded-pill border border-surface/40 border-t-surface" />
          )}
          {isRetrying ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    </div>
  );
};

export default ConnectionError;
