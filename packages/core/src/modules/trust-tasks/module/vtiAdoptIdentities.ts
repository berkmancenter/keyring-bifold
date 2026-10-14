/**
 * A new phone takes on its agent's community identities, when the person asks
 * ("Bring back your communities and cards from your agent"; Alberto, 10-13,
 * for 242). Never on its own at link: the phone shows communities it did not
 * join itself only once the person has asked for them.
 *
 * A phone keeps an identity per community (`VtiPersona`). A new install holds
 * none, so it had nothing to restore cards for: the cards the agent keeps
 * stayed there. The agent knows its DIDs (`dids/list`), and its vault keeps the
 * cards each community issued to one of them. A card about one of the agent's
 * own DIDs names the community it is for (its issuer), so the identity is
 * recorded from the two, and nothing else is guessed.
 *
 * @module trust-tasks/module/vtiAdoptIdentities
 */

import type { VtaMintedDid } from './VtaClient'
import { VAULT_GET, VAULT_QUERY, type VaultTask } from './vtiCardVault'
import type { VtiIdentityStore, VtiPersona } from './VtiIdentityStore'
import { classifyCredential } from './vtiInbox'

/** What the vault is asked for: the cards that say a DID is in a community (as `recoverCardsFromAgent`). */
const COMMUNITY_CARD_QUERIES: Record<string, string>[] = [
  { purpose: 'membership' },
  { purpose: 'role' },
  { purpose: 'endorsement' },
  { type: 'AuthorityCredential' },
]

/**
 * Record, on this phone, each of `vtaDid`'s identities that a community card in
 * its vault is about and that this phone does not hold yet for that community.
 * A membership card wins over a role or vetter grant for the same community, and the
 * newer card over the older. What the vault cannot answer for is skipped; an
 * agent that does not answer at all throws. The identities recorded.
 */
export async function adoptAgentIdentities(options: {
  identities: VtiIdentityStore
  vtaDid: string
  task: VaultTask
  listDids: () => Promise<VtaMintedDid[]>
  now?: () => number
}): Promise<VtiPersona[]> {
  const { identities, vtaDid, task } = options
  const now = options.now ?? Date.now
  const minted = new Map((await options.listDids()).map((d) => [d.did, d]))
  if (minted.size === 0) return []

  const ids = new Set<string>()
  for (const query of COMMUNITY_CARD_QUERIES) {
    const answer = await task<{ credentials?: { id?: string }[] }>(VAULT_QUERY, query).catch(() => undefined)
    for (const d of answer?.credentials ?? []) if (typeof d.id === 'string' && d.id) ids.add(d.id)
  }

  // One identity per community: the best card found for it.
  const best = new Map<string, { did: string; membership: boolean; from: string }>()
  for (const id of ids) {
    const got = await task<{ credential?: Record<string, unknown> }>(VAULT_GET, { id }).catch(() => undefined)
    const credential = got?.credential
    if (!credential) continue
    const item = classifyCredential(credential)
    // The cards a community gives an identity in it: membership, a role, a vetter grant.
    if (item.kind !== 'membership' && item.kind !== 'role' && item.kind !== 'vetter-grant') continue
    if (!item.communityDid || !minted.has(item.subjectDid)) continue
    const membership = item.kind === 'membership'
    const from = typeof credential.validFrom === 'string' ? credential.validFrom : ''
    const held = best.get(item.communityDid)
    const better =
      !held || (membership && !held.membership) || (membership === held.membership && from.localeCompare(held.from) > 0)
    if (better) best.set(item.communityDid, { did: item.subjectDid, membership, from })
  }

  const adopted: VtiPersona[] = []
  for (const [communityDid, { did }] of best) {
    // An identity this phone already holds for the community is kept as it is.
    if (await identities.getPersona(communityDid, vtaDid)) continue
    const at = minted.get(did) as VtaMintedDid
    const persona: VtiPersona = {
      communityDid,
      vtaDid,
      did,
      contextId: at.contextId,
      vtaKeyIds: { signing: at.signingKeyId, keyAgreement: at.kaKeyId },
      createdAt: new Date(now()).toISOString(),
    }
    await identities.setPersona(persona)
    adopted.push(persona)
  }
  return adopted
}
