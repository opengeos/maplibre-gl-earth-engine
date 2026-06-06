// React entry point
export { PluginControlReact } from './lib/core/PluginControlReact';

// React hooks
export { usePluginState } from './lib/hooks';

// Re-export types for React consumers
export type {
  PluginControlOptions,
  PluginState,
  PluginStatus,
  PluginControlReactProps,
  PluginControlEvent,
  PluginControlEventHandler,
} from './lib/core/types';
export type { VisualizeOptions } from './lib/ee/layer';
