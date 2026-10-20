import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../../web/src/escape.js';

describe('P0-7: XSS Prevention & HTML Escaping Suite', () => {
  it('neutralizes dangerous script/image execution payloads', () => {
    const maliciousPayload = '<img src=x onerror=alert(1)>';
    const escaped = escapeHtml(maliciousPayload);
    expect(escaped).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
  });

  it('safely escapes C++ template type names', () => {
    const cppTemplate = 'std::vector<int>';
    const escaped = escapeHtml(cppTemplate);
    expect(escaped).toBe('std::vector&lt;int&gt;');
  });

  it('escapes quotes and ampersands in user/repo names', () => {
    expect(escapeHtml('org & "name" <project>')).toBe('org &amp; &quot;name&quot; &lt;project&gt;');
    expect(escapeHtml("it's a test")).toBe('it&#x27;s a test');
  });

  it('handles null, undefined, numbers, and booleans gracefully', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(true)).toBe('true');
  });
});
