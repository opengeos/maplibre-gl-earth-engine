import type { VisualizeOptions } from './layer';

export interface TileEndpointPayload {
  assetId?: string;
  script?: string;
  visParams?: VisualizeOptions;
  dateRange?: { start: string; end: string };
  cloudFilter?: { property: string; threshold: number };
  reducer?: string;
}

function toApiPayload(payload: TileEndpointPayload): Record<string, unknown> {
  const apiPayload: Record<string, unknown> = {};
  if (payload.assetId) apiPayload.asset_id = payload.assetId;
  if (payload.script) apiPayload.script = payload.script;
  if (payload.visParams) apiPayload.vis_params = payload.visParams;
  if (payload.dateRange) apiPayload.date_range = payload.dateRange;
  if (payload.cloudFilter) apiPayload.cloud_filter = payload.cloudFilter;
  if (payload.reducer) apiPayload.reducer = payload.reducer;
  return apiPayload;
}

export interface TileEndpointOptions {
  endpoint: string;
  token?: string;
}

export interface EndpointInspectPayload {
  assetId: string;
  lon: number;
  lat: number;
  visParams?: VisualizeOptions;
}

export interface EndpointTimeSeriesPayload {
  assetId: string;
  startDate: string;
  endDate: string;
  frequency: 'day' | 'week' | 'month' | 'year';
  reducer: string;
  visParams?: VisualizeOptions;
}

export interface EndpointExportPayload {
  assetId: string;
  description: string;
  region?: string;
  scale?: number;
  crs?: string;
  maxPixels?: number;
  destination?: 'drive' | 'cloud' | 'asset';
}

interface EndpointCapabilities {
  inspect?: boolean;
  export?: boolean;
  timeSeries?: boolean;
}

export interface EndpointClientOptions {
  endpoint: string;
  token?: string;
}

export function normalizeEndpointUrl(endpoint: string): string {
  const raw = endpoint.trim();
  if (!raw) return raw;

  const m = raw.match(/^https:\/\/huggingface\.co\/spaces\/([^/]+)\/([^/]+)\/?$/i);
  if (m) {
    const owner = m[1];
    const space = m[2];
    return `https://${owner}-${space}.hf.space/tile`;
  }

  return raw;
}

export interface EndpointClient {
  getTileUrl: (payload: TileEndpointPayload) => Promise<string>;
  inspectPixel: (payload: EndpointInspectPayload) => Promise<Record<string, unknown>>;
  requestExport: (payload: EndpointExportPayload) => Promise<Record<string, unknown>>;
  requestTimeSeries: (payload: EndpointTimeSeriesPayload) => Promise<Record<string, unknown>>;
  capabilities: () => EndpointCapabilities;
}

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Endpoint error (${response.status}): ${text || 'Unknown error'}`);
  }

  const json = (await response.json()) as Record<string, unknown>;
  return json;
}

export function parseTileUrlFromResponse(data: Record<string, unknown>): string {
  const tileUrl =
    (typeof data.tile_url === 'string' && data.tile_url) ||
    (typeof data.tileUrl === 'string' && data.tileUrl) ||
    (typeof data.urlFormat === 'string' && data.urlFormat) ||
    (Array.isArray(data.tiles) && typeof data.tiles[0] === 'string' && data.tiles[0]) ||
    (data.data && typeof (data.data as Record<string, unknown>).tileUrl === 'string'
      ? ((data.data as Record<string, unknown>).tileUrl as string)
      : undefined) ||
    (data.data && typeof (data.data as Record<string, unknown>).urlFormat === 'string'
      ? ((data.data as Record<string, unknown>).urlFormat as string)
      : undefined);

  if (!tileUrl) {
    throw new Error('Tile endpoint response missing tileUrl/urlFormat/tiles[0].');
  }

  return tileUrl;
}

function parseCapabilities(data: Record<string, unknown>): EndpointCapabilities {
  const capsRaw = data.capabilities as Record<string, unknown> | undefined;
  if (!capsRaw) return {};
  return {
    inspect: Boolean(capsRaw.inspect),
    export: Boolean(capsRaw.export),
    timeSeries: Boolean(capsRaw.timeSeries),
  };
}

export function createEndpointClient(options: EndpointClientOptions): EndpointClient {
  const endpoint = normalizeEndpointUrl(options.endpoint);
  if (!endpoint) throw new Error('Tile endpoint is not configured.');

  const headers = buildHeaders(options.token);
  let cachedCapabilities: EndpointCapabilities | null = null;

  const ensureSupported = (feature: keyof EndpointCapabilities): void => {
    if (!cachedCapabilities) return;
    if (cachedCapabilities[feature]) return;
    throw new Error(
      `Endpoint does not advertise ${feature} support. Configure an endpoint with ${feature} capability or use tile-only mode.`,
    );
  };

  return {
    capabilities: () => cachedCapabilities ?? {},

    getTileUrl: async (payload: TileEndpointPayload): Promise<string> => {
      const data = await postJson(endpoint, toApiPayload(payload), headers);
      cachedCapabilities = parseCapabilities(data);
      return parseTileUrlFromResponse(data);
    },

    inspectPixel: async (payload: EndpointInspectPayload): Promise<Record<string, unknown>> => {
      ensureSupported('inspect');
      const data = await postJson(`${endpoint.replace(/\/$/, '')}/inspect`, payload, headers);
      return data;
    },

    requestExport: async (payload: EndpointExportPayload): Promise<Record<string, unknown>> => {
      ensureSupported('export');
      return postJson(`${endpoint.replace(/\/$/, '')}/export`, payload, headers);
    },

    requestTimeSeries: async (payload: EndpointTimeSeriesPayload): Promise<Record<string, unknown>> => {
      ensureSupported('timeSeries');
      return postJson(`${endpoint.replace(/\/$/, '')}/timeseries`, payload, headers);
    },
  };
}

export async function requestTileUrl(
  payload: TileEndpointPayload,
  options: TileEndpointOptions,
): Promise<string> {
  const client = createEndpointClient(options);
  return client.getTileUrl(payload);
}
