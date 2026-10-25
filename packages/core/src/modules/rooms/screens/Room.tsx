/**
 * A room: who can read what is posted in it, who the member acts as, and its notes, files, the member's
 * access and group chat. Each section's words come from the room's statuses (`roomCapabilities`), so a
 * room known only from the agent's keys says "Details not loaded" throughout, and an operation that is not
 * available says why instead of showing an empty list.
 *
 * The host's answer is checked by the member's agent: a `conflict` (records dropped or replayed) is shown
 * as a warning above the notes; `unverified` is normal on a first read and says nothing.
 *
 * Reached only while the rooms flag is on. Reading and writing notes, opening files and agent access come
 * in later steps; nothing here pretends to do them.
 *
 * @module rooms/screens/Room
 */
import { useRoute } from '@react-navigation/native'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { FileRow, NoteRow } from '../components/RoomListRows'
import { roomLine, roomTitle } from '../components/RoomRow'
import { RoomStatusRow } from '../components/RoomStatusRow'
import { roomsStatusText } from '../components/roomsStatusText'
import { accessText, identityText, tierHint } from '../components/roomWords'
import { SampleDataBanner } from '../components/SampleDataBanner'
import TierBadge from '../components/TierBadge'
import type { NoteSummary } from '../types'
import { useRoom } from '../useRoom'
import { useRoomsService } from '../useRoomsService'

/** Pinned notes first, then the newest. */
export const orderNotes = (notes: NoteSummary[]): NoteSummary[] =>
  [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))

