import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseServiceAccountFromEnv } from '../src/lib/ee/auth';

describe('parseServiceAccountFromEnv', () => {
  it('parses inline JSON', () => {
    const key = parseServiceAccountFromEnv(
      JSON.stringify({ client_email: 'a@b.com', private_key: 'secret', project_id: 'my-project' }),
    );
    expect(key?.client_email).toBe('a@b.com');
    expect(key?.project_id).toBe('my-project');
  });

  it('parses file path', () => {
    const tmp = path.join(os.tmpdir(), `ee-key-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify({ client_email: 'x@y.com', private_key: 'k' }));
    const key = parseServiceAccountFromEnv(tmp);
    expect(key?.client_email).toBe('x@y.com');
  });
});
