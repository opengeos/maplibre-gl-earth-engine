import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateWithOAuth: vi.fn(async () => ({
    ok: true,
    authenticated: true,
    message: 'Authenticated.',
  })),
  reduceRegion: vi.fn(() => ({
    evaluate: (success: (value: unknown) => void) => success({ B1: 42 }),
  })),
  eeImage: vi.fn((assetId: string) => ({
    assetId,
    type: 'Image',
    reduceRegion: (params: Record<string, unknown>) => mocks.reduceRegion(params),
  })),
  eePoint: vi.fn((coordinates: [number, number]) => ({ coordinates, type: 'Point' })),
  eeReducerFirst: vi.fn(() => ({ type: 'Reducer.first' })),
  renderEeLayer: vi.fn(async (_map: unknown, input: string | object) => ({
    sourceId: 'src',
    layerId: 'lyr',
    tileUrl: 'https://tiles.example/{z}/{x}/{y}',
    eeObject: typeof input === 'string' ? mocks.eeImage(input) : input,
  })),
}));

vi.mock('@google/earthengine', () => ({
  default: {
    Image: mocks.eeImage,
    Geometry: {
      Point: mocks.eePoint,
    },
    Reducer: {
      first: mocks.eeReducerFirst,
    },
  },
}));

vi.mock('../src/lib/ee/auth', () => ({ authenticateWithOAuth: mocks.authenticateWithOAuth }));
vi.mock('../src/lib/ee/layer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/ee/layer')>();
  return {
    ...actual,
    renderEeLayer: mocks.renderEeLayer,
  };
});

import { PluginControl } from '../src/lib/core/PluginControl';

