import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEe = vi.hoisted(() => ({
  initialize: vi.fn((_baseUrl?: string | null, _tileUrl?: string | null, success?: () => void) => success?.()),
  data: {
    authenticateViaOauth: vi.fn((_clientId: string, success?: () => void) => success?.()),
    authenticateViaPopup: vi.fn((success?: () => void) => success?.()),
    getAuthToken: vi.fn(() => null as string | null),
    getAuthClientId: vi.fn(() => null as string | null),
    clearAuthToken: vi.fn(),
    setAuthToken: vi.fn(
      (
        _clientId: string,
        _tokenType: string,
        _accessToken: string,
        _expiresIn: number,
        _extraScopes?: string[],
        callback?: () => void,
        _updateAuthLibrary?: boolean,
      ) => callback?.(),
    ),
  },
}));

vi.mock('@google/earthengine', () => ({
  default: mockEe,
}));

import { authenticateWithOAuth } from '../src/lib/ee/auth';

describe('authenticateWithOAuth', () => {
  beforeEach(() => {
    delete (globalThis as typeof globalThis & { ee?: unknown }).ee;
    mockEe.initialize.mockReset();
    mockEe.initialize.mockImplementation(
      (_baseUrl?: string | null, _tileUrl?: string | null, success?: () => void) => success?.(),
    );
    mockEe.data.authenticateViaOauth.mockClear();
    mockEe.data.authenticateViaPopup.mockClear();
    mockEe.data.getAuthToken.mockReset();
    mockEe.data.getAuthToken.mockReturnValue(null);
    mockEe.data.getAuthClientId.mockReset();
    mockEe.data.getAuthClientId.mockReturnValue(null);
    mockEe.data.clearAuthToken.mockClear();
    mockEe.data.setAuthToken.mockClear();
  });

  it('authenticates with browser OAuth and initializes a project', async () => {
    const result = await authenticateWithOAuth({
      oauthClientId: 'client-id',
      projectId: 'earth-engine-project',
      force: true,
    });

    expect(result).toMatchObject({
      ok: true,
      authenticated: true,
      projectId: 'earth-engine-project',
    });
    expect(mockEe.data.authenticateViaOauth).toHaveBeenCalledWith(
      'client-id',
      expect.any(Function),
      expect.any(Function),
      undefined,
      expect.any(Function),
    );
    expect(mockEe.initialize).toHaveBeenCalledWith(
      null,
      null,
      expect.any(Function),
      expect.any(Function),
      null,
      'earth-engine-project',
    );
  });

  it('exposes the Earth Engine module globally before initialization', async () => {
    mockEe.data.getAuthToken.mockReturnValue('Bearer existing-token');
    mockEe.data.getAuthClientId.mockReturnValue('client-id');
    mockEe.initialize.mockImplementation(
      (_baseUrl?: string | null, _tileUrl?: string | null, success?: () => void) => {
        expect((globalThis as typeof globalThis & { ee?: unknown }).ee).toBe(mockEe);
        success?.();
      },
    );

    await authenticateWithOAuth({
      oauthClientId: 'client-id',
      projectId: 'earth-engine-project',
      force: true,
    });
  });

  it('reuses an existing matching auth token without launching OAuth', async () => {
    mockEe.data.getAuthToken.mockReturnValue('Bearer existing-token');
    mockEe.data.getAuthClientId.mockReturnValue('client-id');

    await authenticateWithOAuth({
      oauthClientId: 'client-id',
      projectId: 'earth-engine-project',
      force: true,
    });

    expect(mockEe.data.authenticateViaOauth).not.toHaveBeenCalled();
    expect(mockEe.data.authenticateViaPopup).not.toHaveBeenCalled();
    expect(mockEe.initialize).toHaveBeenCalledTimes(1);
  });

  it('applies an access token without launching OAuth', async () => {
    await authenticateWithOAuth({
      accessToken: 'short-lived-token',
      tokenExpiresIn: 1800,
      projectId: 'earth-engine-project',
      force: true,
    });

    expect(mockEe.data.setAuthToken).toHaveBeenCalledWith(
      '',
      'Bearer',
      'short-lived-token',
      1800,
      [],
      expect.any(Function),
      false,
    );
    expect(mockEe.data.authenticateViaOauth).not.toHaveBeenCalled();
  });

  it('requires an OAuth client ID when no token exists', async () => {
    await expect(
      authenticateWithOAuth({
        projectId: 'earth-engine-project',
        force: true,
      }),
    ).rejects.toThrow('Earth Engine OAuth client ID is required.');
  });

  it('adds setup guidance to the Earth Engine Classifier initialization error', async () => {
    mockEe.data.getAuthToken.mockReturnValue('Bearer existing-token');
    mockEe.data.getAuthClientId.mockReturnValue('client-id');
    mockEe.initialize.mockImplementation(
      (
        _baseUrl?: string | null,
        _tileUrl?: string | null,
        _success?: () => void,
        failure?: (error: unknown) => void,
      ) => {
        failure?.(new Error("Cannot use 'in' operator to search for 'Classifier' in undefined"));
      },
    );

    await expect(
      authenticateWithOAuth({
        oauthClientId: 'client-id',
        projectId: 'earth-engine-project',
        force: true,
      }),
    ).rejects.toThrow(/Earth Engine initialization failed while loading the API algorithms registry/);
  });
});
