/**
 * The steps behind the shared-connect confirm screen (plan WP3, WP4, WP10's
 * expiry check, WP12): reading sends nothing; Connect re-checks the expiry,
 * mints the encounter DID on the inviter's mediator and keeps the record.
 */
import type { Agent } from '@credo-ts/core'

import { setSharedConnectEnabled, setSharedConnectLabelEnabled } from '../module/sharedConnectFlag'
import { previewSharedConnect, startSharedConnect } from '../module/sharedConnectStart'
import type { VtiMediatorEndpoints } from '../module/VtiMediatorTransport'

import {
  ENCOUNTER_ID,
  KEYRING_STYLE_DID,
  MEDIATOR_DID,
  NOW,
  REFERENCE_STYLE_DID,
  sharedConnectLink,
} from './fixtures/sharedConnectFixtures'

const SENTINEL = 'LABEL-SENTINEL-do-not-log'
const logger = { debug: jest.fn() }
const TSP_SERVICES = [{ id: '#tsp', type: 'TSPTransport', serviceEndpoint: MEDIATOR_DID }]

const agentWith = (service: unknown[] = TSP_SERVICES) =>
  ({
    dids: { resolveDidDocument: jest.fn(async () => ({ service })) },
    config: { logger },
  }) as unknown as Agent & { dids: { resolveDidDocument: jest.Mock } }

const MEDIATOR = { did: MEDIATOR_DID, wsEndpoint: 'wss://m.example/ws' } as unknown as VtiMediatorEndpoints
const deps = () => ({
  resolveMediator: jest.fn(async () => MEDIATOR),
  createDid: jest.fn(async () => 'did:peer:2.mine'),
  save: jest.fn(async () => undefined),
  find: jest.fn(async () => undefined),
  run: jest.fn(async () => undefined),
})

beforeEach(() => {
  setSharedConnectEnabled(true)
  setSharedConnectLabelEnabled(true)
  logger.debug.mockClear()
})
afterEach(() => {
  setSharedConnectEnabled(false)
  setSharedConnectLabelEnabled(false)
})

describe('previewSharedConnect', () => {
  it('returns what the screen may show, and reaches out to nothing but the local DID resolver', async () => {
    const agent = agentWith()
    const result = await previewSharedConnect(agent, sharedConnectLink({ label: 'Ada' }), { now: NOW })
    expect(result).toEqual({
      kind: 'ready',
      endpoint: MEDIATOR_DID,
      preview: {
        inviterDid: KEYRING_STYLE_DID,
        didShort: `${KEYRING_STYLE_DID.slice(0, 24)}…`,
        label: 'Ada',
        carriage: 'tsp',
        exp: NOW + 600,
        enactment: ENCOUNTER_ID,
      },
    })
    expect(agent.dids.resolveDidDocument).toHaveBeenCalledTimes(1)
  })

  it('carries the relay host of an https endpoint and no label when none was sent', async () => {
    const agent = agentWith([{ type: 'tsp', serviceEndpoint: { uri: 'https://relay.example.org/tsp' } }])
    const result = await previewSharedConnect(agent, sharedConnectLink({ from: REFERENCE_STYLE_DID }), { now: NOW })
    expect(result).toMatchObject({ kind: 'ready', preview: { relayHost: 'relay.example.org' } })
    expect((result as { preview: object }).preview).not.toHaveProperty('label')
  })

  it('is refused, without resolving, for a link the reader refuses', async () => {
    const agent = agentWith()
    await expect(previewSharedConnect(agent, sharedConnectLink({ exp: NOW - 600 }), { now: NOW })).resolves.toEqual({
      kind: 'refused',
      ui: 'expired',
    })
    expect(agent.dids.resolveDidDocument).not.toHaveBeenCalled()
  })

  it('is refused as a link that cannot be used when it is not a shared-connect link at all', async () => {
    const agent = agentWith()
    const signIn = `https://link.trustoverip.org/t#_from=did:web:example.org&_id=${ENCOUNTER_ID}&_exp=${NOW + 60}&_type=/vti/flow/sign-in/0.1`
    const result = await previewSharedConnect(agent, signIn, { now: NOW })
    expect(result).toEqual({ kind: 'refused', ui: 'update' })
  })

  it('is unreachable when the inviter lists no service this build can use', async () => {
    const result = await previewSharedConnect(agentWith([]), sharedConnectLink(), { now: NOW })
    expect(result).toEqual({ kind: 'refused', ui: 'unreachable' })
  })

  it('is invalid when the DID cannot be expanded', async () => {
    const agent = agentWith()
    agent.dids.resolveDidDocument.mockRejectedValueOnce(new Error('bad'))
    expect(await previewSharedConnect(agent, sharedConnectLink(), { now: NOW })).toEqual({
      kind: 'refused',
      ui: 'invalid',
    })
  })
})

