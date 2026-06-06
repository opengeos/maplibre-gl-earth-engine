# maplibre-gl-earth-engine

MapLibre GL JS plugin for Earth Engine dataset discovery, authentication, and layer rendering.

## Current tabs and capabilities

- **Browse/Catalog**
  - Automatically fetch official + community catalogs when the panel opens
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
  - Open dataset page on Earth Engine
- **Layers**
  - Manage all added Earth Engine layers
  - Toggle visibility
  - Change raster opacity
  - Select and remove layers
- **Inspector**
  - Inspect script-returned Earth Engine objects
  - Inspect pixel values from script-returned `ee.Image` objects
  - Use explicit lon/lat inputs or map clicks
- **Code**
  - Run EE script snippets
- **Auth**
  - Sign in with Google account OAuth
  - Enter Earth Engine Google Cloud project ID
  - Auth status text

## Feature matrix

| Area                                  | Status                                             |
| ------------------------------------- | -------------------------------------------------- |
| Catalog browse + grouped categories   | ✅ Implemented                                     |
| Search filters/sort/pagination        | ✅ Implemented                                     |
| Load image + collection options       | ✅ Implemented (MVP wiring for collection options) |
| Layer add/update/remove               | ✅ Implemented                                     |
| Multi-layer management                | ✅ Implemented                                     |
| EE object + pixel inspection          | ✅ Implemented                                     |
| Auth persistence                      | ✅ Implemented                                     |
| Charts/statistical UI for time series | 🟡 Planned                                         |

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
  const eeControl = new PluginControl({
    title: 'Earth Engine',
    oauthClientId: 'YOUR_GOOGLE_OAUTH_CLIENT_ID',
    projectId: 'your-earth-engine-project',
  });
  map.addControl(eeControl, 'top-right');
});
```

## Authentication

The control uses browser OAuth through the official `@google/earthengine`
package. Configure an OAuth client ID in the host app and let users enter an
Earth Engine-enabled Google Cloud project ID in the Auth tab:

```ts
const eeControl = new PluginControl({
  oauthClientId: 'YOUR_GOOGLE_OAUTH_CLIENT_ID',
});
```

For Vite builds, copy `.env.example` to `.env` and set:

```env
VITE_GEE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
VITE_GEE_PROJECT_ID=your-earth-engine-project
```

When `VITE_GEE_OAUTH_CLIENT_ID` is available at build time, the Auth tab hides
the OAuth client ID input and only asks users for the project ID.

You can also prefill the project ID:

```ts
const eeControl = new PluginControl({
  oauthClientId: 'YOUR_GOOGLE_OAUTH_CLIENT_ID',
  projectId: 'your-earth-engine-project',
});
```

Service account private keys are intentionally not used in the browser control.

## GitHub Pages deployment guidance

For static deployments (e.g., GitHub Pages):

1. Build docs/demo with Vite (`npm run build` or your docs workflow).
2. Configure a browser OAuth client ID if you want native Earth Engine login.

For the included GitHub Pages workflow, add `VITE_GEE_OAUTH_CLIENT_ID` as a
GitHub Actions secret on the `github-pages` environment. You can also add
`VITE_GEE_PROJECT_ID` as a GitHub Actions variable there as an optional
default project ID. Note that Vite embeds `VITE_*` values into the deployed
browser bundle, so the client ID is still visible in the published site; use
a public OAuth client ID, not a private key.

## Development

```bash
npm install
npm run build
npm test
```
