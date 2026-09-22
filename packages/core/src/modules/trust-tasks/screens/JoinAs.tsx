/**
 * "Who are you joining as?" — pick the profile a community's new identity
 * starts from. Every community gets its own identity; the chosen profile only
 * fills in its name, once (seed by copy). The active profile is chosen by
 * default, so most people just continue.
 *
 * Shared by both doors: I was invited (before the identity is sent to the
 * admin) and I want to join (before meeting a vetter).
 *
 * @module trust-tasks/screens/JoinAs
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import { Image, Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useStore } from '../../../contexts/store'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { formInputFromTemplate } from '../../vrc/types/rcard'
import type { JoinSeed } from '../module/vtiJoinSeed'

export interface JoinAsOption {
  id: string
  seed: JoinSeed
  photo?: string
}

/** The person's profiles as join options, the active one first. */
export function useJoinAsOptions(): { options: JoinAsOption[]; defaultId?: string } {
  const [store] = useStore()
  const profiles = store.rCard?.profiles ?? []
  const options = profiles
    .map((p) => {
      const form = formInputFromTemplate(p)
      const legalName = [form.firstName, form.lastName].filter(Boolean).join(' ').trim()
      return { id: p.id, seed: { legalName, profileLabel: form.label || undefined }, photo: form.photo }
    })
    .filter((o) => o.seed.legalName)
  const active = store.rCard?.activeProfileId
  const defaultId = options.find((o) => o.id === active)?.id ?? options[0]?.id
  return {
    options: [...options].sort((a, b) => (a.id === defaultId ? -1 : b.id === defaultId ? 1 : 0)),
    defaultId,
  }
}

export const JoinAs: React.FC<{
  community: string
  options: JoinAsOption[]
  selectedId?: string
  onSelect: (id: string) => void
}> = ({ community, options, selectedId, onSelect }) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const styles = StyleSheet.create({
    option: {
      backgroundColor: ColorPalette.brand.secondaryBackground,
      borderRadius: 8,
      padding: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderWidth: 2,
      borderColor: 'transparent',
    },
    chosen: { borderColor: ColorPalette.brand.primary },
    avatar: { width: 36, height: 36, borderRadius: 18 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })

  return (
    <View style={{ gap: 12 }} testID={testIdWithKey('JoinAs')}>
      <ThemedText>
        {t('Join.AsBody', { community, interpolation: { escapeValue: false } })}
      </ThemedText>
      {options.length === 0 ? (
        <ThemedText style={styles.muted} testID={testIdWithKey('JoinAsNoProfile')}>
          {t('Join.AsNoProfile')}
        </ThemedText>
      ) : (
        options.map((o) => {
          const chosen = o.id === selectedId
          return (
            <Pressable
              key={o.id}
              style={[styles.option, chosen ? styles.chosen : undefined]}
              onPress={() => onSelect(o.id)}
              accessibilityRole="radio"
              accessibilityState={{ checked: chosen }}
              accessibilityLabel={o.seed.profileLabel ? `${o.seed.legalName}, ${o.seed.profileLabel}` : o.seed.legalName}
              testID={testIdWithKey('JoinAsOption')}
            >
              {o.photo ? (
                <Image source={{ uri: o.photo }} style={styles.avatar} />
              ) : (
                <Icon name="account-circle" size={36} color={TextTheme.normal.color} />
              )}
              <View style={{ flex: 1 }}>
                <ThemedText variant="bold">{o.seed.legalName}</ThemedText>
                {o.seed.profileLabel ? (
                  <ThemedText style={styles.muted}>
                    {t('Join.ProfileLabel', { label: o.seed.profileLabel, interpolation: { escapeValue: false } })}
                  </ThemedText>
                ) : null}
              </View>
              <Icon
                name={chosen ? 'radiobox-marked' : 'radiobox-blank'}
                size={22}
                color={chosen ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
              />
            </Pressable>
          )
        })
      )}
    </View>
  )
}
