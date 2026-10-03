import type { PartnershipArea } from '@/content/partnerships';
import type { AccentName } from '@/design/tokens';

/**
 * A route's accent: that of the company its enquiry type routes to, or the
 * group gold for the group office (as the enquiry form marks its options).
 */
export function routeAccent(area: PartnershipArea): AccentName {
  return area.intentId === 'general' ? 'group' : area.intentId;
}
