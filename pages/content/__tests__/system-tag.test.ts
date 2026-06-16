import { describe, it, expect } from 'vitest';
import { extractSystemMessage } from '../src/render_prescript/src/utils/systemTag';

describe('extractSystemMessage', () => {
  it('extracts lowercase <system> body', () => {
    expect(extractSystemMessage('<system>hello world</system>')).toBe('hello world');
  });

  it('extracts uppercase <SYSTEM> body', () => {
    expect(extractSystemMessage('<SYSTEM>hello world</SYSTEM>')).toBe('hello world');
  });

  it('extracts multi-line body and trims whitespace', () => {
    expect(extractSystemMessage('<system>\n  line one\n  line two\n</system>')).toBe('line one\n  line two');
  });

  it('extracts only the tagged region when surrounded by other text', () => {
    expect(extractSystemMessage('before <SYSTEM>keep me</SYSTEM> after')).toBe('keep me');
  });

  it('returns null when there are no system tags', () => {
    expect(extractSystemMessage('just some function result text')).toBeNull();
  });

  it('returns null for an unclosed tag', () => {
    expect(extractSystemMessage('<system>never closed')).toBeNull();
  });
});
