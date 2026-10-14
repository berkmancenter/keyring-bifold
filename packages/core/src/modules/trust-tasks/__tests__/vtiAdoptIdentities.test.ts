/**
 * A new phone takes on its agent's community identities when the person asks
 * (242). A new install held none, so "Restore cards" was not even offered and
 * neither card came back (240 gate, cards-back-new-install). The agent's DIDs
 * and the cards its vault keeps about them say which identity is whose.
 */
import {
  COMMUNITY,
  fakeVault,
  membershipCard,
  persona,
  PERSONA_DID,
  roleCard,
  roleVac,
} from '../../../../__tests__/helpers/cardVault'
import type { VtaMintedDid } from '../module/VtaClient'
import { adoptAgentIdentities } from '../module/vtiAdoptIdentities'
import type { VtiIdentityStore, VtiPersona } from '../module/VtiIdentityStore'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const VTA = persona.vtaDid
const OTHER_COMMUNITY = 'did:webvh:QmOther:vtc.example:second-vtc'
const NOW = Date.parse('2026-10-13T12:00:00Z')

const mintedPersona: VtaMintedDid = {
  did: PERSONA_DID,
  contextId: 'keyring',
  scid: 'QmPersona',
  signingKeyId: 'key-sign-1',
  kaKeyId: 'key-ka-1',
}

function identities(held: VtiPersona[] = []) {
  const map = new Map(held.map((p) => [`${p.vtaDid}|${p.communityDid}`, p]))
  const store = {
    getPersona: async (communityDid: string, vtaDid?: string) => map.get(`${vtaDid}|${communityDid}`),
    setPersona: jest.fn(async (p: VtiPersona) => void map.set(`${p.vtaDid}|${p.communityDid}`, p)),
  }
  return { store: store as unknown as VtiIdentityStore & { setPersona: jest.Mock }, map }
}

async function vaultWith(...cards: Record<string, unknown>[]) {
  const vault = fakeVault()
  for (const credential of cards) {
    await vault.task('https://trusttasks.org/spec/vault/credentials/receive/0.1', { credential })
  }
  return vault
}

const adopt = (store: VtiIdentityStore, task: ReturnType<typeof fakeVault>['task'], dids = [mintedPersona]) =>
  adoptAgentIdentities({ identities: store, vtaDid: VTA, task, listDids: async () => dids, now: () => NOW })

describe("taking on the agent's identities", () => {
  it("a membership card about one of the agent's DIDs: that identity, for that community, with its key ids", async () => {
    const { store } = identities()
    const vault = await vaultWith(membershipCard)
    const adopted = await adopt(store, vault.task)
    expect(adopted).toEqual([
      {
        communityDid: COMMUNITY,
        vtaDid: VTA,
        did: PERSONA_DID,
        contextId: 'keyring',
        vtaKeyIds: { signing: 'key-sign-1', keyAgreement: 'key-ka-1' },
        createdAt: new Date(NOW).toISOString(),
      },
    ])
    expect(store.setPersona).toHaveBeenCalledTimes(1)
  })

  it('a community known only by a DTG v1 role grant (an AuthorityCredential, here role:vetter) is taken on too', async () => {
    const { store } = identities()
    const vault = await vaultWith(roleVac)
    expect((await adopt(store, vault.task)).map((p) => p.communityDid)).toEqual([COMMUNITY])
  })

  it('a membership card and a role card for one community make one identity', async () => {
    const { store } = identities()
    const vault = await vaultWith(roleCard, membershipCard)
    expect(await adopt(store, vault.task)).toHaveLength(1)
  })

  it("a card about a DID that is not the agent's is left alone", async () => {
    const { store } = identities()
    const stranger = {
      ...membershipCard,
      id: 'urn:uuid:55555555-5555-4555-8555-555555555555',
      issuer: OTHER_COMMUNITY,
      credentialSubject: { id: 'did:webvh:QmSomeoneElse:dids.example:x' },
    }
    const vault = await vaultWith(stranger)
    expect(await adopt(store, vault.task)).toEqual([])
    expect(store.setPersona).not.toHaveBeenCalled()
  })

  it('an identity this phone already holds for the community is kept as it is', async () => {
    const { store, map } = identities([persona])
    const vault = await vaultWith(membershipCard)
    expect(await adopt(store, vault.task)).toEqual([])
    expect(map.get(`${VTA}|${COMMUNITY}`)).toBe(persona)
  })

  it('an agent with no DIDs takes nothing on, and asks its vault nothing', async () => {
    const { store } = identities()
    const vault = await vaultWith(membershipCard)
    const before = vault.calls.length
    expect(await adopt(store, vault.task, [])).toEqual([])
    expect(vault.calls.length).toBe(before)
  })

  it('an agent that does not answer throws, and nothing is recorded', async () => {
    const { store } = identities()
    await expect(
      adoptAgentIdentities({
        identities: store,
        vtaDid: VTA,
        task: fakeVault().task,
        listDids: async () => {
          throw new Error('the VTA did not answer')
        },
      })
    ).rejects.toThrow('did not answer')
    expect(store.setPersona).not.toHaveBeenCalled()
  })
})
