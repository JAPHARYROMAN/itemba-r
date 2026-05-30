import { Injectable } from '@nestjs/common';
import {
  EnterpriseCatalogEntry,
  REPORTS_CATALOG,
  ReportScope,
  ReportSector,
  enrichCatalogEntry,
} from './catalog';

interface CatalogQuery {
  sector?: string;
  scope?: string;
  search?: string;
}

@Injectable()
export class ReportsCatalogService {
  list(query: CatalogQuery = {}) {
    const catalog = REPORTS_CATALOG.map(enrichCatalogEntry);
    const sector = query.sector?.toUpperCase() as ReportSector | undefined;
    const scope = query.scope?.toUpperCase() as ReportScope | undefined;
    const search = query.search?.trim().toLowerCase();

    let entries: EnterpriseCatalogEntry[] = catalog;
    if (sector) entries = entries.filter((e) => e.sector === sector);
    if (scope) entries = entries.filter((e) => e.scopes.includes(scope));
    if (search) {
      entries = entries.filter((e) => {
        const haystack = [
          e.id,
          e.sector,
          e.category,
          e.name,
          e.description,
          e.permission,
          e.reportType,
          e.lifecycleStatus,
          e.owner,
          e.dataFreshness,
          e.securityClassification,
          ...e.tags,
          ...e.businessQuestions,
          ...e.drillPaths,
          ...e.relatedCapabilities,
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(search);
      });
    }

    const sectors = Array.from(new Set(catalog.map((e) => e.sector))).sort();
    const sectorCounts: Record<string, number> = {};
    const typeCounts: Record<string, number> = {};
    const lifecycleCounts: Record<string, number> = {};
    const securityCounts: Record<string, number> = {};
    for (const e of catalog) {
      sectorCounts[e.sector] = (sectorCounts[e.sector] ?? 0) + 1;
      typeCounts[e.reportType] = (typeCounts[e.reportType] ?? 0) + 1;
      lifecycleCounts[e.lifecycleStatus] = (lifecycleCounts[e.lifecycleStatus] ?? 0) + 1;
      securityCounts[e.securityClassification] = (securityCounts[e.securityClassification] ?? 0) + 1;
    }

    return {
      total: catalog.length,
      filtered: entries.length,
      sectors,
      sectorCounts,
      typeCounts,
      lifecycleCounts,
      securityCounts,
      generatedAt: new Date().toISOString(),
      entries,
    };
  }
}
