/**
 * The Wallet shows a community card only while the agent holding it is linked.
 * One wallet across linked agents: a card of any linked agent shows, whichever
 * is current. A card with no known holder goes the same way. Nothing is removed:
 * each is only left out of the drawing.
 */
import { act, renderHook } from '@testing-library/react-native'
import { DeviceEventEmitter } from 'react-native'

import { fakeAgent } from '../../../../__tests__/helpers/cardVault'
import { COMMUNITY_CHANGED_EVENT } from '../module/communityChanged'
import { vtaAgent } from '../module/vtaAgent'
import { cardsNoLinkedAgentHolds, forgetCardHolders, useCardsNoLinkedAgentHolds } from '../module/walletCardHolders'
import { GenericRecordsCommunityStore, type VtiMembership } from '../module/VtiCommunityStore'
import { GenericRecordsIdentityStore } from '../module/VtiIdentityStore'
import { walletCardKey } from '../module/vtiWalletCards'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const C = 'did:webvh:QmCommunity:wallet:community'
const AGENT_A = 'did:webvh:QmA:wallet:vta-a'
const AGENT_B = 'did:webvh:QmB:wallet:vta-b'
const GONE = 'did:webvh:QmGone:wallet:vta-gone'
const AT_A = 'did:webvh:QmAtA:wallet:at-a'
const AT_B = 'did:webvh:QmAtB:wallet:at-b'
const AT_GONE = 'did:webvh:QmAtGone:wallet:at-gone'

const card = (id: string) => ({ id, type: ['VerifiableCredential'] })
const key = (id: string) => walletCardKey(card(id)) as string
const membership = (personaDid: string, id: string, extra: Partial<VtiMembership> = {}): VtiMembership => ({
  communityDid: C,
  personaDid,
  role: 'member',
  vmc: card(id),
  grantedAt: '2026-10-30T00:00:00Z',
  via: 'approval',
  ...extra,
})
const personas = [
  { did: AT_A, vtaDid: AGENT_A },
  { did: AT_B, vtaDid: AGENT_B },
  { did: AT_GONE, vtaDid: GONE },
]
const store = (memberships: VtiMembership[], held: unknown[] = []) =>
  ({ listMemberships: async () => memberships, listHeldCredentials: async () => held }) as never

describe('which cards the Wallet leaves out', () => {
  it('shows every linked agent’s cards, not only the current one’s', async () => {
    const hidden = await cardsNoLinkedAgentHolds(
      store([membership(AT_A, 'urn:a'), membership(AT_B, 'urn:b')]),
      personas,
      [AGENT_A, AGENT_B]
    )
    expect(hidden.size).toBe(0)
  })

  it('shows a card held as a linked agent itself', async () => {
    expect((await cardsNoLinkedAgentHolds(store([membership(AGENT_A, 'urn:own')]), personas, [AGENT_A])).size).toBe(0)
  })

  it('leaves out a card of an agent no longer linked, and one with no known holder', async () => {
    const hidden = await cardsNoLinkedAgentHolds(
      store([membership(AT_GONE, 'urn:gone'), membership('did:webvh:QmNobody:wallet:nobody', 'urn:nobody')]),
      personas,
      [AGENT_A]
    )
    expect([...hidden].sort()).toEqual([key('urn:gone'), key('urn:nobody')].sort())
  })

  it('leaves out a role card and a held card the same way', async () => {
    const hidden = await cardsNoLinkedAgentHolds(
      store(
        [membership(AT_GONE, 'urn:gone', { roleVec: card('urn:role') })],
        [{ kind: 'vetter-grant', communityDid: C, subjectDid: AT_GONE, credential: card('urn:grant') }]
      ),
      personas,
      [AGENT_A]
    )
    expect([...hidden].sort()).toEqual([key('urn:gone'), key('urn:role'), key('urn:grant')].sort())
  })

  it('shows a card one linked agent holds, even if a gone agent holds it too', async () => {
    const hidden = await cardsNoLinkedAgentHolds(
      store([membership(AT_GONE, 'urn:same'), membership(AT_A, 'urn:same')]),
      personas,
      [AGENT_A]
    )
    expect(hidden.size).toBe(0)
  })

  it('with no agent linked, leaves out every community card', async () => {
    const hidden = await cardsNoLinkedAgentHolds(store([membership(AT_A, 'urn:a')]), personas, [])
    expect([...hidden]).toEqual([key('urn:a')])
  })
})

