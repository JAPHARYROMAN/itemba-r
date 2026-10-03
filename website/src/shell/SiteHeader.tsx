import Link from 'next/link';
import { brandLabel, headerCta, headerLinks, shellCopy } from '@/content/nav';
import SiteNav from '@/islands/SiteNav';
import { Icon } from '@/ui/Icon';
import { Container } from '@/ui/layout';
import { Crest } from './Crest';

/**
 * The global nav: a 48px translucent bar (the one allowed material) that
 * stays at the top of the viewport. The crest links home on the left; the
 * SiteNav island carries the links, the Enquire pill and the mobile menu.
 *
 * Server markup; the island only adds `aria-current` tracking and closes
 * the menu sheet after a client-side navigation. The bar's content width
 * matches the local sub-nav (src/ui/SubNav.tsx), so the two bars align.
 *
 * `.site-header` is hidden in print (src/styles/print.css).
 */
export function SiteHeader() {
  return (
    <header className="site-header material-nav sticky top-0 z-nav">
      <Container size="content" className="flex h-nav items-center gap-4">
        <Link href="/" aria-label={brandLabel} className="-ml-1 flex h-11 shrink-0 items-center px-1">
          <Crest variant="nav" eager />
        </Link>
        <SiteNav
          links={headerLinks}
          cta={headerCta}
          label={shellCopy.navLabel}
          menuLabel={shellCopy.menuOpen}
          closeLabel={shellCopy.menuClose}
          brandLabel={brandLabel}
          crest={<Crest variant="nav" />}
          menuIcon={<Icon name="menu" size="sm" strokeWidth={1.6} />}
          closeIcon={<Icon name="close" size="sm" strokeWidth={1.6} />}
        />
      </Container>
    </header>
  );
}
