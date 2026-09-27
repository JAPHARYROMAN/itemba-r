import type { MetadataRoute } from 'next';
import { companies } from '@/content/companies';
import { insightArticles } from '@/content/insights';
import { locationProfiles } from '@/content/locations';
import { serviceAreas } from '@/content/services';
import { absoluteUrl, companyUrl, coreRoutes, insightUrl, locationUrl, routePriorities, serviceUrl } from '@/content/site';

type SitemapRoute = { path: string; priority: number; updatedAt: string };

/**
 * The 25 indexable URLs, in the origin/main order (the core routes, then
 * services, locations, companies and insights) with the same priorities.
 * `lastModified` is each page's own content date (`updatedAt` in
 * src/content), no longer one hard-coded date for the whole site, so a
 * content edit moves only the pages it touches.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const routes: SitemapRoute[] = [
    ...coreRoutes,
    ...serviceAreas.map((service) => ({ path: serviceUrl(service.slug), priority: routePriorities.service, updatedAt: service.updatedAt })),
    ...locationProfiles.map((location) => ({
      path: locationUrl(location.slug),
      priority: routePriorities.location,
      updatedAt: location.updatedAt,
    })),
    ...companies.map((company) => ({ path: companyUrl(company.slug), priority: routePriorities.company, updatedAt: company.updatedAt })),
    ...insightArticles.map((article) => ({ path: insightUrl(article.slug), priority: routePriorities.insight, updatedAt: article.updatedAt })),
  ];

  return routes.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified: new Date(route.updatedAt),
    changeFrequency: 'monthly' as const,
    priority: route.priority,
  }));
}
