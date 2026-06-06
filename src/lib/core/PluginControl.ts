import ee from '@google/earthengine';
import type { IControl, Map as MapLibreMap } from 'maplibre-gl';
import { authenticateWithOAuth } from '../ee/auth';
import {
  fetchCatalogs,
  groupCatalogByCategory,
  queryCatalog,
  type CatalogItem,
  type CatalogQuery,
} from '../ee/catalog';
import { renderEeLayer, type VisualizeOptions } from '../ee/layer';
import type {
  PluginControlOptions,
  PluginState,
  PluginControlEvent,
  PluginControlEventHandler,
  PluginStatus,
} from './types';

function buildEnvString(name: string): string {
  const value = (import.meta as unknown as { env?: Record<string, unknown> }).env?.[name];
  return typeof value === 'string' ? value.trim() : '';
}

const DEFAULT_OPTIONS: Required<PluginControlOptions> = {
  collapsed: true,
  position: 'top-right',
  title: 'Earth Engine',
  panelWidth: 420,
  maxHeight: '78vh',
  className: '',
  storagePrefix: 'maplibre-gl-earth-engine',
  oauthClientId: buildEnvString('VITE_GEE_OAUTH_CLIENT_ID'),
  projectId: buildEnvString('VITE_GEE_PROJECT_ID'),
  accessToken: '',
  tokenType: 'Bearer',
  tokenExpiresIn: 3600,
};

type EventHandlersMap = globalThis.Map<PluginControlEvent, Set<PluginControlEventHandler>>;
type ControlPosition = Required<PluginControlOptions>['position'];

interface LoadedLayerState {
  id: string;
  sourceId: string;
  layerId: string;
  name: string;
  input: string | object;
  eeObject: object;
  vis: VisualizeOptions;
  assetId?: string;
  opacity: number;
  visible: boolean;
  addedAt: number;
  tileUrl: string;
}

interface CodeEditorMapLayer {
  getName: () => string;
  setName: (name: string) => CodeEditorMapLayer;
  getShown: () => boolean;
  setShown: (shown: boolean) => CodeEditorMapLayer;
  getOpacity: () => number;
  setOpacity: (opacity: number) => CodeEditorMapLayer;
}

interface PendingCodeEditorLayer {
  eeObject: string | object;
  vis: VisualizeOptions;
  name: string;
  shown: boolean;
  layer?: CodeEditorMapLayer & { loadedLayer?: LoadedLayerState };
}

interface CodeEditorMapAdapter {
  addLayer: (
    eeObject: string | object,
    visParams?: VisualizeOptions | null,
    name?: string,
    shown?: boolean,
    opacity?: number,
  ) => CodeEditorMapLayer;
  setCenter: (lon: number, lat: number, zoom?: number) => CodeEditorMapAdapter;
  centerObject: (object: unknown, zoom?: number, onComplete?: () => void) => CodeEditorMapAdapter;
  getCenter: () => unknown;
  getZoom: () => number;
  getBounds: (options?: { asGeoJSON?: boolean }) => unknown;
  getScale: () => number;
  getMapLibreMap: () => MapLibreMap | undefined;
}

interface CodeEditorMapExecution {
  map: CodeEditorMapAdapter;
  layerRequests: PendingCodeEditorLayer[];
  viewportRequests: Array<() => Promise<void>>;
  hasActions: () => boolean;
}

const TABS: Array<{ id: string; label: string }> = [
  { id: 'catalog', label: 'Browse/Catalog' },
  { id: 'search', label: 'Search' },
  { id: 'load', label: 'Load' },
  { id: 'layers', label: 'Layers' },
  { id: 'inspector', label: 'Inspector' },
  { id: 'code', label: 'Code' },
  { id: 'auth', label: 'Auth' },
];

export class PluginControl implements IControl {
  private _map?: MapLibreMap;
  private _mapContainer?: HTMLElement;
  private _container?: HTMLElement;
  private _panel?: HTMLElement;
  private _options: Required<PluginControlOptions>;
  private _state: PluginState;
  private _eventHandlers: EventHandlersMap = new globalThis.Map();
  private _statusEl?: HTMLElement;

  private _catalog: CatalogItem[] = [];
  private _catalogFetchPromise?: Promise<CatalogItem[]>;
  private _catalogRefreshHandlers: Array<() => void> = [];
  private _selectedAssetId = 'USGS/SRTMGL1_003';
  private _selectedCatalogItem?: CatalogItem;
  private _activeTab = 'catalog';
  private _oauthClientId = '';
  private _projectId = '';

  private _loadAssetInput?: HTMLInputElement;
  private _authProjectInput?: HTMLInputElement;
  private _authOAuthClientInput?: HTMLInputElement;
  private _loadedLayer?: LoadedLayerState;
  private _layers: LoadedLayerState[] = [];
  private _layerCounter = 0;
  private _layersListEl?: HTMLElement;
  private _inspectorActive = false;
  private _inspectorClickHandler?: (e: { lngLat: { lng: number; lat: number } }) => void;
  private _inspectorLayerSelect?: HTMLSelectElement;
  private _inspectorLonInput?: HTMLInputElement;
  private _inspectorLatInput?: HTMLInputElement;
  private _inspectorScaleInput?: HTMLInputElement;
  private _inspectorResultsEl?: HTMLElement;
  private _previousMapCursor?: string;
  private _documentClickHandler?: (e: MouseEvent) => void;
  private _windowResizeHandler?: () => void;
  private _mapResizeHandler?: () => void;
  private _resizeCleanup?: () => void;

  constructor(options?: Partial<PluginControlOptions>) {
    this._options = { ...DEFAULT_OPTIONS, ...options };
    this._oauthClientId = this._options.oauthClientId.trim();
    this._projectId = this._initialProjectId();
    this._state = {
      collapsed: this._options.collapsed,
      panelWidth: this._options.panelWidth,
      data: {},
      status: 'Ready',
      selectedAssetId: this._selectedAssetId,
      authenticated: false,
    };
  }

  onAdd(map: MapLibreMap): HTMLElement {
    this._map = map;
    this._mapContainer = map.getContainer();
    this._container = this._createContainer();
    this._panel = this._createPanel();
    this._mapContainer.appendChild(this._panel);
    this._setupEventListeners();
    if (!this._state.collapsed) {
      requestAnimationFrame(() => {
        if (!this._panel || !this._container?.parentElement) return;
        this._panel.classList.add('expanded');
        this._positionPanel();
        this._handlePanelOpened();
      });
    }
    return this._container;
  }

  onRemove(): void {
    this._disableInspector();
    this._resizeCleanup?.();
    if (this._documentClickHandler) document.removeEventListener('click', this._documentClickHandler);
    if (this._windowResizeHandler) window.removeEventListener('resize', this._windowResizeHandler);
    if (this._mapResizeHandler) this._map?.off('resize', this._mapResizeHandler);
    this._panel?.remove();
    this._container?.remove();
    this._map = undefined;
    this._mapContainer = undefined;
    this._container = undefined;
    this._panel = undefined;
    this._eventHandlers.clear();
  }

  getDefaultPosition(): ControlPosition {
    return this._options.position;
  }

  getState(): PluginState {
    return { ...this._state };
  }

  setState(newState: Partial<PluginState>): void {
    this._state = { ...this._state, ...newState };
    this._emit('statechange');
  }

  private _projectIdStorageKey(): string {
    return `${this._options.storagePrefix}.earthEngine.projectId`;
  }

  private _initialProjectId(): string {
    const configured = this._options.projectId.trim();
    if (configured) return configured;
    try {
      return globalThis.sessionStorage?.getItem(this._projectIdStorageKey())?.trim() ?? '';
    } catch {
      return '';
    }
  }

