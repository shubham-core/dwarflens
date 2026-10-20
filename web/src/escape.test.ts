import { describe, it, expect } from 'vitest';
import { escapeHtml } from './escape.js';

describe('P0-7: XSS Prevention & HTML Escaping', () => {
  it('escapes dangerous HTML tags and script injections', () => {
    const payload = '<img src=x onerror=alert(1)>';
    expect(escapeHtml(payload)).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes C++ template syntax and ampersands without breaking display', () => {
    expect(escapeHtml('std::vector<int>')).toBe('std::vector&lt;int&gt;');
    expect(escapeHtml('Foo & Bar <T>')).toBe('Foo &amp; Bar &lt;T&gt;');
  });

  it('handles quotes and special characters', () => {
    expect(escapeHtml('Hello "World" and \'test\'')).toBe('Hello &quot;World&quot; and &#x27;test&#x27;');
  });

  it('safely handles null, undefined, and non-string types', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(12345)).toBe('12345');
  });
});
