/**
 * Asked before a private application is withdrawn. Withdrawing destroys it at the
 * agent, attestations included, so applying again means going back to a vetter. A
 * named application keeps its statements, costs nothing to withdraw and isn't asked.
 *
 * @module trust-tasks/screens/VettingWithdrawConfirm
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'

import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

import { VtiVettingIds } from './VtiVetting.ids'

export const VettingWithdrawConfirm: React.FC<{ busy: boolean; onConfirm: () => void; onStay: () => void }> = ({
  busy,
  onConfirm,
  onStay,
}) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme, maxFontSizeMultiplier } = useTheme()
  const button = {
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  } as const
  const styles = StyleSheet.create({
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 12, padding: 18, gap: 12 },
    words: { ...TextTheme.normal, color: TextTheme.normal.color },
    confirm: { ...button, backgroundColor: ColorPalette.semantic.error },
    confirmText: { ...TextTheme.bold, color: '#FFFFFF', flexShrink: 1, textAlign: 'center' },
    stay: { ...button, borderWidth: 1, borderColor: ColorPalette.brand.primary },
    stayText: { ...TextTheme.bold, color: ColorPalette.brand.primary, flexShrink: 1, textAlign: 'center' },
  })
  return (
    <View style={styles.card} testID={testIdWithKey(VtiVettingIds.withdrawConfirmCard)}>
      <Text style={styles.words} testID={testIdWithKey(VtiVettingIds.withdrawConfirmWords)}>
        {t('Vetting.WithdrawPrivateExplains')}
      </Text>
      <Pressable
        style={styles.confirm}
        testID={testIdWithKey(VtiVettingIds.withdrawConfirm)}
        accessibilityRole="button"
        disabled={busy}
        onPress={onConfirm}
      >
        {busy ? <ActivityIndicator color="#FFFFFF" /> : null}
        {/* Capped as the app's Button caps its label: past this a label breaks mid-word. The words above aren't. */}
        <Text style={styles.confirmText} maxFontSizeMultiplier={maxFontSizeMultiplier}>
          {t('Vetting.Withdraw')}
        </Text>
      </Pressable>
      <Pressable
        style={styles.stay}
        testID={testIdWithKey(VtiVettingIds.withdrawStay)}
        accessibilityRole="button"
        disabled={busy}
        onPress={onStay}
      >
        <Text style={styles.stayText} maxFontSizeMultiplier={maxFontSizeMultiplier}>
          {t('Vetting.WithdrawStay')}
        </Text>
      </Pressable>
    </View>
  )
}

export default VettingWithdrawConfirm
