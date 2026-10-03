/**
 * Company profile §8: the leadership team (typographic cards; no portraits).
 */
import 'server-only';

export const leadershipTeam = [
  {
    name: 'Roman M Mwampuwa',
    groupRole: 'Chairman of the Group and M.D',
    companyRole: 'M.D of each of the three operating companies',
  },
  {
    name: 'Isaac Roman Mwampuwa',
    groupRole: 'CEO of the Group',
    companyRole: 'Director for Westsides Company Ltd',
  },
  {
    name: 'Japhary Roman Mwampuwa',
    groupRole: 'Group CFO',
    companyRole: 'Director for Mwanjalisi Oil Company Ltd',
  },
  {
    name: 'Joshua M Mwampuwa',
    groupRole: 'G.M of the Group',
    companyRole:
      'Operating Manager for Mwanjalisi Oil Company Ltd and Logistics Manager for Itemba Enterprises Co Ltd',
  },
  {
    name: 'Nsajigwa Mwaipopo',
    groupRole: 'Operating leadership',
    companyRole: 'Operating Manager for Westsides Company Ltd',
  },
] as const;

export const leadershipHeading = 'Leadership team';
