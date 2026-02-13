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

function toObject(input: EeRenderable): object {
  if (typeof input === 'string') {
    return ee.Image(input) as unknown as object;
  }
  return input;
}

function mapIdForObject(input: EeRenderable, vis: VisualizeOptions): Promise<{ urlFormat: string }> {
  const obj = toObject(input) as {
    getMapId: (visParams: Record<string, unknown>, cb: (m: { urlFormat: string }) => void) => void;
  };
  const visParams: Record<string, unknown> = {};
  if (vis.bands) visParams.bands = vis.bands;
  if (vis.min !== undefined) visParams.min = vis.min;
  if (vis.max !== undefined) visParams.max = vis.max;
  if (vis.palette) visParams.palette = vis.palette;

  return new Promise((resolve, reject) => {
    try {
      obj.getMapId(visParams, (mapInfo) => resolve(mapInfo));
    } catch (error) {
      reject(error);
    }
  });
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
  const mapInfo = await mapIdForObject(input, vis);
  return addTileUrlLayer(map, mapInfo.urlFormat, vis, sourceId, layerId);
}
