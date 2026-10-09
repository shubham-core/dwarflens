import { describe, it, expect } from 'vitest';
import { pool } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';

describe('P0-6: Database Pool Hardening, TLS Verification & Startup Migrations', () => {
  it('has an error event listener attached to the pg pool to prevent unhandled process crashes', () => {
    const listeners = pool.listeners('error');
    expect(listeners.length).toBeGreaterThan(0);
  });

  it('exports runMigrations function for server startup execution', () => {
    expect(typeof runMigrations).toBe('function');
  });
});
