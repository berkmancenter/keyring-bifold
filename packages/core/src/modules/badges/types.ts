/**
 * Member badges: the contract between the badges client (this module), the screens, the Wallet card and the room-post
 * chip (docs/plans/member-badges-plan.md, Interfaces). Only the client lane edits this file; a change is asked for.
 *
 * A community gives badges (`vtc/badges/*` 0.1, VTC v0.27.0 on). Keyring is the holder only: it reads what the member
 * holds and is offered, accepts or declines an offer, and reads another member's wall as the community shows it to this
 * member. It never shares a badge outside the community, and a badge is never called verified.
 *
 * @module badges/types
 */

/** What a badge is, as the community describes it. The picture is fetched with `images/get`, never by URL. */
export interface BadgeSummary {
  badgeId: string
  communityDid: string
  kind: 'community' | 'kudos'
  name: string
  description?: string
  criteria?: string
  image?: { sha256: string; mediaType: string }
}

/** A badge the member holds: one per badge, with each award's date (a repeatable badge, or kudos, has several). */
export interface HeldBadge extends BadgeSummary {
  awardIds: string[]
  earnedAt: string[]
  /** Hidden from the member's wall (they chose so in the portal); still theirs. */
  hidden: boolean
  /** How many times given: kudos, or a repeatable badge. */
  count?: number
}

/** An award waiting for the member's answer. `note` is the giver's, seen by the member only. */
export interface BadgeOffer extends BadgeSummary {
  awardId: string
  offeredAt: string
  expiresAt?: string
  note?: string
  /** The giver's name as the directory shows it to this member, when it does. Never a DID. */
  givenBy?: string
}

/** The member's own badges in one community (`mine/list`). */
export interface MyBadges {
  held: HeldBadge[]
  offers: BadgeOffer[]
  kudosTotal?: number
}

/** A badge on another member's wall (`wall/show`), as the community shows it to this member. */
export interface WallBadge extends BadgeSummary {
  earnedAt?: string
  count?: number
  pinned?: boolean
}

/** A community that does not serve badges, or has them switched off: show nothing for it. */
export type NotServed = 'notServed'
/** A wall the community does not show this member (its owner chose `nobody`, or the card is not shown to them). */
export type WallHidden = 'hidden'

export interface BadgeService {
  /** The member's badges and offers in one community. */
  mine(communityDid: string): Promise<MyBadges | NotServed>
  /** Accept an offer: the community issues the badge's credential to the member's agent afterwards. */
  accept(communityDid: string, awardId: string): Promise<void>
  /** Decline an offer: nobody is told, and it may be offered again. */
  decline(communityDid: string, awardId: string): Promise<void>
  /** Another member's wall, by their directory entry (`wall/show` takes an entry id, never a DID). */
  wall(communityDid: string, entryId: string): Promise<WallBadge[] | NotServed | WallHidden>
  /** One badge's description. */
  show(communityDid: string, badgeId: string): Promise<BadgeSummary | NotServed>
  /** A badge's picture as a data URI, cached by its digest. */
  image(communityDid: string, badgeId: string, sha256: string): Promise<string | undefined>
}

/** The screens' hooks (useBadges.ts). */
export interface MyBadgesState {
  badges?: MyBadges
  /** False while loading, and for a community that does not serve badges. */
  served: boolean
  loading: boolean
  refresh(): void
}
export interface MemberWallState {
  wall?: WallBadge[]
  state: 'loading' | 'shown' | 'hidden' | 'notServed'
}
/** The room-post chip's lookup: the author's wall in the room's community, looked up only while on screen. */
export type AuthorBadgesLookup = (communityDid: string, authorDid: string) => WallBadge[] | undefined
