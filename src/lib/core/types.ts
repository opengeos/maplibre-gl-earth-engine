import type { Map } from 'maplibre-gl';

export type PluginStatus = string;

export interface PluginControlOptions {
  collapsed?: boolean;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  title?: string;
  panelWidth?: number;
  maxHeight?: number | string;
  className?: string;
}

export interface PluginState {
  collapsed: boolean;
  panelWidth: number;
  data?: Record<string, unknown>;
  status: PluginStatus;
  selectedAssetId: string;
  authenticated: boolean;
}

export interface PluginControlReactProps extends PluginControlOptions {
  map: Map;
  onStateChange?: (state: PluginState) => void;
}

export type PluginControlEvent = 'collapse' | 'expand' | 'statechange';

export type PluginControlEventHandler = (event: { type: PluginControlEvent; state: PluginState }) => void;
