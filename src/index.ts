// Import styles
import './lib/styles/plugin-control.css';

// Main entry point - Core exports
export { PluginControl } from './lib/core/PluginControl';
export { authenticateWithOAuth } from './lib/ee/auth';
export { addTileUrlLayer, renderEeLayer } from './lib/ee/layer';
export { fetchCatalogs, filterCatalog, queryCatalog, groupCatalogByCategory } from './lib/ee/catalog';
export {
  requestTileUrl,
  createEndpointClient,
  normalizeEndpointUrl,
  parseTileUrlFromResponse,
} from './lib/ee/endpoint';

// Type exports
export type {
  PluginControlOptions,
  PluginState,
  PluginStatus,
  PluginControlEvent,
  PluginControlEventHandler,
  PluginControlReactProps,
} from './lib/core/types';
export type { EarthEngineAuthOptions, AuthResult } from './lib/ee/auth';
export type { EeRenderable, RenderResult, TileLayerResult, VisualizeOptions } from './lib/ee/layer';
export type { CatalogItem, CatalogQuery, CatalogQueryResult } from './lib/ee/catalog';
export type {
  EndpointClient,
  EndpointClientOptions,
  EndpointExportPayload,
  EndpointInspectPayload,
  EndpointTimeSeriesPayload,
  TileEndpointOptions,
  TileEndpointPayload,
} from './lib/ee/endpoint';

// Utility exports
export { clamp, formatNumericValue, generateId, debounce, throttle, classNames } from './lib/utils';