function createMapMock(container: HTMLElement) {
  return {
    getContainer: () => container,
    getLayer: vi.fn(() => false),
    getCenter: vi.fn(() => ({ lng: -122, lat: 37 })),
    getZoom: vi.fn(() => 9),
    getBounds: vi.fn(() => ({
      getWest: () => -123,
      getSouth: () => 36,
      getEast: () => -121,
      getNorth: () => 38,
    })),
    setCenter: vi.fn(),
    jumpTo: vi.fn(),
    fitBounds: vi.fn(),
    setLayoutProperty: vi.fn(),
    setPaintProperty: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
}

afterEach(() => {
  mocks.authenticateWithOAuth.mockClear();
  mocks.reduceRegion.mockClear();
  mocks.renderEeLayer.mockClear();
  document.body.replaceChildren();
  sessionStorage.clear();
  delete (globalThis as { strippedFeatureGeometry?: boolean }).strippedFeatureGeometry;
  delete (globalThis as { usedFirstFeatureDictionary?: boolean }).usedFirstFeatureDictionary;
});

describe('PluginControl', () => {
  it('marks the container and panel with package-unique scope classes', () => {
    const mapContainer = document.createElement('div');
    document.body.appendChild(mapContainer);

    const control = new PluginControl({ collapsed: true, className: 'custom-class' });
    const container = control.onAdd(createMapMock(mapContainer) as never);

    expect(container.classList.contains('plugin-control')).toBe(true);
    expect(container.classList.contains('earth-engine-control')).toBe(true);
    // User-supplied className option is preserved alongside the marker class.
    expect(container.classList.contains('custom-class')).toBe(true);

    const panel = document.querySelector<HTMLElement>('.plugin-control-panel');
    expect(panel).toBeTruthy();
    expect(panel!.classList.contains('earth-engine-panel')).toBe(true);

    control.onRemove();
  });

  it('uses the Auth tab project ID when no project ID option is configured', async () => {
    const mapContainer = document.createElement('div');
    document.body.appendChild(mapContainer);

    const control = new PluginControl({
      collapsed: true,
      oauthClientId: 'oauth-client',
      projectId: '',
    });
    control.onAdd(createMapMock(mapContainer) as never);

    const project = document.querySelector<HTMLInputElement>('input[placeholder="Google Cloud project ID"]');
    expect(project).toBeTruthy();
    project!.value = 'auth-tab-project';

    await control.loadAsset('USGS/SRTMGL1_003', {});

    expect(mocks.authenticateWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        oauthClientId: 'oauth-client',
        projectId: 'auth-tab-project',
      }),
    );
    expect(mocks.renderEeLayer).toHaveBeenCalled();
  });

  it('runs Earth Engine Code Editor style scripts that use Map.addLayer', async () => {
    const mapContainer = document.createElement('div');
    document.body.appendChild(mapContainer);

    const map = createMapMock(mapContainer);
    const control = new PluginControl({
      collapsed: true,
      oauthClientId: 'oauth-client',
      projectId: 'ee-project',
    });
    control.onAdd(map as never);

    await control.runScript(
      `
        var image = ee.Image('LANDSAT/LC08/C02/T1_TOA/LC08_044034_20140318');
        var vizParams = {
          bands: ['B5', 'B4', 'B3'],
          min: 0,
          max: 0.5,
          gamma: [0.95, 1.1, 1]
        };
        Map.setCenter(-122.1899, 37.5010, 10);
        Map.addLayer(image, vizParams, 'false color composite', false, 0.4);
      `,
      {},
    );

    expect(map.jumpTo).toHaveBeenCalledWith({ center: [-122.1899, 37.501], zoom: 10 });
    expect(mocks.authenticateWithOAuth).toHaveBeenCalledOnce();
    expect(mocks.renderEeLayer).toHaveBeenCalledWith(
      map,
      expect.anything(),
      {
        bands: ['B5', 'B4', 'B3'],
        min: 0,
        max: 0.5,
        gamma: [0.95, 1.1, 1],
        opacity: 0.4,
      },
      expect.stringMatching(/-source$/),
      expect.stringMatching(/-layer$/),
    );
  });

  it('keeps return-based scripts compatible', async () => {
    const mapContainer = document.createElement('div');
    document.body.appendChild(mapContainer);

    const map = createMapMock(mapContainer);
    const control = new PluginControl({
      collapsed: true,
      oauthClientId: 'oauth-client',
      projectId: 'ee-project',
    });
    control.onAdd(map as never);

    await control.runScript("return ee.Image('USGS/SRTMGL1_003');", { palette: 'black,white' });

    expect(mocks.renderEeLayer).toHaveBeenCalledWith(
      map,
      expect.anything(),
      { palette: 'black,white' },
      expect.stringMatching(/-source$/),
      expect.stringMatching(/-layer$/),
    );
  });

  it('inspects pixels from selected added layers instead of script textareas', async () => {
    const mapContainer = document.createElement('div');
    document.body.appendChild(mapContainer);

    const map = createMapMock(mapContainer);
    const control = new PluginControl({
      collapsed: true,
      oauthClientId: 'oauth-client',
      projectId: 'ee-project',
    });
    control.onAdd(map as never);

    await control.loadAsset('USGS/SRTMGL1_003', {});

    const inspectorPanel = document.querySelector<HTMLElement>('.plugin-tab-panel[data-tab="inspector"]');
    expect(inspectorPanel).toBeTruthy();
    expect(inspectorPanel!.querySelector('textarea')).toBeNull();

    const layerSelect = inspectorPanel!.querySelector<HTMLSelectElement>('select');
    expect(layerSelect).toBeTruthy();
    expect(layerSelect!.value).toBeTruthy();
    expect(layerSelect!.selectedOptions[0].textContent).toBe('USGS/SRTMGL1_003');

    await (control as unknown as { _inspectPixelAt: (lon: number, lat: number) => Promise<void> })._inspectPixelAt(
      -122.292,
      37.901,
    );

    expect(mocks.reduceRegion).toHaveBeenCalledWith(
      expect.objectContaining({
        geometry: { coordinates: [-122.292, 37.901], type: 'Point' },
        scale: 30,
      }),
    );
    expect(inspectorPanel!.querySelector('pre')?.textContent).toContain('"layer": "USGS/SRTMGL1_003"');
    expect(inspectorPanel!.querySelector('pre')?.textContent).toContain('"B1": 42');
  });

  it('surfaces Earth Engine evaluation errors from point inspection', async () => {
    const mapContainer = document.createElement('div');
    document.body.appendChild(mapContainer);

    const map = createMapMock(mapContainer);
    const control = new PluginControl({
      collapsed: true,
      oauthClientId: 'oauth-client',
      projectId: 'ee-project',
    });
    control.onAdd(map as never);

    await control.loadAsset('USGS/SRTMGL1_003', {});

    // The real ee evaluate() invokes a single callback as callback(value, error).
    mocks.reduceRegion.mockReturnValueOnce({
      evaluate: (callback: (value: unknown, error?: unknown) => void) =>
        callback(undefined, 'Image.reduceRegion: User memory limit exceeded.'),
    });

    await (control as unknown as { _inspectPixelAt: (lon: number, lat: number) => Promise<void> })._inspectPixelAt(
      -122.292,
      37.901,
    );

    const status = document.querySelector('.plugin-control-status')?.textContent ?? '';
    expect(status).toContain('Point inspect failed');
    expect(status).toContain('User memory limit exceeded');
  });

  it('inspects feature collection layers at the clicked point', async () => {
    const mapContainer = document.createElement('div');
    document.body.appendChild(mapContainer);
    (globalThis as { usedFirstFeatureDictionary?: boolean }).usedFirstFeatureDictionary = false;

    const map = createMapMock(mapContainer);
    const control = new PluginControl({
      collapsed: true,
      oauthClientId: 'oauth-client',
      projectId: 'ee-project',
    });
    control.onAdd(map as never);

    await control.runScript(
      `
        var countries = {
          filterBounds: function(point) {
            return {
              first: function() {
                return {
                  toDictionary: function() {
                    globalThis.usedFirstFeatureDictionary = true;
                    return {
                      evaluate: function(success) {
                        success({ ADM0_NAME: 'United States' });
                      },
                    }
                  }
                };
              }
            };
          }
        };
        Map.addLayer(countries, {color: 'red'}, 'FAO/GAUL/2015/level0');
      `,
      {},
    );

    await (control as unknown as { _inspectPixelAt: (lon: number, lat: number) => Promise<void> })._inspectPixelAt(
      -100,
      40,
    );

    const inspectorPanel = document.querySelector<HTMLElement>('.plugin-tab-panel[data-tab="inspector"]');
    const output = inspectorPanel!.querySelector('pre')?.textContent ?? '';
    expect((globalThis as { usedFirstFeatureDictionary?: boolean }).usedFirstFeatureDictionary).toBe(true);
    expect(output).toContain('"type": "feature"');
    expect(output).toContain('"attributes"');
    expect(output).toContain('"ADM0_NAME": "United States"');
    expect(output).not.toContain('"geometry"');
    expect(output).not.toContain('"coordinates"');
  });
});
