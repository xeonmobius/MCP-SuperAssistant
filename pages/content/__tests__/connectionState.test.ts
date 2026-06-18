import { describe, it, expect } from 'vitest';
import { getConnectionState } from '../src/components/sidebar/ServerStatus/connectionState';
import type { ConnectionStatus } from '../src/types/stores';

describe('getConnectionState', () => {
  it('maps connected to the ok variant with no spinner', () => {
    const s = getConnectionState('connected', false);
    expect(s.variant).toBe('ok');
    expect(s.label).toBe('Connected');
    expect(s.showSpinner).toBe(false);
    expect(s.expandError).toBe(false);
  });

  it('maps connecting to the con variant with a spinner', () => {
    const s = getConnectionState('connecting', false);
    expect(s.variant).toBe('con');
    expect(s.showSpinner).toBe(true);
    expect(s.expandError).toBe(false);
  });

  it('maps reconnecting to the con variant, labelled Reconnecting, with a spinner', () => {
    const s = getConnectionState('reconnecting', false);
    expect(s.variant).toBe('con');
    expect(s.label).toBe('Reconnecting');
    expect(s.showSpinner).toBe(true);
  });

  it('maps disconnected to the off variant with no error expansion', () => {
    const s = getConnectionState('disconnected', false);
    expect(s.variant).toBe('off');
    expect(s.label).toBe('Disconnected');
    expect(s.expandError).toBe(false);
  });

  it('maps error to the err variant and expands the error detail', () => {
    const s = getConnectionState('error', true);
    expect(s.variant).toBe('err');
    expect(s.label).toBe('Connection failed');
    expect(s.expandError).toBe(true);
  });

  it('treats an undefined status defensively as disconnected', () => {
    const s = getConnectionState(undefined as unknown as ConnectionStatus, false);
    expect(s.variant).toBe('off');
    expect(s.label).toBe('Disconnected');
  });
});
