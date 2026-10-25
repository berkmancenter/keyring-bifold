/**
 * "Your rooms": every room and room offer the member has, grouped by community; or one community's, when
 * opened from its card. Reached only while the rooms flag is on; with it off there is no service and the
 * screen says rooms are off rather than showing an empty list.
 *
 * @module rooms/screens/RoomsList
 */
import { useNavigation, useRoute } from '@react-navigation/native'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import RoomsListBody from '../components/RoomsListBody'
import { SampleDataBanner } from '../components/SampleDataBanner'
import { useMyRooms } from '../useMyRooms'
import { useRoomsService } from '../useRoomsService'

const RoomsList: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const communityDid = (useRoute()?.params as { communityDid?: string } | undefined)?.communityDid
  const navigation = useNavigation()
  const service = useRoomsService()
  const myRooms = useMyRooms(service, communityDid)
  const openRoom = (room: { roomId: string }) =>
    (navigation as unknown as { navigate: (name: string, params: object) => void }).navigate(Screens.Room, {
      roomId: room.roomId,
    })
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { padding: 16, gap: 16 },
  })
  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} testID={testIdWithKey('RoomsList')}>
        {service ? (
          <>
            <SampleDataBanner service={service} />
            <RoomsListBody myRooms={myRooms} acrossCommunities={!communityDid} onOpenRoom={openRoom} />
          </>
        ) : (
          <ThemedText testID={testIdWithKey('RoomsOff')}>{t('Rooms.Off')}</ThemedText>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

export default RoomsList
