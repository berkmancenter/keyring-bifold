/**
 * The other phone's question when a remote VRC step arrived late (IN-448; lateStep.ts): "X wants to finish your
 * relationship card now". Self-contained, mounted once at the root beside RelationshipProposalModal, the same
 * bottom-sheet pattern.
 *
 * @module vrc/components/LateStepReadyModal
 */
import { useAgent } from '@bifold/react-hooks'
import React, { useCallback, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import { useTheme } from '../../../contexts/theme'
import { useConnectionDisplayName } from '../../../hooks/connections'
import { answerPeerCheck } from '../lateStep'
import { useAnyPeerCheck } from '../hooks/useLateStep'
import { PeerReadyCard } from './LateStepCards'

const LateStepReadyModal: React.FC = () => {
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const check = useAnyPeerCheck()
  const name = useConnectionDisplayName(check?.connectionId ?? '')
  const [busy, setBusy] = useState(false)

  const answer = useCallback(
    async (ready: boolean) => {
      if (!agent || !check || busy) return
      setBusy(true)
      try {
        await answerPeerCheck(agent, check.connectionId, ready)
      } catch (e) {
        agent.config.logger.warn(`[VRC:LateStep] could not answer the ready-check: ${(e as Error).message}`)
      } finally {
        setBusy(false)
      }
    },
    [agent, check, busy]
  )

  if (!check) return null

  const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: ColorPalette.brand.modalPrimaryBackground,
      borderTopRightRadius: 20,
      borderTopLeftRadius: 20,
    },
    container: { padding: 24 },
  })

  return (
    <SafeAreaModal visible transparent animationType="slide">
      <View style={styles.overlay}>
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.container}>
            <PeerReadyCard
              name={name}
              waitedMs={check.waitedMs + (Date.now() - check.receivedAt)}
              onReady={() => void answer(true)}
              onNotNow={() => void answer(false)}
              busy={busy}
            />
          </View>
        </SafeAreaView>
      </View>
    </SafeAreaModal>
  )
}

export default LateStepReadyModal