  private _storeProjectId(projectId: string): void {
    try {
      if (projectId) {
        globalThis.sessionStorage?.setItem(this._projectIdStorageKey(), projectId);
      } else {
        globalThis.sessionStorage?.removeItem(this._projectIdStorageKey());
      }
    } catch {
      // Ignore storage failures in private or restricted browser contexts.
    }
  }

  private _activeProjectId(projectId?: string): string {
    return (projectId ?? this._authProjectInput?.value ?? this._projectId).trim();
  }

  private _activeOAuthClientId(oauthClientId?: string): string {
    return (oauthClientId ?? this._authOAuthClientInput?.value ?? this._oauthClientId).trim();
  }

  async authenticate(projectId?: string, oauthClientId?: string): Promise<void> {
    this._projectId = this._activeProjectId(projectId);
    this._oauthClientId = this._activeOAuthClientId(oauthClientId);
    this._storeProjectId(this._projectId);
    if (!this._oauthClientId && !this._options.accessToken) {
      throw new Error('Enter a Google OAuth client ID before signing in to Earth Engine.');
    }
    if (!this._projectId) {
      throw new Error('Enter an Earth Engine-enabled Google Cloud project ID before signing in.');
    }
    this._setStatus('Authenticating with Google account...');
    const result = await authenticateWithOAuth({
      oauthClientId: this._oauthClientId || undefined,
      projectId: this._projectId || undefined,
      accessToken: this._options.accessToken || undefined,
      tokenType: this._options.tokenType || undefined,
      tokenExpiresIn: this._options.tokenExpiresIn,
    });
    this.setState({ authenticated: result.ok });
    this._setStatus(result.message);
  }

  async loadAsset(assetId: string, vis: VisualizeOptions): Promise<void> {
    if (!this._map) throw new Error('Control is not attached to a map.');
    this._setStatus(`Rendering ${assetId}…`);

    await this.authenticate();
    await this._renderManagedLayer(assetId, vis, { assetId, name: assetId });

    this._selectedAssetId = assetId;
    this.setState({ selectedAssetId: assetId });
    this._setStatus(`Loaded ${assetId}`);
  }

  async runScript(script: string, vis: VisualizeOptions): Promise<void> {
    if (!this._map) throw new Error('Control is not attached to a map.');
    this._setStatus('Running script…');

    const codeEditorMap = this._createCodeEditorMapExecution();
    const fn = new Function('ee', 'Map', `${script}`) as (
      eeNs: typeof ee,
      mapAdapter: CodeEditorMapAdapter,
    ) => unknown;
    const result = fn(ee, codeEditorMap.map);
    const target = this._renderableScriptResult(result);
    if (result !== undefined && !target) {
      throw new Error('Script return value must be an asset ID string or an Earth Engine object.');
    }
    if (!target && !codeEditorMap.hasActions()) {
      throw new Error('Script must return an asset ID or EE object, or call Map.addLayer/Map.setCenter/Map.centerObject.');
    }

    if (target || codeEditorMap.layerRequests.length || codeEditorMap.viewportRequests.length) {
      await this.authenticate();
    }

    for (const request of codeEditorMap.viewportRequests) {
      await request();
    }

    for (const request of codeEditorMap.layerRequests) {
      const layer = await this._renderManagedLayer(request.eeObject, request.vis, {
        name: request.name,
        shown: request.shown,
      });
      if (request.layer) request.layer.loadedLayer = layer;
    }

    if (target) {
      await this._renderManagedLayer(target, vis, { name: 'Script layer' });
    }

    const layerCount = codeEditorMap.layerRequests.length + (target ? 1 : 0);
    this._setStatus(layerCount ? `Script added ${layerCount} layer${layerCount === 1 ? '' : 's'}.` : 'Script completed.');
  }

  toggle(): void {
    this._state.collapsed = !this._state.collapsed;
    this._panel?.classList.toggle('expanded', !this._state.collapsed);
    if (!this._state.collapsed) {
      this._positionPanel();
      this._handlePanelOpened();
    }
    this._emit(this._state.collapsed ? 'collapse' : 'expand');
    this._emit('statechange');
  }

  expand(): void {
    if (this._state.collapsed) this.toggle();
  }

  collapse(): void {
    if (!this._state.collapsed) this.toggle();
  }

  on(event: PluginControlEvent, handler: PluginControlEventHandler): void {
    if (!this._eventHandlers.has(event)) this._eventHandlers.set(event, new Set());
    this._eventHandlers.get(event)?.add(handler);
  }

  off(event: PluginControlEvent, handler: PluginControlEventHandler): void {
    this._eventHandlers.get(event)?.delete(handler);
  }

  private _emit(event: PluginControlEvent): void {
    this._eventHandlers.get(event)?.forEach((handler) => handler({ type: event, state: this.getState() }));
  }

  private _setStatus(status: PluginStatus): void {
    this._state.status = status;
    if (this._statusEl) this._statusEl.textContent = status;
    this._emit('statechange');
  }

  private _handlePanelOpened(): void {
    void this._ensureCatalogsFetched();
  }

  private async _ensureCatalogsFetched(): Promise<void> {
    if (this._catalog.length) {
      this._refreshCatalogViews();
      return;
    }

    if (!this._catalogFetchPromise) {
      this._setStatus('Fetching catalog metadata...');
      this._catalogFetchPromise = fetchCatalogs();
    }

    try {
      this._catalog = await this._catalogFetchPromise;
      this._refreshCatalogViews();
      this._setStatus(`Loaded ${this._catalog.length} datasets.`);
    } catch (error) {
      this._catalogFetchPromise = undefined;
      this._setStatus(`Catalog fetch failed: ${(error as Error).message}`);
    }
  }

  private _refreshCatalogViews(): void {
    this._catalogRefreshHandlers.forEach((handler) => handler());
  }

  private _earthEngineDatasetUrl(assetId: string): string {
    return `https://developers.google.com/earth-engine/datasets/catalog/${encodeURIComponent(
      assetId.trim().replace(/\//g, '_'),
    )}`;
  }

  private _catalogUrlForAsset(assetId: string): string {
    const trimmed = assetId.trim();
    const selected = this._selectedCatalogItem?.id === trimmed ? this._selectedCatalogItem : undefined;
    const catalogItem = selected ?? this._catalog.find((item) => item.id === trimmed);
    return catalogItem?.url ?? this._earthEngineDatasetUrl(trimmed);
  }

  private _nextLayerIds(): Pick<LoadedLayerState, 'id' | 'sourceId' | 'layerId'> {
    this._layerCounter += 1;
    const id = `ee-${Date.now().toString(36)}-${this._layerCounter}`;
    return {
      id,
      sourceId: `${id}-source`,
      layerId: `${id}-layer`,
    };
  }

  private async _renderManagedLayer(
    input: string | object,
    vis: VisualizeOptions,
    meta: { name: string; assetId?: string; shown?: boolean },
    existing?: LoadedLayerState,
  ): Promise<LoadedLayerState> {
    if (!this._map) throw new Error('Control is not attached to a map.');
    const ids = existing ?? this._nextLayerIds();
    const result = await renderEeLayer(this._map, input, vis, ids.sourceId, ids.layerId);
    const layerState: LoadedLayerState = {
      id: ids.id,
      sourceId: result.sourceId,
      layerId: result.layerId,
      name: meta.name,
      input,
      eeObject: result.eeObject,
      vis: { ...vis },
      assetId: meta.assetId,
      opacity: vis.opacity ?? existing?.opacity ?? 1,
      visible: meta.shown ?? existing?.visible ?? true,
      addedAt: existing?.addedAt ?? Date.now(),
      tileUrl: result.tileUrl,
    };

    const index = this._layers.findIndex((layer) => layer.id === layerState.id);
    if (index >= 0) {
      this._layers[index] = layerState;
    } else {
      this._layers.push(layerState);
    }
    this._loadedLayer = layerState;
    this._applyLayerVisibility(layerState);
    this._applyLayerOpacity(layerState);
    this._renderLayersList();
    this._renderInspectorLayerOptions();
    return layerState;
  }

