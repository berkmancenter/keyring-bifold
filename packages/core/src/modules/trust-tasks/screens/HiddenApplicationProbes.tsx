/**
 * TEST BUILDS ONLY, for the device run of bifold #924: each private application this phone
 * created, whether the app still holds it, what the app's own delete got back, and a button
 * that asks the agent (`vta/pcs/applications/show`, as this phone) and shows its raw answer.
 * Renders nothing without E2E_CLOCKS. This branch is never merged.
 *
 * @module trust-tasks/screens/HiddenApplicationProbes
 */
import { useAgent } from '@bifold/react-hooks'
import React, { useCallback, useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { useTheme } from '../../../contexts/theme'
import { e2eClocksSet } from '../../../utils/e2eClocks'
import { testIdWithKey } from '../../../utils/testable'
import { loadClosedHiddenApplication, loadHiddenVettingRecord } from '../module/hiddenVetting'
import { askAgent, listProbes, type HiddenApplicationProbe } from '../module/hiddenVettingProbe'
import { closeEndedHiddenApplications } from '../module/vtiVetting'

type Row = HiddenApplicationProbe & { here: string }

export const HiddenApplicationProbes: React.FC = () => {
  const { agent } = useAgent()
  const { ColorPalette, TextTheme } = useTheme()
  const [rows, setRows] = useState<Row[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string>()

  const read = useCallback(async () => {
    if (!agent) return
    const probes = await listProbes(agent)
    setRows(
      await Promise.all(
        probes.map(async (p) => {
          const open = await loadHiddenVettingRecord(agent, p.community)
          const closed = await loadClosedHiddenApplication(agent, p.community)
          const here =
            open?.applicationId === p.applicationId
              ? 'open'
              : closed && closed.joinDid === p.joinDid
                ? `closed: ${closed.closed}`
                : 'not held'
          return { ...p, here }
        })
      )
    )
  }, [agent])

  useEffect(() => {
    void read()
  }, [read])

  if (!e2eClocksSet()) return null
  const styles = StyleSheet.create({
    box: { margin: 10, gap: 10 },
    h: { ...TextTheme.bold, color: TextTheme.normal.color },
    row: { borderWidth: 1, borderColor: ColorPalette.grayscale.lightGrey, borderRadius: 8, padding: 10, gap: 4 },
    mono: { fontFamily: 'Courier', fontSize: 12, color: TextTheme.normal.color },
    button: { backgroundColor: ColorPalette.brand.primary, borderRadius: 8, padding: 10, alignItems: 'center' },
    buttonText: { color: '#FFFFFF', fontWeight: '700' },
  })
  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key)
    try {
      await work()
    } finally {
      setBusy(undefined)
      await read()
    }
  }

  return (
    <View style={styles.box} testID={testIdWithKey('HiddenApplicationProbes')}>
      <Text style={styles.h}>Private applications (test build)</Text>
      <Pressable
        style={styles.button}
        disabled={!!busy}
        testID={testIdWithKey('HiddenApplicationProbesSweep')}
        onPress={() => agent && void run('sweep', () => closeEndedHiddenApplications(agent))}
      >
        <Text style={styles.buttonText}>{busy === 'sweep' ? 'Sweeping…' : 'Run the sweep now'}</Text>
      </Pressable>
      {rows.length === 0 ? <Text style={styles.mono}>none created on this phone since this build</Text> : null}
      {rows.map((r, i) => (
        <View key={r.applicationId} style={styles.row} testID={testIdWithKey(`HiddenApplicationProbe_${i}`)}>
          <Text style={styles.mono} selectable>
            {`community ${r.community.slice(0, 40)}…\napplicationId ${r.applicationId}\nagent ${(r.vtaDid ?? 'current').slice(0, 40)}…\ncreated ${r.createdAt}\nhere: ${r.here}\napp's delete: ${r.deleteOutcome ?? 'not tried'}${r.deleteAt ? ` at ${r.deleteAt}` : ''}`}
          </Text>
          <Pressable
            style={styles.button}
            disabled={!!busy}
            testID={testIdWithKey(`HiddenApplicationProbeAsk_${i}`)}
            onPress={() =>
              agent &&
              void run(r.applicationId, async () => {
                const answer = await askAgent(agent, r)
                setAnswers((was) => ({ ...was, [r.applicationId]: `${new Date().toISOString()} ${answer}` }))
              })
            }
          >
            <Text style={styles.buttonText}>{busy === r.applicationId ? 'Asking…' : 'Ask the agent'}</Text>
          </Pressable>
          {answers[r.applicationId] ? (
            <Text style={styles.mono} selectable testID={testIdWithKey(`HiddenApplicationProbeAnswer_${i}`)}>
              {answers[r.applicationId]}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  )
}

export default HiddenApplicationProbes
