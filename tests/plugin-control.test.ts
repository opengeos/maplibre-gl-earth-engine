import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateWithOAuth: vi.fn(async () => ({
    ok: true,
    authenticated: true,
    message: 'Authenticated.',
  })),
  renderEeLayer: vi.fn(async () => ({
    sourceId: 'src',
    layerId: 'lyr',
    tileUrl: 'https://tiles.example/{z}/{x}/{y}',
  })),
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
    setLayoutProperty: vi.fn(),
    setPaintProperty: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
}

afterEach(() => {
  mocks.authenticateWithOAuth.mockClear();
  mocks.renderEeLayer.mockClear();
  document.body.replaceChildren();
  sessionStorage.clear();
});

describe('PluginControl', () => {
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
});
