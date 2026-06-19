import type { ConnectionStatus } from '@src/types/stores';

export type BadgeVariant = 'ok' | 'con' | 'off' | 'err';

export interface ConnectionState {
  variant: BadgeVariant;
  label: string;
  showSpinner: boolean;
  expandError: boolean;
}

export function getConnectionState(
  status: ConnectionStatus | undefined,
  hasError: boolean,
): ConnectionState {
  switch (status) {
    case 'connected':
      return { variant: 'ok', label: 'Connected', showSpinner: false, expandError: false };
    case 'connecting':
      return { variant: 'con', label: 'Connecting', showSpinner: true, expandError: false };
    case 'reconnecting':
      return { variant: 'con', label: 'Reconnecting', showSpinner: true, expandError: false };
    case 'error':
      return { variant: 'err', label: 'Connection failed', showSpinner: false, expandError: true };
    case 'disconnected':
    default:
      return { variant: 'off', label: 'Disconnected', showSpinner: false, expandError: hasError };
  }
}

export const VARIANT_TAG_CLASS: Record<BadgeVariant, string> = {
  ok: 'bg-ok-soft text-ok',
  con: 'bg-con-soft text-con',
  off: 'bg-off-soft text-off',
  err: 'bg-err-soft text-err',
};
