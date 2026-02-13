import fs from 'node:fs';
import ee from '@google/earthengine';

function parseKey() {
  const raw = process.env.EE_SERVICE_ACCOUNT;
  if (!raw) return null;
  const trimmed = raw.trim();
  const content = trimmed.startsWith('{') ? trimmed : fs.existsSync(trimmed) ? fs.readFileSync(trimmed, 'utf8') : null;
  if (!content) return null;
  return JSON.parse(content);
}

async function main() {
  const key = parseKey();
  if (!key) {
    console.log('SKIP: EE_SERVICE_ACCOUNT is not set (or invalid path).');
    process.exit(0);
  }

  await new Promise((resolve, reject) => {
    ee.data.authenticateViaPrivateKey(
      { client_email: key.client_email, private_key: key.private_key },
      () => ee.initialize(null, null, resolve, reject, key.project_id),
      reject,
    );
  });

  const image = ee.Image('USGS/SRTMGL1_003');
  const mapInfo = await new Promise((resolve, reject) => {
    image.getMapId({ min: 0, max: 3000 }, (info) => resolve(info));
    setTimeout(() => reject(new Error('Timeout waiting for mapid.')), 15000);
  });

  console.log('OK: Authenticated and fetched map tiles.');
  console.log(`Tile URL: ${mapInfo.urlFormat}`);
}

main().catch((error) => {
  console.error('FAIL:', error?.message ?? error);
  process.exit(1);
});
