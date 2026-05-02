import { Injectable } from '@nestjs/common';
import {
  SettingEntry,
  SETTINGS_CATALOG,
  SettingCategory,
  SettingScope,
  SettingStatus,
} from './catalog';

interface CatalogQuery {
  category?: string;
  scope?: string;
  status?: string;
  search?: string;
}

@Injectable()
export class SettingsCatalogService {
  list(query: CatalogQuery = {}) {
    const category = query.category?.toUpperCase() as SettingCategory | undefined;
    const scope = query.scope?.toUpperCase() as SettingScope | undefined;
    const status = query.status?.toUpperCase() as SettingStatus | undefined;
    const search = query.search?.trim().toLowerCase();

    let entries: SettingEntry[] = SETTINGS_CATALOG;
    if (category) entries = entries.filter((e) => e.category === category);
    if (scope) entries = entries.filter((e) => e.scope === scope);
    if (status) entries = entries.filter((e) => e.status === status);
    if (search) {
      entries = entries.filter(
        (e) =>
          e.name.toLowerCase().includes(search) ||
          e.description.toLowerCase().includes(search) ||
          e.id.toLowerCase().includes(search),
      );
    }

    const categories = Array.from(new Set(SETTINGS_CATALOG.map((e) => e.category))).sort();
    const categoryCounts: Record<string, number> = {};
    for (const e of SETTINGS_CATALOG) {
      categoryCounts[e.category] = (categoryCounts[e.category] ?? 0) + 1;
    }

    return {
      total: SETTINGS_CATALOG.length,
      filtered: entries.length,
      categories,
      categoryCounts,
      entries,
    };
  }
}