  private _removeManagedLayer(layerId: string): void {
    if (!this._map) return;
    const layer = this._layers.find((item) => item.id === layerId);
    if (!layer) return;
    if (this._map.getLayer(layer.layerId)) this._map.removeLayer(layer.layerId);
    if (this._map.getSource(layer.sourceId)) this._map.removeSource(layer.sourceId);
    this._layers = this._layers.filter((item) => item.id !== layerId);
    if (this._loadedLayer?.id === layerId) this._loadedLayer = this._layers[this._layers.length - 1];
    this._renderLayersList();
    this._renderInspectorLayerOptions();
  }

  private _applyLayerOpacity(layer: LoadedLayerState): void {
    if (!this._map?.getLayer(layer.layerId)) return;
    this._map.setPaintProperty(layer.layerId, 'raster-opacity', layer.opacity);
  }

  private _applyLayerVisibility(layer: LoadedLayerState): void {
    if (!this._map?.getLayer(layer.layerId)) return;
    this._map.setLayoutProperty(layer.layerId, 'visibility', layer.visible ? 'visible' : 'none');
  }

  private _renderableScriptResult(result: unknown): string | object | undefined {
    if (typeof result === 'string') return result;
    if (result && typeof result === 'object') return result;
    return undefined;
  }

  private _normalizeVisParams(visParams?: VisualizeOptions | null): VisualizeOptions {
    return visParams ? { ...visParams } : {};
  }

  private _createCodeEditorLayer(
    request: PendingCodeEditorLayer,
  ): CodeEditorMapLayer & { loadedLayer?: LoadedLayerState } {
    const layer: CodeEditorMapLayer & { loadedLayer?: LoadedLayerState } = {
      getName: () => request.name,
      setName: (name: string) => {
        request.name = name || request.name;
        if (layer.loadedLayer) {
          layer.loadedLayer.name = request.name;
          this._renderLayersList();
        }
        return layer;
      },
      getShown: () => request.shown,
      setShown: (shown: boolean) => {
        request.shown = Boolean(shown);
        if (layer.loadedLayer) {
          layer.loadedLayer.visible = request.shown;
          this._applyLayerVisibility(layer.loadedLayer);
          this._renderLayersList();
        }
        return layer;
      },
      getOpacity: () => Number(request.vis.opacity ?? 1),
      setOpacity: (opacity: number) => {
        request.vis.opacity = this._clampOpacity(opacity);
        if (layer.loadedLayer) {
          layer.loadedLayer.opacity = Number(request.vis.opacity);
          this._applyLayerOpacity(layer.loadedLayer);
          this._renderLayersList();
        }
        return layer;
      },
    };
    return layer;
  }

  private _createCodeEditorMapExecution(): CodeEditorMapExecution {
    const layerRequests: PendingCodeEditorLayer[] = [];
    const viewportRequests: Array<() => Promise<void>> = [];
    let immediateActionCount = 0;

    const adapter: CodeEditorMapAdapter = {
      addLayer: (
        eeObject: string | object,
        visParams?: VisualizeOptions | null,
        name?: string,
        shown = true,
        opacity?: number,
      ): CodeEditorMapLayer => {
        if (!eeObject) throw new Error('Map.addLayer requires an Earth Engine object or raw map ID.');
        const vis = this._normalizeVisParams(visParams);
        vis.opacity = this._clampOpacity(opacity ?? vis.opacity ?? 1);
        const request: PendingCodeEditorLayer = {
          eeObject,
          vis,
          name: name || `Layer ${this._layers.length + layerRequests.length + 1}`,
          shown,
        };
        const layer = this._createCodeEditorLayer(request);
        request.layer = layer;
        layerRequests.push(request);
        return layer;
      },
      setCenter: (lon: number, lat: number, zoom?: number): CodeEditorMapAdapter => {
        this._setMapCenter(lon, lat, zoom);
        immediateActionCount += 1;
        return adapter;
      },
      centerObject: (object: unknown, zoom?: number, onComplete?: () => void): CodeEditorMapAdapter => {
        viewportRequests.push(() => this._centerMapOnEeObject(object, zoom, onComplete));
        return adapter;
      },
      getCenter: (): unknown => {
        const center = this._map?.getCenter();
        if (!center) return undefined;
        return ee.Geometry.Point([center.lng, center.lat]);
      },
      getZoom: (): number => this._map?.getZoom() ?? 0,
      getBounds: (options?: { asGeoJSON?: boolean }): unknown => this._getMapBounds(options),
      getScale: (): number => this._getApproximateMapScale(),
      getMapLibreMap: (): MapLibreMap | undefined => this._map,
    };

    return {
      map: adapter,
      layerRequests,
      viewportRequests,
      hasActions: () => immediateActionCount > 0 || layerRequests.length > 0 || viewportRequests.length > 0,
    };
  }

  private _clampOpacity(value: unknown): number {
    const opacity = Number(value);
    if (!Number.isFinite(opacity)) return 1;
    return Math.min(Math.max(opacity, 0), 1);
  }

