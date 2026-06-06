import ee from '@google/earthengine';
import type { Map } from 'maplibre-gl';

export interface VisualizeOptions {
  bands?: string;
  min?: number;
  max?: number;
  palette?: string;
  opacity?: number;
}

export type EeRenderable = string | object;

export interface RenderResult {
  sourceId: string;
  layerId: string;
  tileUrl: string;
}

interface MapIdResponse {
  urlFormat?: string;
}

interface EeObjectWithMapId {
  getMapId: (visParams: Record<string, unknown>, cb: (m?: MapIdResponse, error?: unknown) => void) => void;
}

interface RenderCandidate {
  label: string;
  value: object;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error ?? 'Unknown Earth Engine error');
}

function mapIdForObject(input: object, vis: VisualizeOptions): Promise<{ urlFormat: string }> {
  const obj = input as EeObjectWithMapId;
  if (typeof obj.getMapId !== 'function') {
    return Promise.reject(new Error('Earth Engine object does not support map rendering.'));
  }

  const visParams: Record<string, unknown> = {};
  if (vis.bands) visParams.bands = vis.bands;
  if (vis.min !== undefined) visParams.min = vis.min;
  if (vis.max !== undefined) visParams.max = vis.max;
  if (vis.palette) visParams.palette = vis.palette;

  return new Promise((resolve, reject) => {
    try {
      obj.getMapId(visParams, (mapInfo, error) => {
        if (error) {
          reject(new Error(errorMessage(error)));
          return;
        }
        if (!mapInfo?.urlFormat) {
          reject(new Error('Earth Engine map response is missing urlFormat.'));
          return;
        }
        resolve({ urlFormat: mapInfo.urlFormat });
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function mapIdForRenderable(input: EeRenderable, vis: VisualizeOptions): Promise<{ urlFormat: string }> {
  if (typeof input !== 'string') {
    return mapIdForObject(input, vis);
  }

  const errors: string[] = [];
  for (const createCandidate of [
    () => ({ label: 'ee.Image', value: ee.Image(input) as unknown as object }),
    () => ({ label: 'ee.ImageCollection', value: ee.ImageCollection(input) as unknown as object }),
    () => ({ label: 'ee.FeatureCollection', value: ee.FeatureCollection(input) as unknown as object }),
  ]) {
    let candidate: RenderCandidate | undefined;
    try {
      candidate = createCandidate();
      return await mapIdForObject(candidate.value, vis);
    } catch (error) {
      errors.push(`${candidate?.label ?? 'Earth Engine asset'}: ${errorMessage(error)}`);
    }
  }

  throw new Error(`Unable to render Earth Engine asset "${input}". ${errors.join(' ')}`);
}

export function addTileUrlLayer(
  map: Map,
  tileUrl: string,
  vis: VisualizeOptions,
  sourceId = 'ee-source',
  layerId = 'ee-layer',
): RenderResult {
  if (map.getLayer(layerId)) {
    map.removeLayer(layerId);
  }
  if (map.getSource(sourceId)) {
    map.removeSource(sourceId);
  }

  map.addSource(sourceId, {
    type: 'raster',
    tiles: [tileUrl],
    tileSize: 256,
  });

  map.addLayer({
    id: layerId,
    type: 'raster',
    source: sourceId,
    paint: {
      'raster-opacity': vis.opacity ?? 1,
    },
  });

  return { sourceId, layerId, tileUrl };
}

export async function renderEeLayer(
  map: Map,
  input: EeRenderable,
  vis: VisualizeOptions,
  sourceId = 'ee-source',
  layerId = 'ee-layer',
): Promise<RenderResult> {
  const mapInfo = await mapIdForRenderable(input, vis);
  return addTileUrlLayer(map, mapInfo.urlFormat, vis, sourceId, layerId);
}
