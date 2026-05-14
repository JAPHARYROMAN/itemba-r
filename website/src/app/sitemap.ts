import type { MetadataRoute } from 'next';
import {
  absoluteUrl,
  companyProfiles,
  coreRoutes,
  insightArticles,
  insightUrl,
  locationProfiles,
  locationUrl,
  serviceAreas,
  serviceUrl,
} from '@/lib/site';

const lastModified = new Date('2026-05-14');

export default function sitemap(): MetadataRoute.Sitemap {
  const companyRoutes = companyProfiles.map((company) => ({
    path: `/companies/${company.slug}`,
    priority: 0.82,
  }));
  const serviceRoutes = serviceAreas.map((service) => ({
    path: serviceUrl(service.slug),
    priority: 0.84,
  }));
  const locationRoutes = locationProfiles.map((location) => ({
    path: locationUrl(location.slug),
    priority: 0.83,
  }));
  const insightRoutes = insightArticles.map((article) => ({
    path: insightUrl(article.slug),
    priority: 0.74,
  }));

  return [...coreRoutes, ...serviceRoutes, ...locationRoutes, ...companyRoutes, ...insightRoutes].map((route) => ({
    url: absoluteUrl(route.path),
    lastModified,
    changeFrequency: 'monthly' as const,
    priority: route.priority,
  }));
}