  private _setMapCenter(lon: number, lat: number, zoom?: number): void {
    if (!this._map) throw new Error('Control is not attached to a map.');
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error('Map.setCenter requires numeric longitude and latitude.');
    }
    const center: [number, number] = [lon, lat];
    if (zoom === undefined) {
      this._map.setCenter(center);
      return;
    }
    if (!Number.isFinite(zoom)) throw new Error('Map.setCenter zoom must be numeric.');
    this._map.jumpTo({ center, zoom });
  }

  private _getMapBounds(options?: { asGeoJSON?: boolean }): unknown {
    const bounds = this._map?.getBounds();
    if (!bounds) return undefined;
    const west = bounds.getWest();
    const south = bounds.getSouth();
    const east = bounds.getEast();
    const north = bounds.getNorth();
    if (!options?.asGeoJSON) return [west, south, east, north];
    return {
      type: 'Polygon',
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    };
  }

  private _getApproximateMapScale(): number {
    if (!this._map) return 0;
    const center = this._map.getCenter();
    const latitudeRadians = (center.lat * Math.PI) / 180;
    return (156543.03392 * Math.cos(latitudeRadians)) / 2 ** this._map.getZoom();
  }

  private async _centerMapOnEeObject(object: unknown, zoom?: number, onComplete?: () => void): Promise<void> {
    if (!this._map) throw new Error('Control is not attached to a map.');
    if (zoom !== undefined && !Number.isFinite(zoom)) throw new Error('Map.centerObject zoom must be numeric.');

    const geometry = this._toEeGeometry(object);
    const boundsObject =
      geometry && typeof geometry === 'object' && 'bounds' in geometry && typeof geometry.bounds === 'function'
        ? geometry.bounds()
        : geometry;
    const boundsInfo = await this._evaluateEeObject(boundsObject);
    const bounds = this._boundsFromGeometryInfo(boundsInfo);
    const center: [number, number] = [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];

    if (zoom !== undefined || (bounds[0][0] === bounds[1][0] && bounds[0][1] === bounds[1][1])) {
      this._map.jumpTo({ center, zoom: zoom ?? Math.max(this._map.getZoom(), 12) });
    } else {
      this._map.fitBounds(bounds, { padding: 32 });
    }
    onComplete?.();
  }

  private _toEeGeometry(object: unknown): unknown {
    const candidate = object as { geometry?: () => unknown };
    if (candidate && typeof candidate === 'object' && typeof candidate.geometry === 'function') {
      return candidate.geometry();
    }
    return object;
  }

  private _boundsFromGeometryInfo(info: unknown): [[number, number], [number, number]] {
    const coordinates = this._coordinatesFromGeometryInfo(info);
    if (!coordinates.length) throw new Error('Unable to determine bounds for the Earth Engine object.');

    const west = Math.min(...coordinates.map((coordinate) => coordinate[0]));
    const south = Math.min(...coordinates.map((coordinate) => coordinate[1]));
    const east = Math.max(...coordinates.map((coordinate) => coordinate[0]));
    const north = Math.max(...coordinates.map((coordinate) => coordinate[1]));
    return [
      [west, south],
      [east, north],
    ];
  }

  private _coordinatesFromGeometryInfo(info: unknown): Array<[number, number]> {
    if (Array.isArray(info)) {
      if (info.length >= 2 && typeof info[0] === 'number' && typeof info[1] === 'number') {
        return [[info[0], info[1]]];
      }
      return info.flatMap((item) => this._coordinatesFromGeometryInfo(item));
    }

    if (!info || typeof info !== 'object') return [];
    const record = info as Record<string, unknown>;
    return [
      ...this._coordinatesFromGeometryInfo(record.coordinates),
      ...this._coordinatesFromGeometryInfo(record.geometry),
      ...this._coordinatesFromGeometryInfo(record.features),
      ...this._coordinatesFromGeometryInfo(record.geometries),
    ];
  }

  private _evaluateEeObject(input: unknown): Promise<unknown> {
    const obj = input as {
      evaluate?: (callback: (value: unknown, error?: unknown) => void) => void;
      getInfo?: (callback?: (value: unknown, error?: unknown) => void) => unknown;
      toString?: () => string;
    };

    if (typeof obj?.evaluate === 'function') {
      // ee evaluate() invokes a single callback as callback(value, error).
      return new Promise((resolve, reject) => {
        obj.evaluate?.((value, error) => {
          if (error) reject(error instanceof Error ? error : new Error(String(error)));
          else resolve(value);
        });
      });
    }

    if (typeof obj?.getInfo === 'function') {
      return new Promise((resolve, reject) => {
        try {
          if (obj.getInfo?.length) {
            obj.getInfo((value, error) => {
              if (error) reject(error instanceof Error ? error : new Error(String(error)));
              else resolve(value);
            });
          } else {
            resolve(obj.getInfo?.());
          }
        } catch (error) {
          reject(error);
        }
      });
    }

    if (typeof obj?.toString === 'function') {
      return Promise.resolve(obj.toString());
    }

    return Promise.resolve(input);
  }

  private _createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = `maplibregl-ctrl maplibregl-ctrl-group plugin-control ${this._options.className}`.trim();

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'plugin-control-toggle';
    toggleBtn.type = 'button';
    toggleBtn.setAttribute('aria-label', this._options.title);
    toggleBtn.innerHTML = '<span class="plugin-control-icon">🌍</span>';
    toggleBtn.addEventListener('click', () => this.toggle());
    container.appendChild(toggleBtn);
    return container;
  }

  private _createPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'plugin-control-panel';
    panel.style.width = `${this._options.panelWidth}px`;
    panel.style.maxHeight =
      typeof this._options.maxHeight === 'number' ? `${this._options.maxHeight}px` : this._options.maxHeight;

    const header = document.createElement('div');
    header.className = 'plugin-control-header';
    header.innerHTML = `<span class="plugin-control-title">${this._options.title}</span>`;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'plugin-control-close';
    closeBtn.type = 'button';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => this.collapse());
    header.appendChild(closeBtn);

    const tabs = this._createTabs();
    const body = document.createElement('div');
    body.className = 'plugin-control-content';
    body.append(...this._createTabPanels());

    const status = document.createElement('div');
    status.className = 'plugin-control-status';
    status.textContent = this._state.status;
    this._statusEl = status;

    const resizeHandle = document.createElement('div');
    resizeHandle.className = this._resizeHandleClassName();
    resizeHandle.addEventListener('pointerdown', (event) => this._startPanelResize(event));

    panel.append(header, tabs, body, status, resizeHandle);
    return panel;
  }

  private _resizeHandleClassName(): string {
    const position = this._actualControlPosition();
    const horizontal = position.endsWith('right') ? 'left' : 'right';
    const vertical = position.startsWith('bottom') ? 'top' : 'bottom';
    return `plugin-resize-handle plugin-resize-${horizontal} plugin-resize-${vertical}`;
  }

  private _actualControlPosition(): ControlPosition {
    const parent = this._container?.parentElement;
    if (parent?.classList.contains('maplibregl-ctrl-top-left')) return 'top-left';
    if (parent?.classList.contains('maplibregl-ctrl-top-right')) return 'top-right';
    if (parent?.classList.contains('maplibregl-ctrl-bottom-left')) return 'bottom-left';
    if (parent?.classList.contains('maplibregl-ctrl-bottom-right')) return 'bottom-right';
    return this._options.position;
  }

  private _updateResizeHandlePlacement(): void {
    const resizeHandle = this._panel?.querySelector('.plugin-resize-handle');
    if (resizeHandle) resizeHandle.className = this._resizeHandleClassName();
  }

  private _startPanelResize(event: PointerEvent): void {
    if (!this._panel || !this._mapContainer) return;
    event.preventDefault();
    event.stopPropagation();

    this._resizeCleanup?.();

    const position = this._actualControlPosition();
    const rightAnchored = position.endsWith('right');
    const bottomAnchored = position.startsWith('bottom');
    const mapRect = this._mapContainer.getBoundingClientRect();
    const panelRect = this._panel.getBoundingClientRect();
    const startLeft = panelRect.left - mapRect.left;
    const startTop = panelRect.top - mapRect.top;
    const startWidth = panelRect.width;
    const startHeight = panelRect.height;
    const startX = event.clientX;
    const startY = event.clientY;
    const edgeMargin = 12;
    const minWidth = 320;
    const minHeight = 320;
    const maxWidth = rightAnchored ? startLeft + startWidth - edgeMargin : mapRect.width - startLeft - edgeMargin;
    const maxHeight = bottomAnchored ? startTop + startHeight - edgeMargin : mapRect.height - startTop - edgeMargin;

    const clampSize = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

    const onMove = (moveEvent: PointerEvent): void => {
      if (!this._panel) return;
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const width = clampSize(rightAnchored ? startWidth - dx : startWidth + dx, minWidth, maxWidth);
      const height = clampSize(bottomAnchored ? startHeight - dy : startHeight + dy, minHeight, maxHeight);
      const left = rightAnchored ? startLeft + startWidth - width : startLeft;
      const top = bottomAnchored ? startTop + startHeight - height : startTop;

      this._panel.style.width = `${Math.round(width)}px`;
      this._panel.style.height = `${Math.round(height)}px`;
      this._panel.style.left = `${Math.round(left)}px`;
      this._panel.style.top = `${Math.round(top)}px`;
    };

    const onUp = (): void => {
      this._resizeCleanup?.();
      this._resizeCleanup = undefined;
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp, { once: true });
    this._resizeCleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }

  private _createTabs(): HTMLElement {
    const tabRow = document.createElement('div');
    tabRow.className = 'plugin-control-tabs';

    TABS.forEach(({ id, label }) => {
      const btn = document.createElement('button');
      btn.className = `plugin-control-tab ${id === this._activeTab ? 'active' : ''}`;
      btn.textContent = label;
      btn.type = 'button';
      btn.dataset.tabId = id;
      btn.addEventListener('click', () => this._switchTab(id));
      tabRow.appendChild(btn);
    });

    return tabRow;
  }

  private _switchTab(tabId: string): void {
    this._activeTab = tabId;
    this._panel?.querySelectorAll('.plugin-control-tab').forEach((el) => {
      const button = el as HTMLButtonElement;
      button.classList.toggle('active', button.dataset.tabId === tabId);
    });
    this._panel?.querySelectorAll('.plugin-tab-panel').forEach((el) => {
      el.classList.toggle('active', (el as HTMLElement).dataset.tab === tabId);
    });
    if (!this._state.collapsed) this._positionPanel();
  }

  private _createTabPanels(): HTMLElement[] {
    return [
      this._catalogPanel(),
      this._searchPanel(),
      this._loadPanel(),
      this._layersPanel(),
      this._inspectorPanel(),
      this._codePanel(),
      this._authPanel(),
    ];
  }

  private _panelShell(tab: string, title: string): HTMLElement {
    const el = document.createElement('div');
    el.className = `plugin-tab-panel ${tab === this._activeTab ? 'active' : ''}`;
    el.dataset.tab = tab;
    const h = document.createElement('h4');
    h.textContent = title;
    h.className = 'plugin-tab-heading';
    el.appendChild(h);
    return el;
  }

  private _catalogPanel(): HTMLElement {
    const el = this._panelShell('catalog', 'Browse Earth Engine datasets');

    const sourceSelect = document.createElement('select');
    sourceSelect.className = 'plugin-control-input';
    sourceSelect.innerHTML =
      '<option value="all">All sources</option><option value="official">Official</option><option value="community">Community</option>';

    const fetchBtn = document.createElement('button');
    fetchBtn.className = 'plugin-control-button';
    fetchBtn.textContent = 'Fetch catalogs';

    const count = document.createElement('div');
    count.className = 'plugin-control-placeholder';
    const categoryList = document.createElement('div');
    categoryList.className = 'plugin-list';
    const details = document.createElement('div');
    details.className = 'plugin-detail';
    const openDatasetBtn = document.createElement('button');
    openDatasetBtn.className = 'plugin-control-button plugin-control-button-muted';
    openDatasetBtn.textContent = 'Open dataset page';
    openDatasetBtn.disabled = true;

    const renderDetails = (item?: CatalogItem): void => {
      if (!item) {
        details.textContent = 'Select a dataset to see details.';
        openDatasetBtn.disabled = true;
        return;
      }
      this._selectedCatalogItem = item;
      openDatasetBtn.disabled = false;
      details.innerHTML = `
        <div><strong>${item.title}</strong></div>
        <div>ID: ${item.id}</div>
        <div>Provider: ${item.provider ?? 'Unknown'}</div>
        <div>Type: ${item.type ?? 'Unknown'}</div>
        <div>Source: ${item.source}</div>
        <div>Tags: ${item.tags.join(', ') || 'None'}</div>
        <div>${item.snippet ?? 'No description available.'}</div>
      `;
    };

    const populateLoadBtn = document.createElement('button');
    populateLoadBtn.className = 'plugin-control-button plugin-control-button-muted';
    populateLoadBtn.textContent = 'Use in Load tab';
    populateLoadBtn.addEventListener('click', () => {
      if (!this._selectedCatalogItem) return;
      this._selectedAssetId = this._selectedCatalogItem.id;
      if (this._loadAssetInput) this._loadAssetInput.value = this._selectedCatalogItem.id;
      this._switchTab('load');
      this._setStatus(`Populated Load tab with ${this._selectedCatalogItem.id}`);
    });
    openDatasetBtn.addEventListener('click', () => {
      if (!this._selectedCatalogItem) return;
      window.open(
        this._selectedCatalogItem.url ?? this._earthEngineDatasetUrl(this._selectedCatalogItem.id),
        '_blank',
        'noopener,noreferrer',
      );
    });

    const renderCatalog = (): void => {
      const source = sourceSelect.value as CatalogQuery['source'];
      const filtered = queryCatalog(this._catalog, {
        source,
        sortBy: 'title',
        sortDir: 'asc',
        limit: 1000,
        page: 1,
      });
      count.textContent = `Result count: ${filtered.total}`;

      const grouped = groupCatalogByCategory(filtered.items);
      const groups = Object.keys(grouped)
        .sort()
        .map((category) => {
          const wrap = document.createElement('div');
          wrap.className = 'plugin-group';
          const title = document.createElement('div');
          title.className = 'plugin-group-title';
          title.textContent = `${category} (${grouped[category].length})`;
          wrap.appendChild(title);

          grouped[category].slice(0, 8).forEach((item) => {
            const btn = document.createElement('button');
            btn.className = 'plugin-list-item';
            btn.type = 'button';
            btn.textContent = item.title;
            btn.addEventListener('click', () => renderDetails(item));
            wrap.appendChild(btn);
          });
          return wrap;
        });

      categoryList.replaceChildren(...groups);
      renderDetails();
    };

    sourceSelect.addEventListener('change', renderCatalog);
    fetchBtn.addEventListener('click', async () => {
      this._catalog = [];
      this._catalogFetchPromise = undefined;
      await this._ensureCatalogsFetched();
    });

    el.append(sourceSelect, fetchBtn, count, categoryList, details, populateLoadBtn, openDatasetBtn);
    this._catalogRefreshHandlers.push(renderCatalog);
    renderDetails();
    return el;
  }

  private _searchPanel(): HTMLElement {
    const el = this._panelShell('search', 'Search catalog');
    const keyword = document.createElement('input');
    keyword.className = 'plugin-control-input';
    keyword.placeholder = 'keyword';

    const source = document.createElement('select');
    source.className = 'plugin-control-input';
    source.innerHTML =
      '<option value="all">All sources</option><option value="official">Official</option><option value="community">Community</option>';

    const type = document.createElement('input');
    type.className = 'plugin-control-input';
    type.placeholder = 'type filter (optional)';

    const sort = document.createElement('select');
    sort.className = 'plugin-control-input';
    sort.innerHTML = '<option value="title">Sort by title</option><option value="id">Sort by id</option>';

    const limit = document.createElement('input');
    limit.className = 'plugin-control-input';
    limit.type = 'number';
    limit.min = '1';
    limit.max = '200';
    limit.value = '100';

    const page = document.createElement('input');
    page.className = 'plugin-control-input';
    page.type = 'number';
    page.min = '1';
    page.value = '1';

    const count = document.createElement('div');
    count.className = 'plugin-control-placeholder';
    const list = document.createElement('div');
    list.className = 'plugin-list';

    const render = (): void => {
      const q: CatalogQuery = {
        keyword: keyword.value,
        source: source.value as CatalogQuery['source'],
        type: type.value.trim() || 'all',
        sortBy: sort.value as CatalogQuery['sortBy'],
        sortDir: 'asc',
        limit: Number(limit.value) || 100,
        page: Number(page.value) || 1,
      };
      const result = queryCatalog(this._catalog, q);
      count.textContent = `Results: ${result.total} | page ${result.page} | page size ${result.pageSize}`;
      list.replaceChildren(
        ...result.items.map((item) => {
          const btn = document.createElement('button');
          btn.className = 'plugin-list-item';
          btn.type = 'button';
          btn.textContent = `${item.title} (${item.id})`;
          btn.addEventListener('click', () => {
            this._selectedAssetId = item.id;
            this._selectedCatalogItem = item;
            if (this._loadAssetInput) this._loadAssetInput.value = item.id;
            this.setState({ selectedAssetId: item.id });
            this._setStatus(`Selected ${item.id}`);
            this._switchTab('load');
          });
          return btn;
        }),
      );
    };

    [keyword, source, type, sort, limit, page].forEach((input) => input.addEventListener('input', render));

    el.append(keyword, source, type, sort, limit, page, count, list);
    this._catalogRefreshHandlers.push(render);
    return el;
  }

  private _loadPanel(): HTMLElement {
    const el = this._panelShell('load', 'Load dataset / collection');
    const asset = document.createElement('input');
    asset.className = 'plugin-control-input';
    asset.value = this._selectedAssetId;
    this._loadAssetInput = asset;

    const dateStart = document.createElement('input');
    dateStart.className = 'plugin-control-input';
    dateStart.type = 'date';

    const dateEnd = document.createElement('input');
    dateEnd.className = 'plugin-control-input';
    dateEnd.type = 'date';

    const cloudProp = document.createElement('input');
    cloudProp.className = 'plugin-control-input';
    cloudProp.placeholder = 'CLOUDY_PIXEL_PERCENTAGE';

    const cloudThreshold = document.createElement('input');
    cloudThreshold.className = 'plugin-control-input';
    cloudThreshold.type = 'number';
    cloudThreshold.value = '20';

    const reducer = document.createElement('select');
    reducer.className = 'plugin-control-input';
    reducer.innerHTML =
      '<option value="median">median</option><option value="mean">mean</option><option value="max">max</option><option value="min">min</option>';

    const bands = document.createElement('input');
    bands.className = 'plugin-control-input';
    bands.placeholder = 'bands,comma,separated';

    const min = document.createElement('input');
    min.type = 'number';
    min.value = '0';
    min.className = 'plugin-control-input';

    const max = document.createElement('input');
    max.type = 'number';
    max.value = '3000';
    max.className = 'plugin-control-input';

    const palette = document.createElement('input');
    palette.className = 'plugin-control-input';
    palette.placeholder = 'black,white';

    const opacity = document.createElement('input');
    opacity.type = 'number';
    opacity.step = '0.1';
    opacity.min = '0';
    opacity.max = '1';
    opacity.value = '1';
    opacity.className = 'plugin-control-input';

    const toVis = (): VisualizeOptions => ({
      bands: bands.value || undefined,
      min: Number(min.value),
      max: Number(max.value),
      palette: palette.value || undefined,
      opacity: Number(opacity.value),
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'plugin-control-button';
    addBtn.textContent = 'Add layer';
    addBtn.addEventListener('click', async () => {
      try {
        const vis = toVis();
        await this.loadAsset(asset.value.trim(), vis);
      } catch (error) {
        this._setStatus(`Load failed: ${(error as Error).message}`);
      }
    });

    const updateBtn = document.createElement('button');
    updateBtn.className = 'plugin-control-button plugin-control-button-muted';
    updateBtn.textContent = 'Update existing layer';
    updateBtn.addEventListener('click', async () => {
      if (!this._loadedLayer) {
        this._setStatus('No existing layer to update. Add one first.');
        return;
      }
      try {
        const assetId = asset.value.trim();
        await this.authenticate();
        await this._renderManagedLayer(assetId, toVis(), { assetId, name: assetId }, this._loadedLayer);
        this._selectedAssetId = assetId;
        this.setState({ selectedAssetId: assetId });
        this._setStatus(`Updated ${assetId}`);
      } catch (error) {
        this._setStatus(`Update failed: ${(error as Error).message}`);
      }
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'plugin-control-button plugin-control-button-danger';
    removeBtn.textContent = 'Remove layer';
    removeBtn.addEventListener('click', () => {
      if (!this._loadedLayer) return;
      this._removeManagedLayer(this._loadedLayer.id);
      this._setStatus('Layer removed.');
    });

    const openDatasetBtn = document.createElement('button');
    openDatasetBtn.className = 'plugin-control-button plugin-control-button-muted';
    openDatasetBtn.textContent = 'Open dataset page';
    openDatasetBtn.addEventListener('click', () => {
      const assetId = asset.value.trim();
      if (!assetId) {
        this._setStatus('Enter an asset ID before opening the dataset page.');
        return;
      }
      window.open(this._catalogUrlForAsset(assetId), '_blank', 'noopener,noreferrer');
    });

    const optionsNote = document.createElement('p');
    optionsNote.className = 'plugin-control-placeholder';
    optionsNote.textContent = `Collection options: ${dateStart.value || 'start?'} to ${dateEnd.value || 'end?'}, cloud ${cloudProp.value || 'property'} <= ${cloudThreshold.value}, reducer ${reducer.value}`;

    const fields: Array<{
      label: string;
      input: HTMLInputElement | HTMLSelectElement;
    }> = [
      { label: 'Asset ID', input: asset },
      { label: 'Date start', input: dateStart },
      { label: 'Date end', input: dateEnd },
      { label: 'Cloud filter property', input: cloudProp },
      { label: 'Cloud threshold', input: cloudThreshold },
      { label: 'Reducer', input: reducer },
      { label: 'Bands', input: bands },
      { label: 'Min', input: min },
      { label: 'Max', input: max },
      { label: 'Palette', input: palette },
      { label: 'Opacity', input: opacity },
    ];

    fields.forEach(({ label, input }) => {
      const group = document.createElement('div');
      group.className = 'plugin-control-group';
      const lbl = document.createElement('label');
      lbl.className = 'plugin-control-label';
      lbl.textContent = label;
      group.append(lbl, input);
      el.appendChild(group);
    });

    el.append(addBtn, updateBtn, removeBtn, openDatasetBtn, optionsNote);
    return el;
  }

  private _layersPanel(): HTMLElement {
    const el = this._panelShell('layers', 'Earth Engine layers');
    this._layersListEl = document.createElement('div');
    this._layersListEl.className = 'plugin-layer-list';
    this._renderLayersList();
    el.appendChild(this._layersListEl);
    return el;
  }

  private _renderLayersList(): void {
    this._renderInspectorLayerOptions();
    if (!this._layersListEl) return;

    if (!this._layers.length) {
      const empty = document.createElement('div');
      empty.className = 'plugin-control-placeholder';
      empty.textContent = 'No Earth Engine layers added.';
      this._layersListEl.replaceChildren(empty);
      return;
    }

    this._layersListEl.replaceChildren(
      ...this._layers
        .slice()
        .reverse()
        .map((layer) => this._layerListItem(layer)),
    );
  }

  private _layerListItem(layer: LoadedLayerState): HTMLElement {
    const item = document.createElement('div');
    item.className = `plugin-layer-item ${this._loadedLayer?.id === layer.id ? 'active' : ''}`;

    const row = document.createElement('div');
    row.className = 'plugin-layer-row';

    const visibility = document.createElement('input');
    visibility.className = 'plugin-layer-checkbox';
    visibility.type = 'checkbox';
    visibility.checked = layer.visible;
    visibility.title = 'Toggle visibility';
    visibility.addEventListener('change', () => {
      layer.visible = visibility.checked;
      this._applyLayerVisibility(layer);
      this._setStatus(`${layer.visible ? 'Shown' : 'Hidden'} ${layer.name}`);
    });

    const title = document.createElement('button');
    title.className = 'plugin-layer-title';
    title.type = 'button';
    title.textContent = layer.name;
    title.addEventListener('click', () => {
      this._loadedLayer = layer;
      if (layer.assetId) {
        this._selectedAssetId = layer.assetId;
        if (this._loadAssetInput) this._loadAssetInput.value = layer.assetId;
        this.setState({ selectedAssetId: layer.assetId });
      }
      this._renderLayersList();
      this._renderInspectorLayerOptions();
      this._setStatus(`Selected ${layer.name}`);
    });

    const opacity = document.createElement('input');
    opacity.className = 'plugin-layer-opacity';
    opacity.type = 'range';
    opacity.min = '0';
    opacity.max = '1';
    opacity.step = '0.05';
    opacity.value = String(layer.opacity);
    opacity.title = 'Opacity';
    opacity.addEventListener('input', () => {
      layer.opacity = Number(opacity.value);
      this._applyLayerOpacity(layer);
    });
    opacity.addEventListener('change', () => {
      this._setStatus(`Updated opacity for ${layer.name}`);
    });

    const remove = document.createElement('button');
    remove.className = 'plugin-layer-icon-button';
    remove.type = 'button';
    remove.textContent = 'x';
    remove.title = 'Remove layer';
    remove.addEventListener('click', () => {
      this._removeManagedLayer(layer.id);
      this._setStatus(`Removed ${layer.name}`);
    });

    row.append(visibility, title, opacity, remove);
    item.append(row);
    return item;
  }

  private _inspectorPanel(): HTMLElement {
    const el = this._panelShell('inspector', 'Inspect Earth Engine objects');

    const layerSelect = document.createElement('select');
    layerSelect.className = 'plugin-control-input';
    layerSelect.addEventListener('change', () => {
      const layer = this._layers.find((item) => item.id === layerSelect.value);
      if (!layer) return;
      this._loadedLayer = layer;
      this._renderLayersList();
      this._setStatus(`Selected ${layer.name}`);
    });
    this._inspectorLayerSelect = layerSelect;
    this._renderInspectorLayerOptions();

    const objectBtn = document.createElement('button');
    objectBtn.className = 'plugin-control-button';
    objectBtn.textContent = 'Inspect object';
    objectBtn.addEventListener('click', async () => {
      try {
        const layer = this._selectedInspectorLayer();
        await this.authenticate();
        this._setStatus(`Inspecting ${layer.name}...`);
        const result = await this._evaluateEeObject(layer.eeObject);
        this._showInspectorResult({
          layer: layer.name,
          assetId: layer.assetId,
          object: result,
        });
        this._setStatus(`Object inspection complete for ${layer.name}.`);
      } catch (error) {
        this._setStatus(`Object inspect failed: ${(error as Error).message}`);
      }
    });

    const lon = document.createElement('input');
    lon.className = 'plugin-control-input';
    lon.type = 'number';
    lon.step = 'any';
    lon.value = '-122.292';
    this._inspectorLonInput = lon;

    const lat = document.createElement('input');
    lat.className = 'plugin-control-input';
    lat.type = 'number';
    lat.step = 'any';
    lat.value = '37.901';
    this._inspectorLatInput = lat;

    const scale = document.createElement('input');
    scale.className = 'plugin-control-input';
    scale.type = 'number';
    scale.min = '1';
    scale.value = '30';
    this._inspectorScaleInput = scale;

    const inspectPixel = document.createElement('button');
    inspectPixel.className = 'plugin-control-button';
    inspectPixel.textContent = 'Inspect point';
    inspectPixel.addEventListener('click', async () => {
      await this._inspectPixelAt(Number(lon.value), Number(lat.value));
    });

    const clickToggle = document.createElement('button');
    clickToggle.className = 'plugin-control-button plugin-control-button-muted';
    clickToggle.textContent = 'Enable map click';
    clickToggle.addEventListener('click', () => {
      if (this._inspectorActive) {
        this._disableInspector();
        clickToggle.textContent = 'Enable map click';
      } else {
        this._enableInspector();
        clickToggle.textContent = 'Disable map click';
      }
    });

    this._inspectorResultsEl = document.createElement('pre');
    this._inspectorResultsEl.className = 'plugin-control-placeholder plugin-inspector-output';
    this._inspectorResultsEl.textContent = 'No inspection result.';

    [
      { label: 'Layer', input: layerSelect },
      { label: 'Longitude', input: lon },
      { label: 'Latitude', input: lat },
      { label: 'Scale', input: scale },
    ].forEach(({ label, input }) => {
      const group = document.createElement('div');
      group.className = 'plugin-control-group';
      const lbl = document.createElement('label');
      lbl.className = 'plugin-control-label';
      lbl.textContent = label;
      group.append(lbl, input);
      el.appendChild(group);
    });

    el.append(objectBtn, inspectPixel, clickToggle, this._inspectorResultsEl);
    return el;
  }

  private _renderInspectorLayerOptions(): void {
    if (!this._inspectorLayerSelect) return;

    const currentId = this._inspectorLayerSelect.value || this._loadedLayer?.id;
    this._inspectorLayerSelect.replaceChildren();

    if (!this._layers.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No Earth Engine layers added';
      this._inspectorLayerSelect.appendChild(option);
      this._inspectorLayerSelect.disabled = true;
      return;
    }

    this._inspectorLayerSelect.disabled = false;
    this._layers
      .slice()
      .reverse()
      .forEach((layer) => {
        const option = document.createElement('option');
        option.value = layer.id;
        option.textContent = layer.name;
        this._inspectorLayerSelect?.appendChild(option);
      });

    const selected =
      this._layers.find((layer) => layer.id === currentId) ??
      this._loadedLayer ??
      this._layers[this._layers.length - 1];
    this._inspectorLayerSelect.value = selected.id;
  }

  private _selectedInspectorLayer(): LoadedLayerState {
    const selectedId = this._inspectorLayerSelect?.value || this._loadedLayer?.id;
    const layer = this._layers.find((item) => item.id === selectedId) ?? this._loadedLayer;
    if (!layer) throw new Error('Add an Earth Engine layer before using the inspector.');
    return layer;
  }

  private _enableInspector(): void {
    if (!this._map || this._inspectorClickHandler) return;
    this._inspectorActive = true;
    const canvas = this._map.getCanvas();
    this._previousMapCursor = canvas.style.cursor;
    canvas.style.cursor = 'crosshair';
    this._inspectorClickHandler = async (e: { lngLat: { lng: number; lat: number } }) => {
      const lon = e.lngLat.lng;
      const lat = e.lngLat.lat;
      if (this._inspectorLonInput) this._inspectorLonInput.value = String(Number(lon.toFixed(6)));
      if (this._inspectorLatInput) this._inspectorLatInput.value = String(Number(lat.toFixed(6)));
      await this._inspectPixelAt(lon, lat);
    };
    this._map.on('click', this._inspectorClickHandler as never);
    this._setStatus('Map click inspector enabled.');
  }

  private _disableInspector(): void {
    if (this._map && this._inspectorClickHandler) {
      this._map.off('click', this._inspectorClickHandler as never);
    }
    if (this._map && this._previousMapCursor !== undefined) {
      this._map.getCanvas().style.cursor = this._previousMapCursor;
    }
    this._previousMapCursor = undefined;
    this._inspectorClickHandler = undefined;
    this._inspectorActive = false;
  }

  private async _inspectPixelAt(lon: number, lat: number): Promise<void> {
    try {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        throw new Error('Enter valid longitude and latitude values.');
      }
      const layer = this._selectedInspectorLayer();
      const scale = Number(this._inspectorScaleInput?.value || 30);

      await this.authenticate();
      this._setStatus(`Inspecting ${layer.name} at point...`);
      const point = ee.Geometry.Point([lon, lat]);
      const result = await this._inspectLayerAtPoint(layer, point, scale);
      this._showInspectorResult({ layer: layer.name, lon, lat, ...result });
      this._setStatus(`Point inspection complete for ${layer.name}.`);
    } catch (error) {
      this._setStatus(`Point inspect failed: ${(error as Error).message}`);
    }
  }

  private async _inspectLayerAtPoint(
    layer: LoadedLayerState,
    point: object,
    scale: number,
  ): Promise<Record<string, unknown>> {
    const image = this._imageObjectForPixelInspection(layer);
    if (image) {
      const values = image.reduceRegion({
        reducer: ee.Reducer.first(),
        geometry: point,
        scale,
        maxPixels: 100000000,
      });
      return {
        type: 'pixel',
        scale,
        values: await this._evaluateEeObject(values),
      };
    }

    const attributes = this._featureAttributesForPointInspection(layer, point);
    if (attributes) {
      return {
        type: 'feature',
        attributes: await this._evaluateEeObject(attributes),
      };
    }

    throw new Error(`Layer "${layer.name}" is not inspectable at a point.`);
  }

  private _imageObjectForPixelInspection(layer: LoadedLayerState): {
    reduceRegion: (params: Record<string, unknown>) => unknown;
  } | undefined {
    const input = layer.eeObject as {
      reduceRegion?: (params: Record<string, unknown>) => unknown;
      mosaic?: () => unknown;
    };

    if (typeof input.reduceRegion === 'function') {
      return { reduceRegion: input.reduceRegion.bind(input) };
    }

    if (typeof input.mosaic === 'function') {
      const mosaic = input.mosaic() as {
        reduceRegion?: (params: Record<string, unknown>) => unknown;
      };
      if (typeof mosaic.reduceRegion === 'function') {
        return { reduceRegion: mosaic.reduceRegion.bind(mosaic) };
      }
    }

    return undefined;
  }

  private _featureAttributesForPointInspection(layer: LoadedLayerState, point: object): unknown {
    const input = layer.eeObject as {
      filterBounds?: (geometry: object) => unknown;
    };

    if (typeof input.filterBounds !== 'function') {
      return undefined;
    }

    const filtered = input.filterBounds(point) as {
      first?: () => unknown;
      limit?: (count: number) => unknown;
    };
    const firstFeature =
      typeof filtered?.first === 'function'
        ? filtered.first()
        : typeof filtered?.limit === 'function'
          ? this._firstFeatureFromLimitedCollection(filtered.limit(1))
          : undefined;
    const feature = firstFeature as {
      toDictionary?: () => unknown;
      setGeometry?: (geometry: null) => { toDictionary?: () => unknown };
    };

    if (typeof feature?.toDictionary === 'function') {
      return feature.toDictionary();
    }

    if (typeof feature?.setGeometry === 'function') {
      const withoutGeometry = feature.setGeometry(null);
      if (typeof withoutGeometry?.toDictionary === 'function') return withoutGeometry.toDictionary();
    }

    return undefined;
  }

  private _firstFeatureFromLimitedCollection(collection: unknown): unknown {
    const featureCollection = collection as {
      first?: () => unknown;
    };
    return typeof featureCollection?.first === 'function' ? featureCollection.first() : undefined;
  }

  private _showInspectorResult(result: unknown): void {
    if (!this._inspectorResultsEl) return;
    this._inspectorResultsEl.textContent =
      typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  }

  private _codePanel(): HTMLElement {
    const el = this._panelShell('code', 'Run Earth Engine script');
    const code = document.createElement('textarea');
    code.className = 'plugin-control-input plugin-code';
    code.value = `// Load an image.
var image = ee.Image('LANDSAT/LC08/C02/T1_TOA/LC08_044034_20140318');

// Define the visualization parameters.
var vizParams = {
  bands: ['B5', 'B4', 'B3'],
  min: 0,
  max: 0.5,
  gamma: [0.95, 1.1, 1]
};

// Center the map and display the image.
Map.setCenter(-122.1899, 37.5010, 10);
Map.addLayer(image, vizParams, 'false color composite');`;

    const btn = document.createElement('button');
    btn.className = 'plugin-control-button';
    btn.textContent = 'Run script';
    btn.addEventListener('click', async () => {
      try {
        await this.runScript(code.value, {});
      } catch (error) {
        this._setStatus(`Script failed: ${(error as Error).message}`);
      }
    });

    el.append(code, btn);
    return el;
  }

  private _authPanel(): HTMLElement {
    const el = this._panelShell('auth', 'Earth Engine authentication');
    const hasConfiguredOauthClient = Boolean(this._oauthClientId || this._options.accessToken);

    const oauthClient = document.createElement('input');
    oauthClient.className = 'plugin-control-input';
    oauthClient.placeholder = 'Google OAuth client ID';
    oauthClient.autocomplete = 'off';
    oauthClient.value = this._oauthClientId;
    this._authOAuthClientInput = oauthClient;
    if (hasConfiguredOauthClient) {
      oauthClient.type = 'hidden';
    }

    const project = document.createElement('input');
    project.className = 'plugin-control-input';
    project.placeholder = 'Google Cloud project ID';
    project.autocomplete = 'off';
    project.value = this._projectId;
    this._authProjectInput = project;
    project.addEventListener('input', () => {
      this._projectId = project.value.trim();
      this._storeProjectId(this._projectId);
    });

    const authStatus = document.createElement('div');
    authStatus.className = 'plugin-control-placeholder';
    authStatus.textContent = `Auth status: ${this._state.authenticated ? 'Authenticated' : 'Not authenticated'}`;

    const btn = document.createElement('button');
    btn.className = 'plugin-control-button';
    btn.textContent = 'Sign in to Earth Engine';
    btn.addEventListener('click', async () => {
      try {
        await this.authenticate(project.value, oauthClient.value);
        authStatus.textContent = `Auth status: ${this._state.authenticated ? 'Authenticated' : 'Not authenticated'}`;
      } catch (error) {
        this.setState({ authenticated: false });
        const message = (error as Error).message;
        authStatus.textContent = `Auth status: Not authenticated. ${message}`;
        this._setStatus(`Auth failed: ${message}`);
      }
    });

    const help = document.createElement('p');
    help.className = 'plugin-control-placeholder';
    help.textContent = hasConfiguredOauthClient
      ? 'Enter an Earth Engine-enabled Google Cloud project ID, then sign in with your Google account.'
      : 'Enter an OAuth client ID and an Earth Engine-enabled Google Cloud project ID, then sign in with your Google account.';

    el.append(oauthClient, project, btn, authStatus, help);
    return el;
  }

  private _positionPanel(): void {
    if (!this._panel || !this._container || !this._mapContainer) return;
    this._updateResizeHandlePlacement();

    const mapRect = this._mapContainer.getBoundingClientRect();
    const controlRect = this._container.getBoundingClientRect();
    const panelRect = this._panel.getBoundingClientRect();

    const edgeMargin = 12;
    const rightMargin = 0;
    const verticalGap = 8;

    const position = this._actualControlPosition();
    let left: number;
    let top: number;

    if (position === 'top-right') {
      left = controlRect.right - mapRect.left - panelRect.width - rightMargin;
      top = controlRect.bottom - mapRect.top + verticalGap;
    } else if (position === 'top-left') {
      left = controlRect.left - mapRect.left + edgeMargin;
      top = controlRect.bottom - mapRect.top + verticalGap;
    } else if (position === 'bottom-right') {
      left = controlRect.right - mapRect.left - panelRect.width - rightMargin;
      top = controlRect.top - mapRect.top - panelRect.height - verticalGap;
    } else {
      left = controlRect.left - mapRect.left + edgeMargin;
      top = controlRect.top - mapRect.top - panelRect.height - verticalGap;
    }

    const maxLeft = Math.max(edgeMargin, mapRect.width - panelRect.width - edgeMargin);
    const maxTop = Math.max(edgeMargin, mapRect.height - panelRect.height - edgeMargin);

    left = Math.min(Math.max(edgeMargin, left), maxLeft);
    top = Math.min(Math.max(edgeMargin, top), maxTop);

    this._panel.style.left = `${Math.round(left)}px`;
    this._panel.style.top = `${Math.round(top)}px`;
    this._panel.style.right = 'auto';
    this._panel.style.bottom = 'auto';
  }

  private _setupEventListeners(): void {
    this._documentClickHandler = (e: MouseEvent) => {
      if (this._inspectorActive) return;
      const target = e.target as Node;
      if (this._container && this._panel && !this._container.contains(target) && !this._panel.contains(target)) {
        this.collapse();
      }
    };
    document.addEventListener('click', this._documentClickHandler);

    this._windowResizeHandler = () => {
      if (!this._state.collapsed) this._positionPanel();
    };
    window.addEventListener('resize', this._windowResizeHandler);

    this._mapResizeHandler = () => {
      if (!this._state.collapsed) this._positionPanel();
    };
    this._map?.on('resize', this._mapResizeHandler);
  }
}
