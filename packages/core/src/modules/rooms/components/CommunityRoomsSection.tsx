/**
 * The Rooms section on a community's screen, for a member: that community's offers and rooms. Nothing
 * while the rooms flag is off.
 *
 * @module rooms/components/CommunityRoomsSection
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'
import { useMyRooms } from '../useMyRooms'
import { useRoomsService } from '../useRoomsService'

import RoomsListBody from './RoomsListBody'
import { SampleDataBanner } from './SampleDataBanner'

export const CommunityRoomsSection: React.FC<{ communityDid: string }> = ({ communityDid }) => {
  const { t } = useTranslation()
  const service = useRoomsService()
  const myRooms = useMyRooms(service, communityDid)
  if (!service) return null
  return (
    <View style={{ gap: 8 }} testID={testIdWithKey('CommunityRooms')}>
      <ThemedText variant="headingFour" accessibilityRole="header">
        {t('Rooms.Rooms')}
      </ThemedText>
      <SampleDataBanner service={service} />
      <RoomsListBody myRooms={myRooms} acrossCommunities={false} />
    </View>
  )
}

export default CommunityRoomsSection
