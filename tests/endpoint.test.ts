import { describe, expect, it } from 'vitest';
import { parseTileUrlFromResponse } from '../src/lib/ee/endpoint';

describe('parseTileUrlFromResponse', () => {
  it('parses tileUrl directly', () => {
    const tileUrl = parseTileUrlFromResponse({ tileUrl: 'https://tiles/{z}/{x}/{y}' });
    expect(tileUrl).toBe('https://tiles/{z}/{x}/{y}');
  });

  it('parses nested data.urlFormat', () => {
    const tileUrl = parseTileUrlFromResponse({ data: { urlFormat: 'https://nested/{z}/{x}/{y}' } });
    expect(tileUrl).toBe('https://nested/{z}/{x}/{y}');
  });

  it('throws for missing URL fields', () => {
    expect(() => parseTileUrlFromResponse({ ok: true })).toThrow(/missing tileUrl/i);
  });
});
