import HomeLegacy from '@/components/legacy/HomeLegacy';
import {
  homeClosing,
  homeCompanyTiles,
  homeCorridor,
  homeCorridorMap,
  homeHero,
  homeHeroStats,
  homeInsights,
  homeSectors,
  homeStatement,
} from '@/content/home';
import { insightArticles } from '@/content/insights';

/**
 * Home. A server component: content is read here (src/content/home,
 * server-only) and handed to the legacy client layout, which renders the
 * origin/main markup unchanged until the rebuilt home ships (WP2.1).
 */
export default function HomePage() {
  return (
    <HomeLegacy
      hero={homeHero}
      heroStats={homeHeroStats}
      statement={homeStatement}
      companyTiles={homeCompanyTiles}
      sectors={homeSectors}
      corridor={homeCorridor}
      corridorMap={homeCorridorMap}
      insightsCopy={homeInsights}
      insights={insightArticles.slice(0, homeInsights.count).map(({ slug, eyebrow, title, summary }) => ({
        slug,
        eyebrow,
        title,
        summary,
      }))}
      closing={homeClosing}
    />
  );
}
