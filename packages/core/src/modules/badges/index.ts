/**
 * Member badges (docs/plans/member-badges-plan.md).
 *
 * @module badges
 */
export * from './types'
export { isMemberBadgesOn, MEMBER_BADGES } from './badgesSwitch'
export {
  badgeServiceFor,
  registerBadgeServiceFactory,
  resetBadgeService,
  setBadgeServiceForTests,
  useBadgeService,
  useMemberWall,
  useMyBadges,
} from './useBadges'
export { createFakeBadgeService, FAKE_BADGES } from './fakeBadgeService'
