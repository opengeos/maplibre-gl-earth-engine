// Import styles
import './lib/styles/plugin-control.css';

// Main entry point - Core exports
export { PluginControl } from './lib/core/PluginControl';
export { authenticateWithOAuth } from './lib/ee/auth';
export { renderEeLayer } from './lib/ee/layer';
export { fetchCatalogs, filterCatalog, queryCatalog, groupCatalogByCategory } from './lib/ee/catalog';
export { requestTileUrl, createEndpointClient, parseTileUrlFromResponse } from './lib/ee/endpoint';

// Type exports
export type {
  PluginControlOptions,
  PluginState,
  PluginControlEvent,
  PluginControlEventHandler,
} from './lib/core/types';
export type { EarthEngineAuthOptions, AuthResult } from './lib/ee/auth';

// Utility exports
export { clamp, formatNumericValue, generateId, debounce, throttle, classNames } from './lib/utils';
