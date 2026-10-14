/**
 * Manage → "Bring back your communities and cards from your agent" (226,
 * agent-kept cards; 242): first take on the agent's community identities this
 * phone does not hold yet (vtiAdoptIdentities), then fetch the cards the agent
 * keeps for every identity and keep them on this phone again — after a
 * reinstall, on a new phone, or any time a card went missing here.
 *
 * Offered whenever an agent is linked, a new phone with no identity included.
 * Identities are taken on only here, when the person asks: never at link.
 *
 * @module trust-tasks/screens/GetCardsFromAgent
 */

import type { Agent } from '@credo-ts/core'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { emitCommunityChanged } from '../module/communityChanged'
import { vtaAgent } from '../module/vtaAgent'
import { adoptAgentIdentities } from '../module/vtiAdoptIdentities'
import { recoverCardsFromAgent, type RecoveredRefusal, type VaultTask } from '../module/vtiCardVault'
import { GenericRecordsCommunityStore, type VtiCommunityStore } from '../module/VtiCommunityStore'
import { GenericRecordsIdentityStore, type VtiPersona } from '../module/VtiIdentityStore'

export interface CardsBack {
  found: number
  restored: number
  refused: RecoveredRefusal[]
  /** Identities whose agent did not answer. */
  unreachable: number
  /** Communities whose identity this phone took on from its agent first. */
  adopted?: number
  /** Identities asked, those taken on included. */
  asked?: number
  /** The identities taken on, for the next run to ask again without taking them on twice. */
  taken?: VtiPersona[]
}

export interface GetCardsDeps {
  recover: typeof recoverCardsFromAgent
  store: (agent: Agent) => VtiCommunityStore
  /** The persona's agent, connected, as a task sender. */
  taskFor: (agent: Agent, persona: VtiPersona) => Promise<VaultTask>
  /** Take on the agent's identities this phone does not hold yet; those taken on. */
  adopt: (agent: Agent, vtaDid: string) => Promise<VtiPersona[]>
}

const defaultDeps: GetCardsDeps = {
  recover: recoverCardsFromAgent,
  store: (agent) => new GenericRecordsCommunityStore(agent),
  taskFor: async (agent, persona) => {
    await vtaAgent.connect(agent, persona.vtaDid)
    const client = vtaAgent.client(agent, persona.vtaDid)
    return <T,>(type: string, payload: Record<string, unknown>) => client.task<T>(type, payload)
  },
  adopt: async (agent, vtaDid) => {
    await vtaAgent.connect(agent, vtaDid)
    const client = vtaAgent.client(agent, vtaDid)
    return adoptAgentIdentities({
      identities: new GenericRecordsIdentityStore(agent),
      vtaDid,
      task: <T,>(type: string, payload: Record<string, unknown>) => client.task<T>(type, payload),
      listDids: () => client.listDids(),
    })
  },
}

/**
 * The whole of "Bring back": the agent's identities this phone lacks are taken
 * on first (an agent that does not answer takes nothing on, and the cards of
 * the identities already here are still fetched), then every identity's cards.
 */
export async function bringBackFromAgent(
  agent: Agent,
  vtaDid: string | undefined,
  personas: VtiPersona[],
  onProgress: (p: { found: number; restored: number }) => void,
  deps: GetCardsDeps = defaultDeps
): Promise<CardsBack> {
  let silent = false
  const adopted = vtaDid
    ? await deps.adopt(agent, vtaDid).catch(() => {
        silent = true
        return [] as VtiPersona[]
      })
    : []
  const held = new Set(personas.map((p) => `${p.vtaDid}|${p.communityDid}`))
  const fresh = adopted.filter((p) => !held.has(`${p.vtaDid}|${p.communityDid}`))
  const all = [...personas, ...fresh]
  // Nothing on this phone, and the agent did not answer: said as unreachable, not "no cards".
  if (silent && all.length === 0)
    return { found: 0, restored: 0, refused: [], unreachable: 1, adopted: 0, asked: 1, taken: [] }
  for (const p of fresh) emitCommunityChanged(p.communityDid, 'membership')
  const got = await getCardsFromAgent(agent, all, onProgress, deps)
  return { ...got, adopted: fresh.length, asked: all.length, taken: fresh }
}

/**
 * Every identity on this phone, one after another (the agent answers one task
 * at a time); a count across all of them as it goes. An identity whose agent
 * does not answer is counted, and the others still run.
 */
