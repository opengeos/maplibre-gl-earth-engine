import ee from '@google/earthengine';

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id?: string;
}

export interface AuthResult {
  ok: boolean;
  message: string;
  projectId?: string;
}

export function parseServiceAccountFromEnv(envValue?: string): ServiceAccountKey | null {
  const value = envValue ?? (typeof process !== 'undefined' ? process.env.EE_SERVICE_ACCOUNT : undefined);
  if (!value) return null;

  const trimmed = value.trim();
  const isJson = trimmed.startsWith('{');
  const raw = isJson ? trimmed : readFileIfAvailable(trimmed);
  if (!raw) return null;

  const parsed = JSON.parse(raw) as Partial<ServiceAccountKey>;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('EE_SERVICE_ACCOUNT JSON must include client_email and private_key');
  }

  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key,
    project_id: parsed.project_id,
  };
}

function readFileIfAvailable(filePath: string): string | null {
  if (typeof process === 'undefined' || process.release?.name !== 'node') return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

export async function authenticateWithServiceAccount(projectId?: string): Promise<AuthResult> {
  const key = parseServiceAccountFromEnv();
  if (!key) {
    return { ok: false, message: 'EE_SERVICE_ACCOUNT is not set.' };
  }

  const targetProject = projectId || key.project_id;
  await new Promise<void>((resolve, reject) => {
    ee.data.authenticateViaPrivateKey(
      {
        client_email: key.client_email,
        private_key: key.private_key,
      },
      () => {
        ee.initialize(null, null, () => resolve(), (e: unknown) => reject(e), targetProject);
      },
      (e: unknown) => reject(e),
    );
  });

  return {
    ok: true,
    projectId: targetProject,
    message: targetProject
      ? `Authenticated with service account (project: ${targetProject}).`
      : 'Authenticated with service account.',
  };
}
