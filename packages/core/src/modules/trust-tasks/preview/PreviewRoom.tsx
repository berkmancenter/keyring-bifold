/**
 * A room, in the developer preview of the new navigation: notes read freely,
 * each body shown exactly as written in a fenced box (no link, markup or
 * instruction in it is followed), a retracted note as a tombstone, and the
 * write sheet that names the room, the signing identity and what would be
 * written. Sample data; confirming the sheet sends nothing.
 *
 * @module trust-tasks/preview/PreviewRoom
 */
import { RouteProp, useRoute } from '@react-navigation/native'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { MyAgentStackParams, Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'

import { PreviewNotConnected, TierBadge, tierKey, usePreviewStyles } from './RoomsPreview'
import { SAMPLE_PERSONA, sampleDate, sampleRoom } from './roomsSample'

const PreviewRoom: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const styles = usePreviewStyles()
  const route = useRoute<RouteProp<MyAgentStackParams, Screens.PreviewRoom>>()
  const room = sampleRoom(route.params?.roomId)
  const [writing, setWriting] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [sent, setSent] = useState(false)
  const local = StyleSheet.create({
    content: { padding: 16, gap: 16 },
    fence: {
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.lightGrey,
      borderRadius: 6,
      padding: 10,
      backgroundColor: ColorPalette.brand.primaryBackground,
    },
    mono: {
      fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }),
      fontSize: 14,
      color: TextTheme.normal.color,
    },
    input: {
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.mediumGrey,
      borderRadius: 6,
      padding: 10,
      color: TextTheme.normal.color,
    },
    sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: {
      backgroundColor: ColorPalette.brand.primaryBackground,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      padding: 20,
      gap: 10,
    },
  })
  const access = t(room.write ? 'Preview.AccessReadWrite' : 'Preview.AccessRead')
  const closeSheet = () => {
    setWriting(false)
    setSent(false)
  }
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={local.content} testID={testIdWithKey('PreviewRoom')}>
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ThemedText variant="headingFour">{room.name}</ThemedText>
            <TierBadge tier={room.tier} />
          </View>
          <ThemedText style={styles.muted}>{room.community}</ThemedText>
          <ThemedText testID={testIdWithKey('PreviewRoomAccess')}>
            {t('Preview.YourAccess', { access, until: sampleDate(room.until), interpolation: { escapeValue: false } })}
          </ThemedText>
          <PreviewNotConnected />
        </View>
        <ThemedText variant="labelTitle" accessibilityRole="header">
          {t('Preview.Notes')}
        </ThemedText>
        {room.notes.map((note) =>
          note.retracted ? (
            <View key={note.id} style={styles.card} testID={testIdWithKey(`PreviewNote_${note.id}`)}>
              <ThemedText style={styles.muted}>{t('Preview.Retracted')}</ThemedText>
            </View>
          ) : (
            <View key={note.id} style={styles.card} testID={testIdWithKey(`PreviewNote_${note.id}`)}>
              <ThemedText variant="bold">{note.title}</ThemedText>
              <ThemedText variant="caption" style={styles.muted}>
                {t('Preview.By', { author: note.author, interpolation: { escapeValue: false } })}
              </ThemedText>
              {/* Plain text in a fence: never a link, never markup, never acted on. */}
              <View style={local.fence}>
                <ThemedText style={local.mono} selectable testID={testIdWithKey(`PreviewNoteBody_${note.id}`)}>
                  {note.body}
                </ThemedText>
              </View>
            </View>
          )
        )}
        <ThemedText variant="caption" style={styles.muted}>
          {t('Preview.InertNote')}
        </ThemedText>
        {room.write ? (
          <Button
            title={t('Preview.NewNote')}
            buttonType={ButtonType.Primary}
            onPress={() => setWriting(true)}
            testID={testIdWithKey('PreviewNewNote')}
          />
        ) : null}
      </ScrollView>
      <Modal visible={writing} transparent animationType="slide" onRequestClose={closeSheet}>
        <View style={local.sheetBackdrop}>
          <View style={local.sheet} testID={testIdWithKey('PreviewWriteSheet')}>
            <ThemedText variant="headingFour">
              {t('Preview.WriteTitle', { room: room.name, interpolation: { escapeValue: false } })}
            </ThemedText>
            <PreviewNotConnected testID="PreviewWriteSheetNotConnected" />
            <TextInput
              style={local.input}
              placeholder={t('Preview.NoteTitle')}
              placeholderTextColor={ColorPalette.grayscale.mediumGrey}
              value={title}
              onChangeText={setTitle}
              testID={testIdWithKey('PreviewWriteTitle')}
            />
            <TextInput
              style={[local.input, { minHeight: 80 }]}
              placeholder={t('Preview.NoteBody')}
              placeholderTextColor={ColorPalette.grayscale.mediumGrey}
              value={body}
              onChangeText={setBody}
              multiline
              testID={testIdWithKey('PreviewWriteBody')}
            />
            <ThemedText variant="caption" style={styles.muted}>
              {t('Preview.Room')}
            </ThemedText>
            <ThemedText>
              {room.name} · {t(tierKey(room.tier))}
            </ThemedText>
            <ThemedText variant="caption" style={styles.muted}>
              {t('Preview.SignedAs')}
            </ThemedText>
            <ThemedText>
              {SAMPLE_PERSONA} ·{' '}
              {t('Preview.IdentityFor', { community: room.community, interpolation: { escapeValue: false } })}
            </ThemedText>
            <ThemedText variant="caption" style={styles.muted}>
              {t('Preview.Writing')}
            </ThemedText>
            <ThemedText testID={testIdWithKey('PreviewWriteSummary')}>
              {t('Preview.WritingNote', { title, count: body.length, interpolation: { escapeValue: false } })}
            </ThemedText>
            <ThemedText style={styles.muted}>{t('Preview.WriteConsequence')}</ThemedText>
            {sent ? (
              <ThemedText variant="bold" testID={testIdWithKey('PreviewNothingSent')}>
                {t('Preview.NothingSent')}
              </ThemedText>
            ) : (
              <Button
                title={t('Preview.WriteConfirm')}
                buttonType={ButtonType.Primary}
                onPress={() => setSent(true)}
                testID={testIdWithKey('PreviewWriteConfirm')}
              />
            )}
            <Button
              title={t(sent ? 'Preview.Close' : 'Preview.Cancel')}
              buttonType={ButtonType.Secondary}
              onPress={closeSheet}
              testID={testIdWithKey('PreviewWriteCancel')}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

export default PreviewRoom
