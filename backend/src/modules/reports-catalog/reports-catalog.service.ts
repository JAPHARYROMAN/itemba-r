import { Injectable } from '@nestjs/common';
import { CatalogEntry, REPORTS_CATALOG, ReportScope, ReportSector } from './catalog';

interface CatalogQuery {
  sector?: string;
  scope?: string;
  search?: string;
}

@Injectable()
export class ReportsCatalogService {
  list(query: CatalogQuery = {}) {
    const sector = query.sector?.toUpperCase() as ReportSector | undefined;
    const scope = query.scope?.toUpperCase() as ReportScope | undefined;
    const search = query.search?.trim().toLowerCase();

    let entries: CatalogEntry[] = REPORTS_CATALOG;
    if (sector) entries = entries.filter((e) => e.sector === sector);
    if (scope) entries = entries.filter((e) => e.scopes.includes(scope));
    if (search) {
      entries = entries.filter(
        (e) =>
          e.name.toLowerCase().includes(search) ||
          e.description.toLowerCase().includes(search) ||
          e.id.toLowerCase().includes(search) ||
          e.category.toLowerCase().includes(search),
      );
    }

    const sectors = Array.from(new Set(REPORTS_CATALOG.map((e) => e.sector))).sort();
    const sectorCounts: Record<string, number> = {};
    for (const e of REPORTS_CATALOG) {
      sectorCounts[e.sector] = (sectorCounts[e.sector] ?? 0) + 1;
    }

    return {
      total: REPORTS_CATALOG.length,
      filtered: entries.length,
      sectors,
      sectorCounts,
      entries,
    };
  }
}
