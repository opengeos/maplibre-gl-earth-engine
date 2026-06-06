import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCatalogs, groupCatalogByCategory, queryCatalog, type CatalogItem } from '../src/lib/ee/catalog';

const sample: CatalogItem[] = [
  {
    id: 'COPERNICUS/S2_SR',
    title: 'Sentinel-2 SR',
    provider: 'ESA',
    type: 'image_collection',
    source: 'official',
    tags: ['optical'],
    snippet: 'Sentinel two',
    category: 'COPERNICUS',
  },
  {
    id: 'LANDSAT/LC08/C02/T1_L2',
    title: 'Landsat 8 L2',
    provider: 'USGS',
    type: 'image_collection',
    source: 'official',
    tags: ['landsat'],
    category: 'LANDSAT',
  },
  {
    id: 'users/demo/custom_asset',
    title: 'Community Demo',
    provider: 'community',
    type: 'image',
    source: 'community',
    tags: ['demo'],
    category: 'users',
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchCatalogs', () => {
  it('normalizes keyword strings, tag strings, snippets, categories, and links', async () => {
    const responses = [
      [
        {
          id: 'AAFC/ACI',
          title: 'Canada AAFC Annual Crop Inventory',
          type: 'image_collection',
          snippet: "ee.ImageCollection('AAFC/ACI')",
          provider: 'Agriculture and Agri-Food Canada',
          category: 'agriculture',
          keywords: 'aafc, agriculture, canada',
          url: 'https://developers.google.com/earth-engine/datasets/catalog/AAFC_ACI',
        },
      ],
      [
        {
          id: 'projects/sat-io/open-datasets/shoreline/mainlands',
          title: 'Global Shoreline Dataset',
          type: 'table',
          provider: 'USGS',
          tags: 'Global Shoreline, Shoreline, mainlands, Oceans',
          thematic_group: 'Oceans and Shorelines',
          docs: 'https://gee-community-catalog.org/projects/shoreline/',
        },
      ],
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn((async () => {
        const body = JSON.stringify(responses.shift());
        return { text: async () => body };
      }) as typeof fetch),
    );

    const result = await fetchCatalogs();
    expect(result[0]).toMatchObject({
      tags: ['aafc', 'agriculture', 'canada'],
      snippet: "ee.ImageCollection('AAFC/ACI')",
      category: 'agriculture',
      url: 'https://developers.google.com/earth-engine/datasets/catalog/AAFC_ACI',
    });
    expect(result[1]).toMatchObject({
      tags: ['Global Shoreline', 'Shoreline', 'mainlands', 'Oceans'],
      snippet: 'https://gee-community-catalog.org/projects/shoreline/',
      category: 'Oceans and Shorelines',
      url: 'https://gee-community-catalog.org/projects/shoreline/',
    });
  });
});

describe('queryCatalog', () => {
  it('filters by keyword/source/type and sorts by title', () => {
    const result = queryCatalog(sample, {
      keyword: 's',
      source: 'official',
      type: 'image_collection',
      sortBy: 'title',
      sortDir: 'asc',
      limit: 10,
      page: 1,
    });

    expect(result.total).toBe(2);
    expect(result.items[0].title).toBe('Landsat 8 L2');
    expect(result.items[1].title).toBe('Sentinel-2 SR');
  });

  it('supports pagination and id sorting', () => {
    const result = queryCatalog(sample, {
      source: 'all',
      sortBy: 'id',
      sortDir: 'asc',
      limit: 1,
      page: 2,
    });

    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('LANDSAT/LC08/C02/T1_L2');
  });
});

describe('groupCatalogByCategory', () => {
  it('groups records by category', () => {
    const grouped = groupCatalogByCategory(sample);
    expect(Object.keys(grouped).sort()).toEqual(['COPERNICUS', 'LANDSAT', 'users']);
    expect(grouped.COPERNICUS[0].id).toBe('COPERNICUS/S2_SR');
  });
});
