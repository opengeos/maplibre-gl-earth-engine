# maplibre-gl-earth-engine

MapLibre GL JS plugin for Earth Engine dataset discovery, loading, and endpoint-backed analysis workflows.

## Current tabs and capabilities

- **Browse/Catalog**
  - Fetch official + community catalogs
  - Source filter (official/community/all)
  - Category grouping with result counts
  - Dataset details pane (title/id/provider/type/tags/snippet)
  - One-click **Use in Load tab**
- **Search**
  - Keyword search
  - Source + type filter
  - Sort by title/id
  - Page + limit controls
- **Load**
  - Asset id input
  - Image/ImageCollection options (date range, cloud property/threshold, reducer)
  - Visualization params (bands/min/max/palette/opacity)
  - Add, update, remove map layer
- **Time Series (MVP)**
  - Asset/date/frequency/reducer form
  - Sequence descriptor generation
  - Frame list + next/prev frame stepping
  - Endpoint tile request per frame
- **Inspector (MVP)**
  - Click-to-inspect toggle
  - Endpoint request scaffold for lon/lat + asset
  - Clear not-implemented fallback messaging
- **Code**
  - Run EE script snippets
- **Export (MVP)**
  - Export payload builder
  - Endpoint export request
  - Not-implemented fallback with payload preview
- **Settings**
  - Endpoint + token config
  - localStorage persistence
  - Capability-aware status text
- **Auth**
  - Authenticate with `EE_SERVICE_ACCOUNT`
  - Auth status text

## Feature matrix

| Area | Status |
|---|---|
| Catalog browse + grouped categories | ✅ Implemented |
| Search filters/sort/pagination | ✅ Implemented |
| Load image + collection options | ✅ Implemented (MVP wiring for collection options) |
| Layer add/update/remove | ✅ Implemented |
| Time series stepping | ✅ Implemented (MVP, list + tile frame stepping) |
| Inspector map click workflow | ✅ Implemented (MVP with fallback scaffold) |
| Export workflow | ✅ Implemented (MVP with fallback scaffold) |
| Auth/settings persistence | ✅ Implemented |
| Endpoint capability handling | ✅ Implemented |
| Charts/statistical UI for time series | 🟡 Planned |
| Full native EE computation backend | 🟡 Depends on endpoint implementation |

## Install

```bash
npm install maplibre-gl-earth-engine
```

## Quick start

```ts
import maplibregl from 'maplibre-gl';
import { PluginControl } from 'maplibre-gl-earth-engine';
import 'maplibre-gl-earth-engine/style.css';

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://demotiles.maplibre.org/style.json',
  center: [0, 0],
  zoom: 2,
});

map.on('load', () => {
  const eeControl = new PluginControl({ title: 'Earth Engine' });
  map.addControl(eeControl, 'top-right');
});
```

## Endpoint contract (expected JSON)

The plugin centralizes endpoint access via `createEndpointClient` and uses capability-aware behavior.

### Base tile request (POST `{endpoint}`)

Request:

```json
{
  "assetId": "USGS/SRTMGL1_003",
  "visParams": {
    "min": 0,
    "max": 3000,
    "palette": "black,white"
  }
}
```

Response (supported forms):

```json
{
  "tileUrl": "https://.../{z}/{x}/{y}",
  "capabilities": {
    "inspect": true,
    "timeSeries": true,
    "export": false
  }
}
```

Alternative accepted response fields:

- `urlFormat`
- `tiles[0]`
- `data.tileUrl`
- `data.urlFormat`

### Inspect request (POST `{endpoint}/inspect`)

```json
{
  "assetId": "USGS/SRTMGL1_003",
  "lon": -120.5,
  "lat": 38.1,
  "visParams": { "min": 0, "max": 3000 }
}
```

Example response:

```json
{
  "assetId": "USGS/SRTMGL1_003",
  "point": { "lon": -120.5, "lat": 38.1 },
  "values": { "elevation": 1214 }
}
```

### Time series request (POST `{endpoint}/timeseries`)

```json
{
  "assetId": "COPERNICUS/S2_SR",
  "startDate": "2024-01-01",
  "endDate": "2024-12-31",
  "frequency": "month",
  "reducer": "median"
}
```

### Export request (POST `{endpoint}/export`)

```json
{
  "assetId": "USGS/SRTMGL1_003",
  "description": "maplibre_ee_export",
  "destination": "drive"
}
```

## Authentication (`EE_SERVICE_ACCOUNT`)

You can set `EE_SERVICE_ACCOUNT` in a local `.env` file for Node-backed auth:

```bash
EE_SERVICE_ACCOUNT=/path/to/service-account.json
```

Supported values:

1. Inline JSON string
2. Path to service-account JSON

Required fields: `client_email`, `private_key`.

## GitHub Pages deployment guidance

For static deployments (e.g., GitHub Pages):

1. Build docs/demo with Vite (`npm run build` or your docs workflow).
2. Configure endpoint + optional bearer token in **Settings** tab.
3. Do **not** ship service account keys in browser bundles.
4. Ensure endpoint handles CORS from your Pages domain.

The control works in tile-endpoint mode without exposing private credentials.

## Development

```bash
npm install
npm run build
npm test
```
