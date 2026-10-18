/**
 * Room access for AI agents, in the developer preview of the new navigation:
 * an agent that has access (one room, read only, ending by itself) with
 * Withdraw, and the narrow form for giving access. Sample data; nothing is
 * granted or withdrawn.
 *
 * @module trust-tasks/preview/PreviewAiAccess
 */
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

import { PreviewNotConnected, usePreviewStyles } from './RoomsPreview'
import { SAMPLE_ROOMS } from './roomsSample'

const DURATIONS = ['Preview.Hour1', 'Preview.Hour4', 'Preview.Day1'] as const

const PreviewAiAccess: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const styles = usePreviewStyles()
  const room = SAMPLE_ROOMS[0]
  const [read, setRead] = useState(true)
  const [write, setWrite] = useState(false)
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]>('Preview.Hour1')
  const [said, setSaid] = useState(false)
  const tick = (on: boolean, label: string, onPress: () => void, key: string) => (
    <Pressable
      style={styles.row}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      testID={testIdWithKey(key)}
    >
      <Icon
        name={on ? 'checkbox-marked' : 'checkbox-blank-outline'}
        size={24}
        color={on ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
      />
      <ThemedText style={{ flex: 1 }}>{label}</ThemedText>
    </Pressable>
  )
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} testID={testIdWithKey('PreviewAiAccess')}>
        <PreviewNotConnected />
        <View style={styles.card} testID={testIdWithKey('PreviewAiAgentActive')}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="robot-outline" size={22} color={ColorPalette.brand.primary} />
            <ThemedText variant="bold" style={{ flex: 1 }}>
              {t('Preview.AiAgentName')}
            </ThemedText>
            <ThemedText variant="caption">{t('Preview.AiAgentActive')}</ThemedText>
          </View>
          <ThemedText style={styles.muted}>
            {t('Preview.AiAgentLine', { room: room.name, left: '3 h 40 min', interpolation: { escapeValue: false } })}
          </ThemedText>
          <Button
            title={t('Preview.Withdraw')}
            buttonType={ButtonType.Secondary}
            onPress={() => setSaid(true)}
            testID={testIdWithKey('PreviewAiWithdraw')}
          />
        </View>
        <View style={styles.card} testID={testIdWithKey('PreviewAiGive')}>
          <ThemedText variant="labelTitle" accessibilityRole="header">
            {t('Preview.AiGive')}
          </ThemedText>
          <ThemedText>
            {room.name} ({room.community})
          </ThemedText>
          {tick(read, t('Preview.Read'), () => setRead((v) => !v), 'PreviewAiRead')}
          {tick(write, t('Preview.WriteNeedsApproval'), () => setWrite((v) => !v), 'PreviewAiWrite')}
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {DURATIONS.map((d) => (
              <Pressable
                key={d}
                onPress={() => setDuration(d)}
                accessibilityRole="radio"
                accessibilityState={{ selected: duration === d }}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: duration === d ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey,
                }}
                testID={testIdWithKey(`PreviewAiDuration_${d.split('.')[1]}`)}
              >
                <ThemedText>{t(d)}</ThemedText>
              </Pressable>
            ))}
          </View>
          <ThemedText style={styles.muted}>{t('Preview.AiGiveHint')}</ThemedText>
          <Button
            title={t('Preview.AiGiveConfirm')}
            buttonType={ButtonType.Primary}
            onPress={() => setSaid(true)}
            testID={testIdWithKey('PreviewAiGiveConfirm')}
          />
        </View>
        {said ? (
          <ThemedText variant="bold" testID={testIdWithKey('PreviewNothingSent')}>
            {t('Preview.NothingSent')}
          </ThemedText>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

export default PreviewAiAccess
