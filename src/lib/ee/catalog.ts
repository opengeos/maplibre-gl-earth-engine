export interface CatalogItem {
  id: string;
  title: string;
  provider?: string;
  type?: string;
  source: 'official' | 'community';
  tags: string[];
  snippet?: string;
  category?: string;
}

export interface CatalogQuery {
  keyword?: string;
  source?: 'all' | 'official' | 'community';
  type?: 'all' | string;
  sortBy?: 'title' | 'id';
  sortDir?: 'asc' | 'desc';
  limit?: number;
  page?: number;
}

export interface CatalogQueryResult {
  items: CatalogItem[];
  total: number;
  page: number;
  pageSize: number;
}

const OFFICIAL_URL =
  'https://raw.githubusercontent.com/opengeos/Earth-Engine-Catalog/master/gee_catalog.json';
const COMMUNITY_URL =
  'https://raw.githubusercontent.com/samapriya/awesome-gee-community-datasets/master/community_datasets.json';

function asArray(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

function inferCategory(id: string): string {
  const top = id.split('/')[0]?.trim();
  return top || 'Other';
}

function normalizeOfficial(record: Record<string, unknown>): CatalogItem | null {
  const id = String(record.id ?? record.asset_id ?? '').trim();
  if (!id) return null;
  const title = String(record.title ?? record.name ?? id);
  const tags = asArray(record.tags).map(String);
  return {
    id,
    title,
    provider: record.provider ? String(record.provider) : undefined,
    type: record.type ? String(record.type) : undefined,
    source: 'official',
    tags,
    snippet: record.description ? String(record.description).slice(0, 240) : undefined,
    category: inferCategory(id),
  };
}

function normalizeCommunity(record: Record<string, unknown>): CatalogItem | null {
  const id = String(record.id ?? record.asset_id ?? record.dataset_id ?? '').trim();
  if (!id) return null;
  const title = String(record.title ?? record.name ?? id);
  const tags = asArray(record.tags).map(String);
  return {
    id,
    title,
    provider: record.provider ? String(record.provider) : 'community',
    type: record.type ? String(record.type) : undefined,
    source: 'community',
    tags,
    snippet: record.description ? String(record.description).slice(0, 240) : undefined,
    category: inferCategory(id),
  };
}

function parsePossiblyInvalidJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const sanitized = text.replace(/\bNaN\b/g, 'null');
    return JSON.parse(sanitized);
  }
}

export async function fetchCatalogs(): Promise<CatalogItem[]> {
  const [officialResp, communityResp] = await Promise.all([fetch(OFFICIAL_URL), fetch(COMMUNITY_URL)]);
  const [officialText, communityText] = await Promise.all([officialResp.text(), communityResp.text()]);
  const officialJson = parsePossiblyInvalidJson(officialText);
  const communityJson = parsePossiblyInvalidJson(communityText);

  const official = asArray(officialJson).map((r) => normalizeOfficial(r as Record<string, unknown>)).filter(Boolean);
  const community = asArray(communityJson).map((r) => normalizeCommunity(r as Record<string, unknown>)).filter(Boolean);

  return [...(official as CatalogItem[]), ...(community as CatalogItem[])];
}

export function filterCatalog(items: CatalogItem[], query: string): CatalogItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    return (
      item.id.toLowerCase().includes(q) ||
      item.title.toLowerCase().includes(q) ||
      (item.provider ?? '').toLowerCase().includes(q) ||
      (item.type ?? '').toLowerCase().includes(q) ||
      (item.snippet ?? '').toLowerCase().includes(q) ||
      item.tags.some((t) => t.toLowerCase().includes(q))
    );
  });
}

export function queryCatalog(items: CatalogItem[], query: CatalogQuery): CatalogQueryResult {
  const source = query.source ?? 'all';
  const type = (query.type ?? 'all').toLowerCase();
  const sortBy = query.sortBy ?? 'title';
  const sortDir = query.sortDir ?? 'asc';
  const pageSize = Math.max(1, query.limit ?? 25);
  const page = Math.max(1, query.page ?? 1);

  let filtered = filterCatalog(items, query.keyword ?? '');
  if (source !== 'all') filtered = filtered.filter((item) => item.source === source);
  if (type !== 'all') filtered = filtered.filter((item) => (item.type ?? '').toLowerCase() === type);

  const sorted = [...filtered].sort((a, b) => {
    const left = (sortBy === 'id' ? a.id : a.title).toLowerCase();
    const right = (sortBy === 'id' ? b.id : b.title).toLowerCase();
    if (left === right) return 0;
    const cmp = left < right ? -1 : 1;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const total = sorted.length;
  const start = (page - 1) * pageSize;
  return {
    items: sorted.slice(start, start + pageSize),
    total,
    page,
    pageSize,
  };
}

export function groupCatalogByCategory(items: CatalogItem[]): Record<string, CatalogItem[]> {
  return items.reduce<Record<string, CatalogItem[]>>((acc, item) => {
    const key = item.category || inferCategory(item.id);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}
