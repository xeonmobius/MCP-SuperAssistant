import React from 'react';
import { useConnectionStatus } from '@src/hooks';
import { useMcpCommunication } from '@src/hooks/useMcpCommunication';
import { getConnectionState, VARIANT_TAG_CLASS } from './connectionState';
import ConnectionError from './ConnectionError';

const ConnectionBadge: React.FC = () => {
  const { status, isReconnecting, error, serverConfig, connectionAttempts, maxRetryAttempts } =
    useConnectionStatus();
  const { forceReconnect } = useMcpCommunication();

  const state = getConnectionState(status, Boolean(error));
  const serverName = serverConfig?.uri || 'MCP server';
  const showRetryButton = state.variant === 'off';

  return (
    <div className="rounded-card bg-surface p-2.5 shadow-soft">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={[
            'inline-block h-2.5 w-2.5 shrink-0 rounded-pill',
            state.variant === 'ok' ? 'bg-ok' : '',
            state.variant === 'con' ? 'bg-con' : '',
            state.variant === 'off' ? 'bg-off' : '',
            state.variant === 'err' ? 'bg-err' : '',
          ].join(' ').trim()}
        />
        <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-ink">{serverName}</span>

        {state.showSpinner && (
          <span
            aria-label={isReconnecting ? 'Reconnecting' : 'Connecting'}
            className="inline-block h-3 w-3 animate-spin rounded-pill border-2 border-con-soft border-t-con"
          />
        )}

        <span className={`rounded-pill px-2 py-0.5 text-[9px] font-bold ${VARIANT_TAG_CLASS[state.variant]}`}>
          {state.label}
        </span>

        {showRetryButton && (
          <button
            type="button"
            onClick={forceReconnect}
            className="rounded-pill bg-off-soft px-2 py-0.5 text-[10px] font-semibold text-ink"
          >
            Reconnect
          </button>
        )}
      </div>

      {state.expandError && error ? (
        <ConnectionError
          message={String(error)}
          attempts={connectionAttempts}
          maxAttempts={maxRetryAttempts}
          onRetry={forceReconnect}
        />
      ) : null}
    </div>
  );
};

export default ConnectionBadge;