export async function getCardsFromAgent(
  agent: Agent,
  personas: VtiPersona[],
  onProgress: (p: { found: number; restored: number }) => void,
  deps: GetCardsDeps = defaultDeps
): Promise<CardsBack> {
  const store = deps.store(agent)
  const total: CardsBack = { found: 0, restored: 0, refused: [], unreachable: 0 }
  for (const persona of personas) {
    const before = { found: total.found, restored: total.restored }
    try {
      const task = await deps.taskFor(agent, persona)
      const got = await deps.recover(agent, store, persona, task, {
        onProgress: (p) => onProgress({ found: before.found + p.found, restored: before.restored + p.restored }),
      })
      total.found += got.found
      total.restored += got.restored.length
      total.refused.push(...got.refused)
      if (got.restored.length) emitCommunityChanged(persona.communityDid, 'membership')
    } catch {
      total.unreachable += 1
    }
  }
  return total
}

/** Why a card was not kept, in words (the vault module gives codes). */
export const REFUSED_WORDS: Record<RecoveredRefusal['reason'], string> = {
  failedCheck: 'VtaLink.CardsBackFailedCheck',
  notOurs: 'VtaLink.CardsBackNotOurs',
  unreadable: 'VtaLink.CardsBackUnreadable',
}

export const GetCardsFromAgent: React.FC<{
  agent: Agent
  personas: VtiPersona[]
  /** The linked agent: offered with it even on a phone that holds no identity yet. */
  vtaDid?: string
  deps?: GetCardsDeps
}> = ({ agent, personas, vtaDid, deps }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const [progress, setProgress] = useState<{ found: number; restored: number }>()
  const [result, setResult] = useState<CardsBack>()
  // Identities taken on by an earlier tap: the screen's list was read before them.
  const [taken, setTaken] = useState<VtiPersona[]>([])
  const running = progress !== undefined && result === undefined
  const styles = StyleSheet.create({
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })
  if (personas.length === 0 && !vtaDid) return null

  const start = async () => {
    setResult(undefined)
    setProgress({ found: 0, restored: 0 })
    const got = await bringBackFromAgent(agent, vtaDid, [...personas, ...taken], setProgress, deps)
    if (got.taken?.length) setTaken((before) => [...before, ...(got.taken ?? [])])
    setResult(got)
  }

  const refusedBy = (reason: RecoveredRefusal['reason']) =>
    result?.refused.filter((r) => r.reason === reason).length ?? 0

  return (
    <View style={styles.card} testID={testIdWithKey('AgentGetCards')}>
      <ThemedText variant="labelTitle">{t('VtaLink.GetCardsTitle')}</ThemedText>
      <ThemedText style={styles.muted}>{t('VtaLink.GetCardsBody')}</ThemedText>
      {running ? (
        <View style={styles.row}>
          <ActivityIndicator color={ColorPalette.brand.primary} />
          <ThemedText testID={testIdWithKey('AgentGetCardsProgress')}>
            {t('VtaLink.GetCardsProgress', { found: progress!.found, restored: progress!.restored })}
          </ThemedText>
        </View>
      ) : null}
      {result ? (
        <View testID={testIdWithKey('AgentGetCardsResult')}>
          {result.adopted ? (
            <ThemedText testID={testIdWithKey('AgentGetCardsCommunities')}>
              {t('VtaLink.CommunitiesBack', { count: result.adopted })}
            </ThemedText>
          ) : null}
          <ThemedText>
            {result.restored > 0
              ? t('VtaLink.CardsBack', { count: result.restored })
              : result.found > 0
                ? t('VtaLink.CardsBackNoneKept')
                : result.unreachable === (result.asked ?? personas.length)
                  ? t('VtaLink.CardsBackUnreachable')
                  : t('VtaLink.CardsBackNone')}
          </ThemedText>
          {(Object.keys(REFUSED_WORDS) as RecoveredRefusal['reason'][])
            .filter((reason) => refusedBy(reason) > 0)
            .map((reason) => (
              <ThemedText key={reason} style={styles.muted} testID={testIdWithKey(`AgentGetCardsRefused_${reason}`)}>
                {t(REFUSED_WORDS[reason], { count: refusedBy(reason) })}
              </ThemedText>
            ))}
          {result.unreachable > 0 && result.unreachable < (result.asked ?? personas.length) ? (
            <ThemedText style={styles.muted}>{t('VtaLink.CardsBackSomeUnreachable')}</ThemedText>
          ) : null}
        </View>
      ) : null}
      <Button
        title={t('VtaLink.GetCardsButton')}
        buttonType={ButtonType.Secondary}
        disabled={running}
        onPress={() => void start()}
        testID={testIdWithKey('AgentGetCardsButton')}
      />
      {/* When to use it: it copies the agent's cards back to this phone, and
          nothing else (Alberto, K7, 10-04). */}
      <ThemedText style={styles.muted} testID={testIdWithKey('AgentGetCardsHint')}>
        {t('VtaLink.GetCardsHint')}
      </ThemedText>
    </View>
  )
}