describe('a link over the 1,000-character budget', () => {
  // Long-form did:peer:4 with TSP and DIDComm measured 1,033 to 1,216 characters (PR #853).
  const longForm = `did:peer:4zQm${'Q'.repeat(44)}:z${'Q'.repeat(950)}`

  it('is refused cleanly as invalid by the preview, with nothing resolved', async () => {
    const agent = agentWith()
    const link = sharedConnectLink({ from: longForm })
    expect([...link].length).toBeGreaterThan(1000)
    await expect(previewSharedConnect(agent, link, { now: NOW })).resolves.toEqual({ kind: 'refused', ui: 'invalid' })
    expect(agent.dids.resolveDidDocument).not.toHaveBeenCalled()
  })

  it('is refused by Connect too, and nothing is minted or kept', async () => {
    const d = deps()
    await expect(
      startSharedConnect(agentWith(), sharedConnectLink({ from: longForm }), { now: NOW, deps: d })
    ).resolves.toEqual({ kind: 'refused', ui: 'invalid' })
    expect(d.createDid).not.toHaveBeenCalled()
    expect(d.save).not.toHaveBeenCalled()
  })
})

describe('startSharedConnect', () => {
  it('mints an encounter DID on the inviter mediator and keeps the encounter', async () => {
    const d = deps()
    const result = await startSharedConnect(agentWith(), sharedConnectLink(), { now: NOW, deps: d })
    expect(d.resolveMediator).toHaveBeenCalledWith(expect.anything(), MEDIATOR_DID)
    expect(d.createDid).toHaveBeenCalledWith(expect.anything(), MEDIATOR, { tsp: true })
    expect(result).toEqual({
      kind: 'started',
      encounter: {
        enactment: ENCOUNTER_ID,
        myVid: 'did:peer:2.mine',
        theirVid: KEYRING_STYLE_DID,
        carriage: 'tsp',
        relay: MEDIATOR_DID,
        exp: NOW + 600,
        state: 'confirmed',
        createdAt: new Date(NOW * 1000).toISOString(),
      },
    })
    expect(d.save).toHaveBeenCalledWith(expect.anything(), (result as { encounter: object }).encounter)
    expect(d.run).toHaveBeenCalledWith(expect.anything(), (result as { encounter: object }).encounter, MEDIATOR)
  })

  describe('once per code', () => {
    const keptRecord = (state: string) => ({ enactment: ENCOUNTER_ID, state }) as never

    it('joins a second tap or scan that arrives while the first is under way', async () => {
      const d = deps()
      const agent = agentWith()
      const link = sharedConnectLink()
      const [a, b] = await Promise.all([
        startSharedConnect(agent, link, { now: NOW, deps: d }),
        startSharedConnect(agent, link, { now: NOW, deps: d }),
      ])
      expect(a).toEqual(b)
      expect(d.createDid).toHaveBeenCalledTimes(1)
      expect(d.run).toHaveBeenCalledTimes(1)
      expect(d.save).toHaveBeenCalledTimes(1)
    })

    it('starts the same code again after the first call has finished only if nothing is kept for it', async () => {
      const d = deps()
      await startSharedConnect(agentWith(), sharedConnectLink(), { now: NOW, deps: d })
      d.find.mockResolvedValueOnce(keptRecord('proposing'))
      await expect(startSharedConnect(agentWith(), sharedConnectLink(), { now: NOW, deps: d })).resolves.toEqual({
        kind: 'refused',
        ui: 'invalid',
      })
      expect(d.run).toHaveBeenCalledTimes(1)
      expect(d.createDid).toHaveBeenCalledTimes(1)
    })

    it('lets a code try again when the earlier attempt failed before anything was proposed', async () => {
      const d = deps()
      d.run.mockRejectedValueOnce(new Error('relay down'))
      await expect(startSharedConnect(agentWith(), sharedConnectLink(), { now: NOW, deps: d })).resolves.toEqual({
        kind: 'failed',
      })
      expect(d.save).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ state: 'failed' }))
      d.find.mockResolvedValueOnce(keptRecord('failed'))
      await expect(startSharedConnect(agentWith(), sharedConnectLink(), { now: NOW, deps: d })).resolves.toMatchObject({
        kind: 'started',
      })
      expect(d.run).toHaveBeenCalledTimes(2)
    })
  })

  it('reports failed when the relay cannot be reached', async () => {
    const d = deps()
    d.run.mockRejectedValueOnce(new Error('relay down'))
    await expect(startSharedConnect(agentWith(), sharedConnectLink(), { now: NOW, deps: d })).resolves.toEqual({
      kind: 'failed',
    })
  })

  it('mints no TSP service when the carriage is DIDComm', async () => {
    const d = deps()
    await startSharedConnect(
      agentWith([{ type: 'DIDCommMessaging', serviceEndpoint: MEDIATOR_DID }]),
      sharedConnectLink(),
      {
        now: NOW,
        deps: d,
      }
    )
    expect(d.createDid).toHaveBeenCalledWith(expect.anything(), MEDIATOR, { tsp: false })
  })

  it('catches an expiry that passed while the confirm screen was open, and mints nothing', async () => {
    const d = deps()
    const link = sharedConnectLink({ exp: NOW + 600 })
    const result = await startSharedConnect(agentWith(), link, { now: NOW + 700, deps: d })
    expect(result).toEqual({ kind: 'refused', ui: 'expired' })
    expect(d.createDid).not.toHaveBeenCalled()
    expect(d.save).not.toHaveBeenCalled()
  })

  it('has no session to open for an https relay yet: unreachable, nothing minted', async () => {
    const d = deps()
    const agent = agentWith([{ type: 'tsp', serviceEndpoint: { uri: 'https://relay.example.org/tsp' } }])
    const result = await startSharedConnect(agent, sharedConnectLink({ from: REFERENCE_STYLE_DID }), {
      now: NOW,
      deps: d,
    })
    expect(result).toEqual({ kind: 'refused', ui: 'unreachable' })
    expect(d.createDid).not.toHaveBeenCalled()
  })

  it('fails quietly when the mediator cannot be read, logging an error name and a DID prefix only', async () => {
    const d = deps()
    d.resolveMediator.mockRejectedValueOnce(new RangeError(`${SENTINEL} ${MEDIATOR_DID}`))
    const result = await startSharedConnect(agentWith(), sharedConnectLink({ label: SENTINEL }), { now: NOW, deps: d })
    expect(result).toEqual({ kind: 'failed' })
    const logged = JSON.stringify(logger.debug.mock.calls)
    expect(logged).toContain('RangeError')
    expect(logged).not.toContain(SENTINEL)
    expect(logged).not.toContain(KEYRING_STYLE_DID)
  })

  it('never logs the label across a whole successful run', async () => {
    await startSharedConnect(agentWith(), sharedConnectLink({ label: SENTINEL }), { now: NOW, deps: deps() })
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain(SENTINEL)
  })
})
