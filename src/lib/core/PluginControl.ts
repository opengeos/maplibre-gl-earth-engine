import ee from '@google/earthengine';
import type { IControl, Map as MapLibreMap } from 'maplibre-gl';
import { authenticateWithServiceAccount } from '../ee/auth';
import {
  fetchCatalogs,
  groupCatalogByCategory,
  queryCatalog,
  type CatalogItem,
  type CatalogQuery,
} from '../ee/catalog';
import { addTileUrlLayer, renderEeLayer, type VisualizeOptions } from '../ee/layer';
import {
  createEndpointClient,
  normalizeEndpointUrl,
  type EndpointClient,
  type EndpointExportPayload,
  type EndpointInspectPayload,
  type EndpointTimeSeriesPayload,
} from '../ee/endpoint';
import type {
  PluginControlOptions,
  PluginState,
  PluginControlEvent,
  PluginControlEventHandler,
  PluginStatus,
} from './types';

const DEFAULT_OPTIONS: Required<PluginControlOptions> = {
  collapsed: true,
  position: 'top-right',
  title: 'Earth Engine',
  panelWidth: 420,
  maxHeight: '78vh',
  className: '',
};

type EventHandlersMap = globalThis.Map<PluginControlEvent, Set<PluginControlEventHandler>>;

interface LoadedLayerState {
  sourceId: string;
  layerId: string;
  assetId: string;
}

interface TimeFrame {
  label: string;
  startDate: string;
  endDate: string;
  tileUrl?: string;
}