const Room: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const roomId = (useRoute()?.params as { roomId?: string } | undefined)?.roomId ?? ''
  const service = useRoomsService()
  const state = useRoom(service, roomId)
  const { room, roomCapabilities, capabilities, notes, files } = state
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { padding: 16, gap: 20 },
    section: { gap: 6 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    warn: {
      flexDirection: 'row',
      gap: 10,
      padding: 12,
      borderRadius: 8,
      borderWidth: 1,
      backgroundColor: ColorPalette.notification.warn,
      borderColor: ColorPalette.notification.warnBorder,
    },
    warnText: { flex: 1, color: ColorPalette.notification.warnText },
    idName: { fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }) },
  })

  const header = (title: string) => (
    <ThemedText variant="headingFour" accessibilityRole="header">
      {title}
    </ThemedText>
  )

  let body: React.ReactNode
  if (!service) body = <ThemedText testID={testIdWithKey('RoomsOff')}>{t('Rooms.Off')}</ThemedText>
  else if (!room && state.failed)
    body = (
      <View style={styles.section}>
        <ThemedText testID={testIdWithKey('RoomReadFailed')}>{t('Rooms.AgentUnknown')}</ThemedText>
        <Button
          title={t('Rooms.TryAgain')}
          buttonType={ButtonType.Secondary}
          onPress={state.reload}
          testID={testIdWithKey('RoomTryAgain')}
        />
      </View>
    )
  else if (!room || !roomCapabilities || !capabilities)
    body = <ActivityIndicator color={ColorPalette.brand.primary} testID={testIdWithKey('RoomReading')} />
  else {
    const hint = tierHint(t, room.tier)
    const standing = roomLine(t, room, false)
    const notesUnavailable = roomsStatusText(t, roomCapabilities.listNotes, 'listNotes')
    const filesUnavailable = roomsStatusText(t, roomCapabilities.listFiles, 'listFiles')
    const membersNote = roomsStatusText(t, roomCapabilities.listCommunityMembers, 'listCommunityMembers')
    body = (
      <>
        <View style={styles.section} testID={testIdWithKey('RoomHeader')}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <ThemedText
              variant="headingThree"
              style={room.nameFrom === 'roomId' ? styles.idName : undefined}
              testID={testIdWithKey('RoomTitle')}
            >
              {roomTitle(t, room)}
            </ThemedText>
            <TierBadge tier={room.tier} />
          </View>
          {room.communityName ? <ThemedText>{room.communityName}</ThemedText> : null}
          {hint ? (
            <ThemedText style={styles.muted} testID={testIdWithKey('RoomTierHint')}>
              {hint}
            </ThemedText>
          ) : null}
          <ThemedText style={styles.muted} testID={testIdWithKey('RoomActingAs')}>
            {t('Rooms.ActingAs', { who: identityText(room.actingAs), interpolation: { escapeValue: false } })}
          </ThemedText>
          {standing ? <ThemedText style={styles.muted}>{standing}</ThemedText> : null}
        </View>

        {notes?.check.verdict === 'conflict' ? (
          <View style={styles.warn} accessibilityRole="alert" testID={testIdWithKey('RoomHostConflict')}>
            <Icon name="alert-outline" size={22} color={ColorPalette.notification.warnText} />
            <ThemedText style={styles.warnText}>{t('Rooms.HostConflict')}</ThemedText>
          </View>
        ) : null}

        <View style={styles.section} testID={testIdWithKey('RoomNotes')}>
          {header(t('Rooms.Notes'))}
          {notesUnavailable ? (
            <ThemedText style={styles.muted} testID={testIdWithKey('RoomNotesUnavailable')}>
              {notesUnavailable}
            </ThemedText>
          ) : notes ? (
            <>
              {notes.notes.length === 0 ? (
                <ThemedText style={styles.muted} testID={testIdWithKey('RoomNotesNone')}>
                  {t('Rooms.NotesNone')}
                </ThemedText>
              ) : (
                orderNotes(notes.notes).map((note) => <NoteRow key={note.key} note={note} />)
              )}
              {!notes.complete ? (
                <ThemedText style={styles.muted} testID={testIdWithKey('RoomNotesIncomplete')}>
                  {t('Rooms.NotesIncomplete')}
                </ThemedText>
              ) : null}
            </>
          ) : state.notesFailed ? (
            <ThemedText style={styles.muted} testID={testIdWithKey('RoomNotesFailed')}>
              {t('Rooms.NotesFailed')}
            </ThemedText>
          ) : (
            <ActivityIndicator color={ColorPalette.brand.primary} />
          )}
        </View>

        <View style={styles.section} testID={testIdWithKey('RoomFiles')}>
          {header(t('Rooms.Files'))}
          {filesUnavailable ? (
            <ThemedText style={styles.muted} testID={testIdWithKey('RoomFilesUnavailable')}>
              {filesUnavailable}
            </ThemedText>
          ) : files ? (
            files.length === 0 ? (
              <ThemedText style={styles.muted} testID={testIdWithKey('RoomFilesNone')}>
                {t('Rooms.FilesNone')}
              </ThemedText>
            ) : (
              files.map((file) => <FileRow key={file.fileId} file={file} />)
            )
          ) : state.filesFailed ? (
            <ThemedText style={styles.muted} testID={testIdWithKey('RoomFilesFailed')}>
              {t('Rooms.FilesFailed')}
            </ThemedText>
          ) : (
            <ActivityIndicator color={ColorPalette.brand.primary} />
          )}
        </View>

        <View style={styles.section} testID={testIdWithKey('RoomMembers')}>
          {header(t('Rooms.Members'))}
          <ThemedText testID={testIdWithKey('RoomYourAccess')}>{accessText(t, room)}</ThemedText>
          {/* No member list by design: the community's list is for its administrators. */}
          {membersNote ? (
            <ThemedText style={styles.muted} testID={testIdWithKey('RoomMembersNote')}>
              {membersNote}
            </ThemedText>
          ) : null}
        </View>

        <View style={styles.section}>
          {header(t('Rooms.Chat'))}
          <RoomStatusRow
            label={t('Rooms.GroupChat')}
            status={capabilities.groupChat}
            operation="groupChat"
            testID={testIdWithKey('RoomGroupChat')}
          />
        </View>
      </>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} testID={testIdWithKey('RoomScreen')}>
        {service ? <SampleDataBanner service={service} /> : null}
        {body}
      </ScrollView>
    </SafeAreaView>
  )
}

export default Room
