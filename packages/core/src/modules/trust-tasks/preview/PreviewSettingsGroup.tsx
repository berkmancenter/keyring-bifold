/**
 * One settings group on You, in the developer preview of the new navigation
 * (option C3): a short list that opens today's setting screens, unchanged.
 * Security: biometrics, PIN, auto-lock. Exchanges: hardware attestation,
 * locality confirmation, witness reporting. Language and backup: language,
 * export and import. The rest stays in today's Menu ("All settings").
 *
 * @module trust-tasks/preview/PreviewSettingsGroup
 */
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { MyAgentStackParams, Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'

import { Group, ListRow, type SettingsGroupKey } from './PreviewParts'

export const SETTINGS_GROUPS: Record<SettingsGroupKey, { screen: Screens; label: string }[]> = {
  security: [
    { screen: Screens.ToggleBiometry, label: 'Global.Biometrics' },
    { screen: Screens.ChangePIN, label: 'Settings.ChangePin' },
    { screen: Screens.AutoLock, label: 'Settings.AutoLockTime' },
  ],
  exchanges: [
    { screen: Screens.ToggleHardwareAttestation, label: 'Settings.HardwareAttestation' },
    { screen: Screens.ToggleLocalityConfirmation, label: 'Settings.LocalityConfirmation' },
    { screen: Screens.ToggleWitnessReporting, label: 'Settings.WitnessReporting' },
  ],
  general: [
    { screen: Screens.Language, label: 'Settings.Language' },
    { screen: Screens.ExportWallet, label: 'Settings.ExportWallet' },
    { screen: Screens.ImportWallet, label: 'Settings.ImportWallet' },
  ],
}

export const settingsGroupTitle = (group: SettingsGroupKey) =>
  group === 'security'
    ? 'Preview.SettingsSecurity'
    : group === 'exchanges'
      ? 'Preview.SettingsExchanges'
      : 'Preview.SettingsGeneral'

const PreviewSettingsGroup: React.FC = () => {
  const { t } = useTranslation()
  const navigation = useNavigation() as unknown as { navigate: (name: string) => void }
  const { params } = useRoute<RouteProp<MyAgentStackParams, Screens.PreviewSettingsGroup>>()
  const group = params?.group ?? 'security'
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={{ padding: 16 }} testID={testIdWithKey(`PreviewSettingsGroup_${group}`)}>
        <Group>
          {SETTINGS_GROUPS[group].map((entry) => (
            <ListRow
              key={entry.screen}
              title={t(entry.label)}
              onPress={() => navigation.navigate(entry.screen)}
              testID={`PreviewSettingsEntry_${entry.screen.replace(/\s+/g, '')}`}
            />
          ))}
        </Group>
      </ScrollView>
    </SafeAreaView>
  )
}

export default PreviewSettingsGroup
