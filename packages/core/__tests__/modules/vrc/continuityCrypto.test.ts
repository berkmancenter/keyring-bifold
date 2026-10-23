/**
 * @jest-environment node
 *
 * The continuity check's cryptography on a real agent: Askar's KMS, relationship DIDs made the way
 * getOrCreateRelationshipDid makes them (did:peer:0, one Ed25519 key). A challenge sealed to one relationship DID opens
 * with that DID's key and no other.
 *
 * Uses @credo-ts/node and askar-nodejs from the workspace (declared by credo-tsp-adapter, whose tests build a real
 * agent the same way).
 */
import '@openwallet-foundation/askar-nodejs'

import { AskarModule } from '@credo-ts/askar'
import { Agent, PeerDidNumAlgo } from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { askarNodeJS as askar } from '@openwallet-foundation/askar-nodejs'

import { openChallenge, sameChallenge, sealChallenge } from '../../../src/modules/vrc/contacts/continuityCrypto'

// This tree nests more than one copy of askar-shared: register the Node binding on the copy @credo-ts/askar itself
// resolves, or opening the store says the native binding was never registered.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { NativeAskar } = require(
  require.resolve('@openwallet-foundation/askar-shared', { paths: [require.resolve('@credo-ts/askar')] })
) as { NativeAskar: { register: (native: unknown) => void } }
NativeAskar.register(askar)

async function relationshipDid(agent: Agent): Promise<string> {
  const result = await agent.dids.create({
    method: 'peer',
    options: { numAlgo: PeerDidNumAlgo.InceptionKeyWithoutDoc, createKey: { type: { kty: 'OKP', crv: 'Ed25519' } } },
  } as never)
  if (!result.didState.did) throw new Error(`test setup: ${JSON.stringify(result.didState)}`)
  return result.didState.did
}

describe('continuity crypto on a real KMS', () => {
  let agent: Agent
  let first: string
  let second: string
  let third: string

  beforeAll(async () => {
    // jestSetup.js freezes Date.now for screen tests; a real Askar store needs the real clock.
    jest.spyOn(Date, 'now').mockRestore()
    agent = new Agent({
      config: { label: 'continuity-crypto-test' },
      dependencies: agentDependencies,
      modules: {
        askar: new AskarModule({
          askar,
          store: {
            id: `continuity-${process.pid}-${Math.random().toString(36).slice(2)}`,
            key: 'test-key',
            database: { type: 'sqlite', config: { inMemory: true } },
          },
        }),
      },
    })
    await agent.initialize()
    first = await relationshipDid(agent)
    second = await relationshipDid(agent)
    third = await relationshipDid(agent)
  }, 60000)

  afterAll(async () => {
    await agent?.shutdown()
  })

  test('a challenge sealed to one relationship DID opens with its key, and says which', async () => {
    const { challenge, sealed } = await sealChallenge(agent, second)
    const opened = await openChallenge(agent, sealed, [first, second, third])
    expect(opened).toEqual({ challenge, openedWith: second })
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  test('without that DID among the keys offered, it does not open', async () => {
    const { sealed } = await sealChallenge(agent, second)
    expect(await openChallenge(agent, sealed, [first, third])).toBeUndefined()
    expect(await openChallenge(agent, sealed, [])).toBeUndefined()
  })

  test('a DID this agent did not create is skipped, not an error', async () => {
    const { sealed } = await sealChallenge(agent, first)
    const notOurs = 'did:peer:0z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
    expect(await openChallenge(agent, sealed, [notOurs, first])).toEqual(expect.objectContaining({ openedWith: first }))
  })

  test('every seal is fresh: the same DID twice gives two challenges and two boxes', async () => {
    const a = await sealChallenge(agent, first)
    const b = await sealChallenge(agent, first)
    expect(a.challenge).not.toBe(b.challenge)
    expect(a.sealed).not.toBe(b.sealed)
  })

  test('challenges compare equal only when they are', () => {
    expect(sameChallenge('abcDEF_-', 'abcDEF_-')).toBe(true)
    expect(sameChallenge('abcDEF_-', 'abcDEF_x')).toBe(false)
    expect(sameChallenge('abc', 'abcd')).toBe(false)
  })
})