const TABS: Array<{ id: string; label: string }> = [
  { id: 'catalog', label: 'Browse/Catalog' },
  { id: 'search', label: 'Search' },
  { id: 'load', label: 'Load' },
  { id: 'timeseries', label: 'Time Series' },
  { id: 'inspector', label: 'Inspector' },
  { id: 'code', label: 'Code' },
  { id: 'export', label: 'Export' },
  { id: 'settings', label: 'Settings' },
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
  private _selectedAssetId = 'USGS/SRTMGL1_003';
  private _selectedCatalogItem?: CatalogItem;
  private _activeTab = 'catalog';
  private _tileEndpoint = 'https://huggingface.co/spaces/giswqs/ee-tile-request';
  private _tileEndpointToken = '';
  private _endpointClient?: EndpointClient;

  private _loadAssetInput?: HTMLInputElement;
  private _loadedLayer?: LoadedLayerState;
  private _mapClickHandler?: (e: { lngLat: { lng: number; lat: number } }) => void;
  private _inspectorActive = false;
  private _inspectorResultsEl?: HTMLElement;
  private _timeSeriesFrames: TimeFrame[] = [];
  private _timeSeriesIndex = 0;
  private _timeSeriesListEl?: HTMLElement;
  private _documentClickHandler?: (e: MouseEvent) => void;
  private _windowResizeHandler?: () => void;
  private _mapResizeHandler?: () => void;

  constructor(options?: Partial<PluginControlOptions>) {
    this._options = { ...DEFAULT_OPTIONS, ...options };
    if (typeof window !== 'undefined') {
      this._tileEndpoint = normalizeEndpointUrl(
        window.localStorage.getItem('eeTileEndpoint') || this._tileEndpoint,
      );
      this._tileEndpointToken = window.localStorage.getItem('eeTileEndpointToken') || '';
    }
    this._state = {
      collapsed: this._options.collapsed,
      panelWidth: this._options.panelWidth,
      data: {},
      status: 'Ready',
      selectedAssetId: this._selectedAssetId,
      authenticated: false,
    };
    this._refreshEndpointClient();
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
      });
    }
    return this._container;
  }

  onRemove(): void {
    this._disableInspector();
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

  getState(): PluginState {
    return { ...this._state };
  }

  setState(newState: Partial<PluginState>): void {
    this._state = { ...this._state, ...newState };
    this._emit('statechange');
  }

  async authenticate(projectId?: string): Promise<void> {
    this._setStatus('Authenticating with EE service account…');
    const result = await authenticateWithServiceAccount(projectId);
    this.setState({ authenticated: result.ok });
    this._setStatus(result.message);
  }

  async loadAsset(assetId: string, vis: VisualizeOptions): Promise<void> {
    if (!this._map) throw new Error('Control is not attached to a map.');
    this._setStatus(`Rendering ${assetId}…`);
    const sourceId = 'ee-source';
    const layerId = 'ee-layer';

    if (this._endpointClient) {
      const tileUrl = await this._endpointClient.getTileUrl({ assetId, visParams: vis });
      addTileUrlLayer(this._map, tileUrl, vis, sourceId, layerId);
    } else {
      await renderEeLayer(this._map, assetId, vis, sourceId, layerId);
    }

    this._loadedLayer = { sourceId, layerId, assetId };
    this._selectedAssetId = assetId;
    this.setState({ selectedAssetId: assetId });
    this._setStatus(`Loaded ${assetId}`);
  }

  async runScript(script: string, vis: VisualizeOptions): Promise<void> {
    if (!this._map) throw new Error('Control is not attached to a map.');
    this._setStatus('Running script…');

    if (this._endpointClient) {
      const tileUrl = await this._endpointClient.getTileUrl({ script, visParams: vis });
      addTileUrlLayer(this._map, tileUrl, vis);
      this._setStatus('Script rendered successfully (endpoint).');
      return;
    }

    const fn = new Function('ee', `${script}`) as (eeNs: typeof ee) => unknown;
    const result = fn(ee);
    const target: string | object = typeof result === 'string' ? result : (result as object);
    if (!target) throw new Error('Script must return an asset ID string or an ee object.');

    await renderEeLayer(this._map, target, vis);
    this._setStatus('Script rendered successfully.');
  }

  toggle(): void {
    this._state.collapsed = !this._state.collapsed;
    this._panel?.classList.toggle('expanded', !this._state.collapsed);
    if (!this._state.collapsed) this._positionPanel();
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

  private _refreshEndpointClient(): void {
    if (!this._tileEndpoint.trim()) {
      this._endpointClient = undefined;
      return;
    }
    try {
      this._endpointClient = createEndpointClient({ endpoint: this._tileEndpoint, token: this._tileEndpointToken || undefined });
    } catch {
      this._endpointClient = undefined;
    }
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
      typeof this._options.maxHeight === 'number'
        ? `${this._options.maxHeight}px`
        : this._options.maxHeight;

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

    panel.append(header, tabs, body, status);
    return panel;
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
      this._timeSeriesPanel(),
      this._inspectorPanel(),
      this._codePanel(),
      this._exportPanel(),
      this._settingsPanel(),
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
    sourceSelect.innerHTML = '<option value="all">All sources</option><option value="official">Official</option><option value="community">Community</option>';

    const fetchBtn = document.createElement('button');
    fetchBtn.className = 'plugin-control-button';
    fetchBtn.textContent = 'Fetch catalogs';

    const count = document.createElement('div');
    count.className = 'plugin-control-placeholder';
    const categoryList = document.createElement('div');
    categoryList.className = 'plugin-list';
    const details = document.createElement('div');
    details.className = 'plugin-detail';

    const renderDetails = (item?: CatalogItem): void => {
      if (!item) {
        details.textContent = 'Select a dataset to see details.';
        return;
      }
      this._selectedCatalogItem = item;
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

    const renderCatalog = (): void => {
      const source = sourceSelect.value as CatalogQuery['source'];
      const filtered = queryCatalog(this._catalog, { source, sortBy: 'title', sortDir: 'asc', limit: 1000, page: 1 });
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
      try {
        this._setStatus('Fetching catalog metadata…');
        this._catalog = await fetchCatalogs();
        renderCatalog();
        this._setStatus(`Loaded ${this._catalog.length} datasets.`);
      } catch (error) {
        this._setStatus(`Catalog fetch failed: ${(error as Error).message}`);
      }
    });

    el.append(sourceSelect, fetchBtn, count, categoryList, details, populateLoadBtn);
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
    source.innerHTML = '<option value="all">All sources</option><option value="official">Official</option><option value="community">Community</option>';

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
    limit.value = '25';

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
        limit: Number(limit.value) || 25,
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
            if (this._loadAssetInput) this._loadAssetInput.value = item.id;
            this.setState({ selectedAssetId: item.id });
            this._setStatus(`Selected ${item.id}`);
          });
          return btn;
        }),
      );
    };

    [keyword, source, type, sort, limit, page].forEach((input) => input.addEventListener('input', render));

    el.append(keyword, source, type, sort, limit, page, count, list);
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
    reducer.innerHTML = '<option value="median">median</option><option value="mean">mean</option><option value="max">max</option><option value="min">min</option>';

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
        await this.loadAsset(asset.value.trim(), toVis());
      } catch (error) {
        this._setStatus(`Update failed: ${(error as Error).message}`);
      }
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'plugin-control-button plugin-control-button-danger';
    removeBtn.textContent = 'Remove layer';
    removeBtn.addEventListener('click', () => {
      if (!this._map || !this._loadedLayer) return;
      if (this._map.getLayer(this._loadedLayer.layerId)) this._map.removeLayer(this._loadedLayer.layerId);
      if (this._map.getSource(this._loadedLayer.sourceId)) this._map.removeSource(this._loadedLayer.sourceId);
      this._loadedLayer = undefined;
      this._setStatus('Layer removed.');
    });

    const optionsNote = document.createElement('p');
    optionsNote.className = 'plugin-control-placeholder';
    optionsNote.textContent = `Collection options: ${dateStart.value || 'start?'} to ${dateEnd.value || 'end?'}, cloud ${cloudProp.value || 'property'} <= ${cloudThreshold.value}, reducer ${reducer.value}`;

    const fields: Array<{ label: string; input: HTMLInputElement | HTMLSelectElement }> = [
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

    el.append(addBtn, updateBtn, removeBtn, optionsNote);
    return el;
  }

  private _timeSeriesPanel(): HTMLElement {
    const el = this._panelShell('timeseries', 'Time series (MVP)');

    const assetId = document.createElement('input');
    assetId.className = 'plugin-control-input';
    assetId.value = this._selectedAssetId;

    const start = document.createElement('input');
    start.className = 'plugin-control-input';
    start.type = 'date';

    const end = document.createElement('input');
    end.className = 'plugin-control-input';
    end.type = 'date';

    const frequency = document.createElement('select');
    frequency.className = 'plugin-control-input';
    frequency.innerHTML = '<option value="month">month</option><option value="week">week</option><option value="day">day</option><option value="year">year</option>';

    const reducer = document.createElement('select');
    reducer.className = 'plugin-control-input';
    reducer.innerHTML = '<option value="median">median</option><option value="mean">mean</option><option value="max">max</option><option value="min">min</option>';

    const descriptor = document.createElement('pre');
    descriptor.className = 'plugin-control-placeholder';
    this._timeSeriesListEl = document.createElement('div');
    this._timeSeriesListEl.className = 'plugin-list';

    const renderFrames = (): void => {
      if (!this._timeSeriesListEl) return;
      this._timeSeriesListEl.replaceChildren(
        ...this._timeSeriesFrames.map((frame, idx) => {
          const btn = document.createElement('button');
          btn.className = `plugin-list-item ${idx === this._timeSeriesIndex ? 'active' : ''}`;
          btn.type = 'button';
          btn.textContent = `${frame.label}: ${frame.startDate} → ${frame.endDate}`;
          btn.addEventListener('click', async () => {
            this._timeSeriesIndex = idx;
            await this._loadTimeSeriesFrame(assetId.value, frame, reducer.value);
            renderFrames();
          });
          return btn;
        }),
      );
    };

    const buildFrames = (): void => {
      const startDate = start.value;
      const endDate = end.value;
      if (!startDate || !endDate) return;
      const steps = 6;
      this._timeSeriesFrames = Array.from({ length: steps }).map((_, i) => ({
        label: `Frame ${i + 1}`,
        startDate,
        endDate,
      }));
      this._timeSeriesIndex = 0;
      descriptor.textContent = JSON.stringify(
        { assetId: assetId.value, startDate, endDate, frequency: frequency.value, reducer: reducer.value, steps },
        null,
        2,
      );
      renderFrames();
    };

    const generateBtn = document.createElement('button');
    generateBtn.className = 'plugin-control-button';
    generateBtn.textContent = 'Generate sequence';
    generateBtn.addEventListener('click', buildFrames);

    const prevBtn = document.createElement('button');
    prevBtn.className = 'plugin-control-button plugin-control-button-muted';
    prevBtn.textContent = 'Prev frame';
    prevBtn.addEventListener('click', async () => {
      if (!this._timeSeriesFrames.length) return;
      this._timeSeriesIndex = Math.max(0, this._timeSeriesIndex - 1);
      await this._loadTimeSeriesFrame(assetId.value, this._timeSeriesFrames[this._timeSeriesIndex], reducer.value);
      renderFrames();
    });

    const nextBtn = document.createElement('button');
    nextBtn.className = 'plugin-control-button plugin-control-button-muted';
    nextBtn.textContent = 'Next frame';
    nextBtn.addEventListener('click', async () => {
      if (!this._timeSeriesFrames.length) return;
      this._timeSeriesIndex = Math.min(this._timeSeriesFrames.length - 1, this._timeSeriesIndex + 1);
      await this._loadTimeSeriesFrame(assetId.value, this._timeSeriesFrames[this._timeSeriesIndex], reducer.value);
      renderFrames();
    });

    [
      { label: 'Asset ID', input: assetId },
      { label: 'Start date', input: start },
      { label: 'End date', input: end },
      { label: 'Frequency', input: frequency },
      { label: 'Reducer', input: reducer },
    ].forEach(({ label, input }) => {
      const group = document.createElement('div');
      group.className = 'plugin-control-group';
      const lbl = document.createElement('label');
      lbl.className = 'plugin-control-label';
      lbl.textContent = label;
      group.append(lbl, input);
      el.appendChild(group);
    });

    el.append(generateBtn, prevBtn, nextBtn, descriptor, this._timeSeriesListEl);
    return el;
  }

  private async _loadTimeSeriesFrame(assetId: string, frame: TimeFrame, reducer: string): Promise<void> {
    if (!this._map) return;
    if (!this._endpointClient) {
      this._setStatus('Time series requires endpoint mode.');
      return;
    }
    try {
      const payload: EndpointTimeSeriesPayload = {
        assetId,
        startDate: frame.startDate,
        endDate: frame.endDate,
        frequency: 'month',
        reducer,
      };
      const tsResponse = await this._endpointClient.requestTimeSeries(payload).catch(() => ({ notImplemented: true }));
      if (tsResponse.notImplemented) {
        this._setStatus('Time series endpoint not implemented; showing frame requests only.');
      }
      const tileUrl = await this._endpointClient.getTileUrl({
        assetId,
        dateRange: { start: frame.startDate, end: frame.endDate },
        reducer,
      });
      frame.tileUrl = tileUrl;
      addTileUrlLayer(this._map, tileUrl, { opacity: 1 }, 'ee-ts-source', 'ee-ts-layer');
      this._setStatus(`Loaded ${frame.label}`);
    } catch (error) {
      this._setStatus(`Time series load failed: ${(error as Error).message}`);
    }
  }

  private _inspectorPanel(): HTMLElement {
    const el = this._panelShell('inspector', 'Inspector (MVP)');
    const assetId = document.createElement('input');
    assetId.className = 'plugin-control-input';
    assetId.value = this._selectedAssetId;

    const toggle = document.createElement('button');
    toggle.className = 'plugin-control-button';
    toggle.textContent = 'Enable map click inspector';

    this._inspectorResultsEl = document.createElement('pre');
    this._inspectorResultsEl.className = 'plugin-control-placeholder';
    this._inspectorResultsEl.textContent = 'Inspector inactive';

    toggle.addEventListener('click', () => {
      this._selectedAssetId = assetId.value.trim() || this._selectedAssetId;
      this._inspectorActive = !this._inspectorActive;
      if (this._inspectorActive) {
        this._enableInspector();
        toggle.textContent = 'Disable map click inspector';
      } else {
        this._disableInspector();
        toggle.textContent = 'Enable map click inspector';
      }
    });

    el.append(assetId, toggle, this._inspectorResultsEl);
    return el;
  }

  private _enableInspector(): void {
    if (!this._map) return;
    const handler = async (e: { lngLat: { lng: number; lat: number } }) => {
      if (!this._inspectorResultsEl) return;
      const payload: EndpointInspectPayload = {
        assetId: this._selectedAssetId,
        lon: e.lngLat.lng,
        lat: e.lngLat.lat,
      };
      try {
        if (!this._endpointClient) {
          this._inspectorResultsEl.textContent =
            'Inspector endpoint unavailable. Request scaffold:\n' + JSON.stringify(payload, null, 2);
          return;
        }
        const data = await this._endpointClient.inspectPixel(payload).catch(() => ({ notImplemented: true, payload }));
        if (data.notImplemented) {
          this._inspectorResultsEl.textContent =
            'Inspector not implemented by endpoint. Payload preview:\n' + JSON.stringify(payload, null, 2);
          return;
        }
        this._inspectorResultsEl.textContent = JSON.stringify(data, null, 2);
      } catch (error) {
        this._inspectorResultsEl.textContent = `Inspector error: ${(error as Error).message}`;
      }
    };
    this._mapClickHandler = handler;
    this._map.on('click', handler as never);
    this._setStatus('Inspector enabled. Click map to query pixel values.');
  }

  private _disableInspector(): void {
    if (this._map && this._mapClickHandler) {
      this._map.off('click', this._mapClickHandler as never);
    }
    this._mapClickHandler = undefined;
    this._inspectorActive = false;
    if (this._inspectorResultsEl) this._inspectorResultsEl.textContent = 'Inspector inactive';
  }

  private _codePanel(): HTMLElement {
    const el = this._panelShell('code', 'Run Earth Engine script');
    const code = document.createElement('textarea');
    code.className = 'plugin-control-input plugin-code';
    code.value = "return ee.Image('USGS/SRTMGL1_003');";

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

  private _exportPanel(): HTMLElement {
    const el = this._panelShell('export', 'Export (MVP)');

    const assetId = document.createElement('input');
    assetId.className = 'plugin-control-input';
    assetId.value = this._selectedAssetId;

    const description = document.createElement('input');
    description.className = 'plugin-control-input';
    description.value = 'maplibre_ee_export';

    const destination = document.createElement('select');
    destination.className = 'plugin-control-input';
    destination.innerHTML = '<option value="drive">drive</option><option value="cloud">cloud</option><option value="asset">asset</option>';

    const payloadPreview = document.createElement('pre');
    payloadPreview.className = 'plugin-control-placeholder';

    const updatePreview = (): EndpointExportPayload => {
      const payload: EndpointExportPayload = {
        assetId: assetId.value.trim(),
        description: description.value.trim(),
        destination: destination.value as EndpointExportPayload['destination'],
      };
      payloadPreview.textContent = JSON.stringify(payload, null, 2);
      return payload;
    };

    const submit = document.createElement('button');
    submit.className = 'plugin-control-button';
    submit.textContent = 'Submit export request';
    submit.addEventListener('click', async () => {
      const payload = updatePreview();
      if (!this._endpointClient) {
        this._setStatus('Export not implemented in tile-only/local mode. Payload preview shown.');
        return;
      }
      try {
        const response = await this._endpointClient.requestExport(payload).catch(() => ({ notImplemented: true, payload }));
        if (response.notImplemented) {
          this._setStatus('Export endpoint not implemented.');
          return;
        }
        this._setStatus(`Export request submitted: ${JSON.stringify(response)}`);
      } catch (error) {
        this._setStatus(`Export failed: ${(error as Error).message}`);
      }
    });

    [assetId, description, destination].forEach((input) => input.addEventListener('input', () => updatePreview()));
    updatePreview();

    el.append(assetId, description, destination, submit, payloadPreview);
    return el;
  }

  private _settingsPanel(): HTMLElement {
    const el = this._panelShell('settings', 'Settings');

    const endpoint = document.createElement('input');
    endpoint.className = 'plugin-control-input';
    endpoint.value = this._tileEndpoint;
    endpoint.placeholder = 'Tile endpoint URL';

    const token = document.createElement('input');
    token.className = 'plugin-control-input';
    token.type = 'password';
    token.value = this._tileEndpointToken;
    token.placeholder = 'Optional bearer token';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'plugin-control-button';
    saveBtn.textContent = 'Save endpoint settings';
    saveBtn.addEventListener('click', () => {
      this._tileEndpoint = normalizeEndpointUrl(endpoint.value.trim());
      endpoint.value = this._tileEndpoint;
      this._tileEndpointToken = token.value.trim();
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('eeTileEndpoint', this._tileEndpoint);
        window.localStorage.setItem('eeTileEndpointToken', this._tileEndpointToken);
      }
      this._refreshEndpointClient();
      const caps = this._endpointClient?.capabilities() ?? {};
      this._setStatus(`Saved endpoint settings. Capabilities: ${JSON.stringify(caps)}`);
    });

    [
      { label: 'Tile endpoint URL', input: endpoint },
      { label: 'Bearer token (optional)', input: token },
    ].forEach(({ label, input }) => {
      const group = document.createElement('div');
      group.className = 'plugin-control-group';
      const lbl = document.createElement('label');
      lbl.className = 'plugin-control-label';
      lbl.textContent = label;
      group.append(lbl, input);
      el.appendChild(group);
    });

    const note = document.createElement('p');
    note.className = 'plugin-control-placeholder';
    note.textContent =
      'Settings are persisted in localStorage. Use endpoint mode for Time Series, Inspector, and Export support.';

    el.append(saveBtn, note);
    return el;
  }

  private _authPanel(): HTMLElement {
    const el = this._panelShell('auth', 'Earth Engine authentication');
    const project = document.createElement('input');
    project.className = 'plugin-control-input';
    project.placeholder = 'Google Cloud project ID (optional)';

    const authStatus = document.createElement('div');
    authStatus.className = 'plugin-control-placeholder';
    authStatus.textContent = `Auth status: ${this._state.authenticated ? 'Authenticated' : 'Not authenticated'}`;

    const btn = document.createElement('button');
    btn.className = 'plugin-control-button';
    btn.textContent = 'Authenticate with EE_SERVICE_ACCOUNT';
    btn.addEventListener('click', async () => {
      try {
        await this.authenticate(project.value.trim() || undefined);
        authStatus.textContent = `Auth status: ${this._state.authenticated ? 'Authenticated' : 'Not authenticated'}`;
      } catch (error) {
        this._setStatus(`Auth failed: ${(error as Error).message}`);
      }
    });

    const help = document.createElement('p');
    help.className = 'plugin-control-placeholder';
    help.textContent =
      'EE_SERVICE_ACCOUNT can be a JSON string or path to a service-account JSON key (Node/backend only).';

    el.append(project, btn, authStatus, help);
    return el;
  }

  private _positionPanel(): void {
    if (!this._panel || !this._container || !this._mapContainer) return;

    const mapRect = this._mapContainer.getBoundingClientRect();
    const controlRect = this._container.getBoundingClientRect();
    const panelRect = this._panel.getBoundingClientRect();

    const edgeMargin = 12;
    const rightMargin = 0;
    const verticalGap = 8;

    const position = this._options.position;
    let left = edgeMargin;
    let top = edgeMargin;

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
