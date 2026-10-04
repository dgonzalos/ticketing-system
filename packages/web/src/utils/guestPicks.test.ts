import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearGuestPicks, loadGuestPicks, saveGuestPicks } from './guestPicks';

describe('guestPicks', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('round-trips picks per performance', () => {
    saveGuestPicks('perf-1', ['perf-1-A1', 'perf-1-A3']);
    saveGuestPicks('perf-2', ['perf-2-B1']);

    expect(loadGuestPicks('perf-1')).toEqual(['perf-1-A1', 'perf-1-A3']);
    expect(loadGuestPicks('perf-2')).toEqual(['perf-2-B1']);
  });

  it('clears picks, and treats an empty save as a clear', () => {
    saveGuestPicks('perf-1', ['perf-1-A1']);
    clearGuestPicks('perf-1');
    expect(loadGuestPicks('perf-1')).toEqual([]);

    saveGuestPicks('perf-1', ['perf-1-A1']);
    saveGuestPicks('perf-1', []);
    expect(sessionStorage.length).toBe(0);
  });

  it('ignores malformed stored data', () => {
    sessionStorage.setItem('ticketing-guest-picks:perf-1', '{"not":"a list"}');
    expect(loadGuestPicks('perf-1')).toEqual([]);

    sessionStorage.setItem('ticketing-guest-picks:perf-1', '["perf-1-A1", 42, null]');
    expect(loadGuestPicks('perf-1')).toEqual(['perf-1-A1']);

    sessionStorage.setItem('ticketing-guest-picks:perf-1', 'not json');
    expect(loadGuestPicks('perf-1')).toEqual([]);
  });

  it('never throws when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(loadGuestPicks('perf-1')).toEqual([]);
    expect(() => saveGuestPicks('perf-1', ['perf-1-A1'])).not.toThrow();
  });
});
