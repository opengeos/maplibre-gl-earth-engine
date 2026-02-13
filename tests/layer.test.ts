import { describe, expect, it, vi } from 'vitest';
import { renderEeLayer } from '../src/lib/ee/layer';

function createMapMock() {
  const sources = new Map<string, unknown>();
  const layers = new Map<string, unknown>();
  return {
    getSource: (id: string) => sources.get(id),
    getLayer: (id: string) => layers.get(id),
    removeSource: (id: string) => sources.delete(id),
    removeLayer: (id: string) => layers.delete(id),
    addSource: (id: string, src: unknown) => sources.set(id, src),
    addLayer: (layer: { id: string }) => layers.set(layer.id, layer),
  };
}

describe('renderEeLayer', () => {
  it('adds and replaces EE layer cleanly', async () => {
    const map = createMapMock();
    const obj = {
      getMapId: vi.fn((_: unknown, cb: (m: { urlFormat: string }) => void) =>
        cb({ urlFormat: 'https://tiles.example/{z}/{x}/{y}' }),
      ),
    };

    await renderEeLayer(map as never, obj, { opacity: 0.8 }, 'src', 'lyr');
    expect(map.getSource('src')).toBeTruthy();
    expect(map.getLayer('lyr')).toBeTruthy();

    await renderEeLayer(map as never, obj, { opacity: 0.5 }, 'src', 'lyr');
    expect(map.getSource('src')).toBeTruthy();
    expect(map.getLayer('lyr')).toBeTruthy();
    expect(obj.getMapId).toHaveBeenCalledTimes(2);
  });
});
