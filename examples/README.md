# Examples

This directory contains example implementations of the MapLibre GL Plugin Template.

## Available Examples

### Basic Example

A simple vanilla JavaScript/TypeScript example showing how to add the plugin control to a map.

```bash
# Run from project root
npm run dev
# Then navigate to http://localhost:5173/examples/basic/
```

For native Earth Engine login, copy the repo `.env.example` to `.env` and set:

```env
VITE_GEE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
VITE_GEE_PROJECT_ID=your-earth-engine-project
```

For the GitHub Pages workflow, set the same names as GitHub Actions variables
on the `github-pages` environment. `VITE_GEE_OAUTH_CLIENT_ID` is read during
the build and embedded into the deployed examples.

### React Example

A React example demonstrating the React wrapper component and hooks.

```bash
# Run from project root
npm run dev
# Then navigate to http://localhost:5173/examples/react/
```

## Running Examples

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the development server:

   ```bash
   npm run dev
   ```

3. Open your browser and navigate to the example you want to view.

## Building Examples

To build all examples for deployment:

```bash
npm run build:examples
```

The built examples will be in the `dist-examples` directory.