describe('the Wallet’s reading', () => {
  type Setter = { set(next: Record<string, unknown>): void }
  const controller = vtaAgent as unknown as Setter
  const linkedTo = (...dids: string[]) =>
    controller.set({ linkRestored: true, agents: dids.map((vtaDid) => ({ vtaDid })) })

  beforeEach(() => forgetCardHolders())
  afterEach(() => controller.set({ linkRestored: false, agents: undefined }))

  async function phone() {
    const { agent, records } = fakeAgent()
    await new GenericRecordsCommunityStore(agent).saveMembership(membership(AT_GONE, 'urn:gone'))
    await new GenericRecordsIdentityStore(agent).setPersona({
      did: AT_GONE,
      communityDid: C,
      vtaDid: GONE,
      contextId: 'ctx',
      vtaKeyIds: { signing: 's', keyAgreement: 'k' },
      createdAt: 't',
    } as never)
    return { agent, records }
  }

  it('is not known until read, then says what to leave out, and removes nothing', async () => {
    const { agent, records } = await phone()
    linkedTo(AGENT_A)
    const before = records.length
    const { result } = renderHook(() => useCardsNoLinkedAgentHolds(agent))
    expect(result.current).toBeUndefined()
    await act(async () => undefined)
    expect([...(result.current as Set<string>)]).toEqual([key('urn:gone')])
    expect(records).toHaveLength(before)
  })

  it('hides nothing before the linked agents have been read', async () => {
    const { agent } = await phone()
    const { result } = renderHook(() => useCardsNoLinkedAgentHolds(agent))
    await act(async () => undefined)
    expect((result.current as Set<string>).size).toBe(0)
  })

  it('hides nothing when a store cannot be read', async () => {
    const { agent } = await phone()
    linkedTo(AGENT_A)
    // Every read while it fails: the store's own writes above announce a change, and that reads again.
    const unreadable = jest
      .spyOn(GenericRecordsIdentityStore.prototype, 'listPersonas')
      .mockRejectedValue(new Error('locked'))
    const { result } = renderHook(() => useCardsNoLinkedAgentHolds(agent))
    await act(async () => undefined)
    expect((result.current as Set<string>).size).toBe(0)
    unreadable.mockRestore()
  })

  it('shows the card again when its agent is linked again', async () => {
    const { agent } = await phone()
    linkedTo(AGENT_A)
    const { result } = renderHook(() => useCardsNoLinkedAgentHolds(agent))
    await act(async () => undefined)
    expect(result.current?.size).toBe(1)
    await act(async () => linkedTo(AGENT_A, GONE))
    expect(result.current?.size).toBe(0)
  })

  it('reads again when a card arrives', async () => {
    const { agent } = await phone()
    linkedTo(AGENT_A)
    const { result } = renderHook(() => useCardsNoLinkedAgentHolds(agent))
    await act(async () => undefined)
    await new GenericRecordsCommunityStore(agent).saveMembership(membership('did:webvh:QmNew:wallet:new', 'urn:new'))
    await act(async () => void DeviceEventEmitter.emit(COMMUNITY_CHANGED_EVENT, { communityDid: C }))
    expect(result.current?.size).toBe(2)
  })

  it('a return to the Wallet draws from the last reading at once', async () => {
    const { agent } = await phone()
    linkedTo(AGENT_A)
    const first = renderHook(() => useCardsNoLinkedAgentHolds(agent))
    await act(async () => undefined)
    first.unmount()
    const { result } = renderHook(() => useCardsNoLinkedAgentHolds(agent))
    expect(result.current?.size).toBe(1)
    await act(async () => undefined)
  })
})
