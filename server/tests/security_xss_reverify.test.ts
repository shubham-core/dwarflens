import { describe, it, expect, beforeAll } from 'vitest';
import { Window } from 'happy-dom';
import { renderProjectCardHtml, renderTopSymbolDeltaHtml } from '../../web/src/dashboard.js';
import { renderSymbolRowHtml } from '../../web/src/main.js';
import { escapeHtml } from '../../web/src/escape.js';

describe('R7: Re-verify XSS Escaping on Real Render Functions', () => {
  let window: Window;
  let document: any;

  beforeAll(() => {
    window = new Window();
    document = window.document;
  });

  it('renders a project named "<img src=x onerror=alert(1)>" without element/attribute injection and keeps text visible', () => {
    const xssProject = {
      id: 'proj-xss-test-1',
      name: '<img src=x onerror=alert(1)>',
      repo: 'user/<svg onload=alert(2)>',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };

    const container = document.createElement('div');
    container.innerHTML = renderProjectCardHtml(xssProject);

    // 1. Assert no <img> or <svg> elements were created
    const imgEl = container.querySelector('img');
    const svgEl = container.querySelector('svg');
    expect(imgEl).toBeNull();
    expect(svgEl).toBeNull();

    // 2. Assert no onerror or onload attributes exist anywhere in the subtree
    const allElements = container.querySelectorAll('*');
    for (const el of allElements) {
      expect(el.getAttribute('onerror')).toBeNull();
      expect(el.getAttribute('onload')).toBeNull();
    }

    // 3. Assert the literal text is visible to the user
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.textContent).toContain('user/<svg onload=alert(2)>');
  });

  it('renders a symbol named "std::vector<int>" without element injection and keeps text visible', () => {
    const cppSymbol = {
      name: 'std::vector<int>',
      raw_name: '_ZSt11vector_int',
      template_group: 'vector<int>',
      section: '.text',
      type: 'FUNC',
      compile_unit: 'src/<vector>.cpp',
      size: 1024,
    };

    const container = document.createElement('tr');
    container.innerHTML = renderSymbolRowHtml(cppSymbol);

    // 1. Assert <int> was not parsed as a DOM element
    const intElement = container.querySelector('int');
    expect(intElement).toBeNull();
    const vectorElement = container.querySelector('vector');
    expect(vectorElement).toBeNull();

    // 2. Assert the literal text is visible in the textContent
    expect(container.textContent).toContain('std::vector<int>');
    expect(container.textContent).toContain('Template: vector<int>');
    expect(container.textContent).toContain('src/<vector>.cpp');
  });

  it('renders a symbol delta named "std::vector<int>" in compare view without injection and keeps text visible', () => {
    const delta = {
      name: 'std::vector<int>',
      status: 'added',
      base_size: 0,
      head_size: 2048,
      delta: 2048,
    };

    const container = document.createElement('tbody');
    container.innerHTML = renderTopSymbolDeltaHtml(delta);

    // 1. Assert <int> was not parsed as a DOM element
    const intElement = container.querySelector('int');
    expect(intElement).toBeNull();

    // 2. Assert literal text is visible
    expect(container.textContent).toContain('std::vector<int>');
  });

  it('verifies escapeHtml helper correctly escapes all sensitive HTML characters', () => {
    const raw = '& < > " \' /';
    const escaped = escapeHtml(raw);
    expect(escaped).toBe('&amp; &lt; &gt; &quot; &#x27; /');
  });
});
