import { describe, expect, it } from 'vitest';
import { groupCatalogByCategory, queryCatalog, type CatalogItem } from '../src/lib/ee/catalog';

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
