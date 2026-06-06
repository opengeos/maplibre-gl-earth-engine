import ee from '@google/earthengine';

export interface EarthEngineAuthOptions {
  oauthClientId?: string;
  projectId?: string;
  accessToken?: string;
  tokenType?: string;
  tokenExpiresIn?: number;
  force?: boolean;
}

export interface AuthResult {
  ok: boolean;
  message: string;
  projectId?: string;
  authenticated: boolean;
}

let authPromise: Promise<void> | null = null;
let initializePromise: Promise<AuthResult> | null = null;
let initialized = false;
let initializedProjectId: string | undefined;

function exposeEarthEngineGlobal(): void {
  const scope = globalThis as typeof globalThis & { ee?: unknown };
  if (!scope.ee) {
    scope.ee = ee;
  }
}

function syncGeneratedEeClasses(): void {
  // The Earth Engine browser build attaches runtime-generated classes such as
  // ee.Reducer and ee.Kernel to globalThis.ee during ee.initialize(), not to the
  // module export. When globalThis.ee is a different object (for example a
  // script-tag copy of the API or another bundled instance), copy the generated
  // classes onto the imported module so code like ee.Reducer.first() works.
  const scope = globalThis as typeof globalThis & { ee?: Record<string, unknown> };
  const globalEe = scope.ee;
  const moduleEe = ee as unknown as Record<string, unknown>;
  if (!globalEe || typeof globalEe !== 'object' || globalEe === moduleEe) return;
  for (const name of Object.keys(globalEe)) {
    if (!(name in moduleEe)) {
      moduleEe[name] = globalEe[name];
    }
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text ? text : undefined;
}

function normalizeTokenExpiresIn(value: unknown): number {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 3600;
}

function eeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error ?? 'Unknown Earth Engine error');
}

function formatEeInitializeError(error: unknown): string {
  const message = eeErrorMessage(error);
  if (message.includes("Cannot use 'in' operator") && message.includes('Classifier')) {
    return [
      'Earth Engine initialization failed while loading the API algorithms registry.',
      'Verify that the configured Google Cloud project has Earth Engine enabled,',
      'the OAuth consent/client origin matches this page, and the signed-in account has Earth Engine access.',
      `Original error: ${message}`,
    ].join(' ');
  }
  return message;
}

function setAuthToken(options: EarthEngineAuthOptions, accessToken: string): Promise<void> {
  if (!ee.data?.setAuthToken) {
    throw new Error('Earth Engine token authentication is unavailable.');
  }
  const oauthClientId = normalizeOptionalString(options.oauthClientId) ?? '';
  const tokenType = normalizeOptionalString(options.tokenType) ?? 'Bearer';
  const tokenExpiresIn = normalizeTokenExpiresIn(options.tokenExpiresIn);
  return new Promise((resolve, reject) => {
    try {
      ee.data.setAuthToken(oauthClientId, tokenType, accessToken, tokenExpiresIn, [], resolve, false);
    } catch (error) {
      reject(new Error(eeErrorMessage(error)));
    }
  });
}

async function ensureAuthenticated(options: EarthEngineAuthOptions): Promise<void> {
  const accessToken = normalizeOptionalString(options.accessToken);
  const oauthClientId = normalizeOptionalString(options.oauthClientId);
  if (accessToken) {
    await setAuthToken(options, accessToken);
    return;
  }

  const token = ee.data?.getAuthToken?.();
  const currentAuthClientId = normalizeOptionalString(ee.data?.getAuthClientId?.());
  if (token) {
    if (!oauthClientId || (currentAuthClientId && currentAuthClientId === oauthClientId)) {
      return;
    }
    ee.data?.clearAuthToken?.();
  }

  if (authPromise) {
    return authPromise;
  }
  if (!oauthClientId) {
    throw new Error('Earth Engine OAuth client ID is required.');
  }
  if (!ee.data?.authenticateViaOauth) {
    throw new Error('Earth Engine OAuth authentication is unavailable.');
  }

  const promise: Promise<void> = new Promise<void>((resolve, reject) => {
    const onSuccess = () => resolve();
    const onFailure = (error: unknown) => reject(new Error(eeErrorMessage(error)));
    const onImmediateFailed = () => {
      if (!ee.data?.authenticateViaPopup) {
        reject(new Error('Earth Engine popup authentication is unavailable.'));
        return;
      }
      ee.data.authenticateViaPopup(onSuccess, onFailure);
    };

    ee.data.authenticateViaOauth(oauthClientId, onSuccess, onFailure, undefined, onImmediateFailed);
  }).finally(() => {
    authPromise = null;
  });
  authPromise = promise;
  return promise;
}

function initializeEarthEngine(projectId?: string): Promise<void> {
  if (!ee.initialize) {
    throw new Error('Earth Engine initialize is unavailable.');
  }
  exposeEarthEngineGlobal();
  return new Promise((resolve, reject) => {
    try {
      ee.initialize(
        null,
        null,
        () => {
          syncGeneratedEeClasses();
          resolve();
        },
        (error: unknown) => reject(new Error(formatEeInitializeError(error))),
        null,
        projectId || null,
      );
    } catch (error) {
      reject(new Error(formatEeInitializeError(error)));
    }
  });
}

export async function authenticateWithOAuth(options: EarthEngineAuthOptions = {}): Promise<AuthResult> {
  const projectId = normalizeOptionalString(options.projectId);
  const projectMatches = initializedProjectId === projectId || (!initializedProjectId && !projectId);
  if (initialized && projectMatches && !options.force) {
    return {
      ok: true,
      projectId,
      authenticated: true,
      message: projectId
        ? `Authenticated with Google account (project: ${projectId}).`
        : 'Authenticated with Google account.',
    };
  }

  if (initializePromise && !options.force) {
    return initializePromise;
  }

  initializePromise = (async () => {
    await ensureAuthenticated(options);
    await initializeEarthEngine(projectId);
    initialized = true;
    initializedProjectId = projectId;
    return {
      ok: true,
      projectId,
      authenticated: true,
      message: projectId
        ? `Authenticated with Google account (project: ${projectId}).`
        : 'Authenticated with Google account.',
    };
  })().catch((error) => {
    initialized = false;
    initializedProjectId = undefined;
    throw error;
  }).finally(() => {
    initializePromise = null;
  });

  return initializePromise;
}
