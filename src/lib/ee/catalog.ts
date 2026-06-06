export interface CatalogItem {
  id: string;
  title: string;
  provider?: string;
  type?: string;
  source: 'official' | 'community';
  tags: string[];
  snippet?: string;
  category?: string;
  url?: string;
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

function asString(input: unknown): string | undefined {
  return typeof input === 'string' && input.trim() ? input.trim() : undefined;
}

function asStringList(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map(String).map((item) => item.trim()).filter(Boolean);
  }
  if (typeof input === 'string') {
    return input
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = asString(value);
    if (text) return text;
  }
  return undefined;
}

function truncate(text: string | undefined, length = 240): string | undefined {
  if (!text) return undefined;
  if (text.length <= length) return text;
  return `${text.slice(0, Math.max(0, length - 3))}...`;
}

function inferCategory(id: string): string {
  const top = id.split('/')[0]?.trim();
  return top || 'Other';
}

function normalizeOfficial(record: Record<string, unknown>): CatalogItem | null {
  const id = String(record.id ?? record.asset_id ?? '').trim();
  if (!id) return null;
  const title = String(record.title ?? record.name ?? id);
  const tags = asStringList(record.tags ?? record.keywords);
  return {
    id,
    title,
    provider: record.provider ? String(record.provider) : undefined,
    type: record.type ? String(record.type) : undefined,
    source: 'official',
    tags,
    snippet: truncate(firstString(record.description, record.summary, record.snippet)),
    category: firstString(record.category) ?? inferCategory(id),
    url: firstString(record.url, record.catalog, record.docs),
  };
}

function normalizeCommunity(record: Record<string, unknown>): CatalogItem | null {
  const id = String(record.id ?? record.asset_id ?? record.dataset_id ?? '').trim();
  if (!id) return null;
  const title = String(record.title ?? record.name ?? id);
  const tags = asStringList(record.tags ?? record.keywords ?? record.thematic_group);
  return {
    id,
    title,
    provider: record.provider ? String(record.provider) : 'community',
    type: record.type ? String(record.type) : undefined,
    source: 'community',
    tags,
    snippet: truncate(firstString(record.description, record.summary, record.snippet, record.docs, record.sample_code)),
    category: firstString(record.category, record.thematic_group) ?? inferCategory(id),
    url: firstString(record.url, record.docs, record.catalog, record.sample_code),
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
  const pageSize = Math.max(1, query.limit ?? 100);
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
