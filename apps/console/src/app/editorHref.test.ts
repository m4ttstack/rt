import { describe, expect, it } from 'vitest';

import { editorScheme } from './editorHref';

describe('editorScheme', () => {
  it('maps editor ids to their URL schemes', () => {
    expect(editorScheme('code')).toBe('vscode');
    expect(editorScheme('cursor')).toBe('cursor');
    expect(editorScheme('zed')).toBe('zed');
    expect(editorScheme('codium')).toBe('vscodium');
    expect(editorScheme('windsurf')).toBe('windsurf');
  });

  it('maps a full open -a command by its app label', () => {
    expect(editorScheme('open -a "Zed"')).toBe('zed');
    expect(editorScheme('open -a "Visual Studio Code"')).toBe('vscode');
    expect(editorScheme('open -a "Cursor"')).toBe('cursor');
  });

  it('falls back to vscode for unset or unknown editors', () => {
    expect(editorScheme(null)).toBe('vscode');
    expect(editorScheme(undefined)).toBe('vscode');
    expect(editorScheme('')).toBe('vscode');
    expect(editorScheme('emacsclient')).toBe('vscode');
    expect(editorScheme('open -a "Sublime Text"')).toBe('vscode');
  });

  it('falls back to vscode for a non-string value instead of throwing', () => {
    expect(editorScheme(5 as unknown as string)).toBe('vscode');
    expect(editorScheme({} as unknown as string)).toBe('vscode');
  });
});
