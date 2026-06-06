import ee from '@google/earthengine';

async function authenticate() {
  const accessToken = process.env.EE_ACCESS_TOKEN?.trim();
  const projectId = process.env.EE_PROJECT_ID?.trim();
  if (!accessToken || !projectId) {
    console.log('SKIP: EE_ACCESS_TOKEN and EE_PROJECT_ID are required for the smoke test.');
    process.exit(0);
  }

  await new Promise((resolve, reject) => {
    ee.data.setAuthToken(
      '',
      'Bearer',
      accessToken,
      3600,
      [],
      () => ee.initialize(null, null, resolve, reject, null, projectId),
      false,
    );
  });
  return projectId;
}

async function main() {
  const projectId = await authenticate();
  const image = ee.Image('USGS/SRTMGL1_003');
  const mapInfo = await new Promise((resolve, reject) => {
    image.getMapId({ min: 0, max: 3000 }, (info) => resolve(info));
    setTimeout(() => reject(new Error('Timeout waiting for mapid.')), 15000);
  });

  console.log(`OK: Authenticated and fetched map tiles for project ${projectId}.`);
  console.log(`Tile URL: ${mapInfo.urlFormat}`);
}

main().catch((error) => {
  console.error('FAIL:', error?.message ?? error);
  process.exit(1);
});
