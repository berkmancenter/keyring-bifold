/**
 * Which community cards the Wallet leaves out: those no linked agent holds.
 *
 * The Wallet is one wallet across the agents linked to this phone, and a card
 * shows only while the agent that holds it is linked. The agent holds a card's
 * keys, so with no such agent the phone cannot show the card is the person's:
 * what is left is a record of something true, not a card to present. A card
 * with no known holder is treated the same.
 *
 * This decides what is drawn and nothing else. `syncCardsToWallet` hides a card
 * by deleting its copy, so a card it would keep stays stored: the record and its
 * copy are left in place, and linking the agent shows the card again.
 *
 * @module trust-tasks/module/walletCardHolders
 */
import type { Agent } from '@credo-ts/core'
import { useEffect, useState } from 'react'
import { DeviceEventEmitter } from 'react-native'

import { COMMUNITY_CHANGED_EVENT, VTI_PERSONA_DELIVERIES_EVENT } from './communityChanged'
import { heldByAgent } from './heldByAgent'
import { vtaAgent } from './vtaAgent'
import { GenericRecordsCommunityStore, type VtiCommunityStore } from './VtiCommunityStore'
import { GenericRecordsIdentityStore, type VtiPersona } from './VtiIdentityStore'
import { linkedAgentsNow, walletCardKey } from './vtiWalletCards'

/** The Wallet keys of the store's cards that no agent in `linked` holds. A card with any linked holder shows. */
export async function cardsNoLinkedAgentHolds(
  store: Pick<VtiCommunityStore, 'listMemberships' | 'listHeldCredentials'>,
  personas: Pick<VtiPersona, 'did' | 'vtaDid'>[],
  linked: string[]
): Promise<Set<string>> {
  const holders = new Map<string, (string | undefined)[]>()
  const add = (card: Record<string, unknown> | undefined, holder: string | undefined) => {
    const key = card ? walletCardKey(card) : undefined
    if (key) holders.set(key, [...(holders.get(key) ?? []), holder])
  }
  for (const m of await store.listMemberships()) {
    add(m.vmc, m.personaDid)
    add(m.roleVec, m.personaDid)
  }
  for (const h of await store.listHeldCredentials()) add(h.credential, h.subjectDid)
  const hidden = new Set<string>()
  for (const [key, ofCard] of holders) {
    if (!ofCard.some((holder) => linked.some((agentDid) => heldByAgent(holder, personas, agentDid)))) hidden.add(key)
  }
  return hidden
}

/** The last reading, so a return to the Wallet draws at once: every tab unmounts when it loses focus. */
let lastRead: { agent: Agent; hidden: ReadonlySet<string> } | undefined

/** Forget the last reading (tests start clean with it). */
export const forgetCardHolders = () => {
  lastRead = undefined
}

const NOTHING_HIDDEN: ReadonlySet<string> = new Set()

/**
 * The cards to leave out for `agent`, kept up as cards arrive and agents are
 * linked or unlinked. Undefined until first read, when a card cannot yet be
 * drawn as shown or not. Nothing is hidden until the linked agents have been
 * read, or when a store cannot be read: that says nothing about whose a card is.
 */
export function useCardsNoLinkedAgentHolds(agent: Agent | undefined): ReadonlySet<string> | undefined {
  const [hidden, setHidden] = useState(() =>
    !agent ? NOTHING_HIDDEN : lastRead?.agent === agent ? lastRead.hidden : undefined
  )
  useEffect(() => {
    if (!agent) {
      setHidden(NOTHING_HIDDEN)
      return
    }
    let live = true
    let seq = 0
    const read = async () => {
      const mine = ++seq
      const linked = linkedAgentsNow()
      const next: ReadonlySet<string> = linked
        ? await Promise.all([
            new GenericRecordsCommunityStore(agent),
            new GenericRecordsIdentityStore(agent).listPersonas(),
          ])
            .then(([store, personas]) => cardsNoLinkedAgentHolds(store, personas, linked))
            .catch(() => NOTHING_HIDDEN)
        : NOTHING_HIDDEN
      if (!live || mine !== seq) return
      lastRead = { agent, hidden: next }
      setHidden(next)
    }
    const subs = [COMMUNITY_CHANGED_EVENT, VTI_PERSONA_DELIVERIES_EVENT].map((name) =>
      DeviceEventEmitter.addListener(name, () => void read())
    )
    let agentsSeen = JSON.stringify(linkedAgentsNow() ?? null)
    const stopAgents = vtaAgent.subscribe(() => {
      const now = JSON.stringify(linkedAgentsNow() ?? null)
      if (now === agentsSeen) return
      agentsSeen = now
      void read()
    })
    void read()
    return () => {
      live = false
      subs.forEach((s) => s.remove())
      stopAgents()
    }
  }, [agent])
  return hidden
}
