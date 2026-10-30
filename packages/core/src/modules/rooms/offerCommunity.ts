/**
 * What an offer calls its community in a sentence ("You've been offered a room in …", "Offer from …"): the name it
 * came with, else the app's label for the community: its published name, or its handle and that it has published
 * none. Never a cut of its DID: the offer said "nity-a-vtc" for `…:community-a-vtc` (276.9).
 *
 * @module rooms/offerCommunity
 */
import type { TFunction } from 'i18next'

import { communityLabelOf } from '../trust-tasks/screens/communityName'

import type { RoomOffer } from './types'

export const offerCommunity = (offer: Pick<RoomOffer, 'communityDid' | 'communityName'>, t: TFunction): string =>
  (offer.communityName ? String(offer.communityName) : '') || communityLabelOf(offer.communityDid, t)
