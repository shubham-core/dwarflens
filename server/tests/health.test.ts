import { describe, it, expect } from 'vitest';
import { app } from '../src/app.js';

describe('GET /health', () => {
  it('returns status ok with timestamp', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.status).toBe('ok');
    expect(json.version).toBe('0.1.0');
    expect(json.timestamp).toBeDefined();
  });
});
