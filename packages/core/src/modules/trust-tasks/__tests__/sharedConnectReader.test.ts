/**
 * @jest-environment node
 *
 * Reading a shared-connect code up to the confirm screen (keyring-wallet #853,
 * WP1 the reader, WP2 resolution and service choice, WP12 logging), against
 * codes made from the specifications by `fixtures/shared-connect`, not by
 * Keyring or Credo. Credo resolves the did:peer for real (no mocks), which is
 * WP2's risk: whether `TSPTransport` survives its expansion.
 */
import {
  challenge,
  didcommService,
  peer2,
  peer4,
  RELAY,
  sharedConnectLink,
  tspService,
} from './fixtures/shared-connect/sharedConnectLinks'
import {
  activeTriggerConfig,
  contactDocument,
  didPrefix,
  readSharedConnect,
  relayHostOf,
  setSharedConnectEnabled,
  SHARED_CONNECT_TRIGGER_CONFIG,
} from '../module/sharedConnect'
import {
  KEYRING_SELECTION,
  KEYRING_TRIGGER_CONFIG,
  readTrigger,
  selectService,
  SHARED_CONNECT_SELECTION,
  TRIGGER_UI_MESSAGES,
  type TriggerAccept,
} from '../module/triggerLink'
import { KeyringLinkError, linkForLog, routeKeyringAgentLink } from '../module/vtiLinks'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const NOW = 1_794_000_000
const DAY = 24 * 60 * 60

const read = (text: string, now = NOW) => readTrigger(text, { now, config: SHARED_CONNECT_TRIGGER_CONFIG })
const reason = (text: string, now = NOW) => {
  const result = read(text, now)
  return result.outcome === 'reject' ? result.reason : 'accept'
}

afterEach(() => setSharedConnectEnabled(false))

describe('WP1: the switch', () => {
  it('is off by default: the scanner reads with the shipping config and a shared-connect code is "update", as before', () => {
    expect(activeTriggerConfig()).toBe(KEYRING_TRIGGER_CONFIG)
    const link = sharedConnectLink({ from: peer2([tspService()]), now: NOW })
    expect(readSharedConnect(link, { now: NOW })).toEqual({ outcome: 'not-shared-connect' })
    // The shipping reader still has no did:peer syntax: unsupported-vid, "needs a newer version".
    expect(readTrigger(link, { now: NOW })).toEqual({ outcome: 'reject', reason: 'unsupported-vid', ui: 'update' })
    expect(KEYRING_TRIGGER_CONFIG.flows?.map((f) => f.flow)).toEqual(['sign-in', 'vta-claim'])
  })

  it('on, the scanner reads with the shipping flows plus shared-connect', () => {
    setSharedConnectEnabled(true)
    expect(activeTriggerConfig()).toBe(SHARED_CONNECT_TRIGGER_CONFIG)
    expect(SHARED_CONNECT_TRIGGER_CONFIG.flows?.map((f) => f.flow)).toEqual(['sign-in', 'vta-claim', 'shared-connect'])
  })
})

describe('WP1: the link', () => {
  it('accepts a did:peer:2 contact and a long-form did:peer:4', () => {
    for (const from of [peer2([tspService()]), peer4([tspService()])]) {
      const id = challenge()
      expect(read(sharedConnectLink({ from, id, now: NOW }))).toEqual({
        outcome: 'accept',
        via: 'url',
        from,
        id,
        exp: NOW + 600,
        flow: 'shared-connect',
        task: { uri: 'https://link.trustoverip.org/vti/flow/shared-connect/0.1', major: 0, minor: 1 },
        ignored: [],
      })
    }
  })

  it('refuses a did:peer that carries no document to read offline: numalgo 0, 1, 3, short-form 4', () => {
    for (const from of [
      'did:peer:0z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
      'did:peer:1zQmZMygzYqNwU6Uhmewx5Xepf2VLp5S4HLSwwgf2aiKZuwa',
      'did:peer:3zQmS19jtYDvGtKVrJhQnRFpBQAx3pJ9omx2HpNrcXFuRCz9',
      'did:peer:4zQmd8CpeFPci817KDsbSAKWcXAE2mjvCQSasRewvbSF54Bd',
    ]) {
      expect(reason(sharedConnectLink({ from, now: NOW }))).toBe('bad-from')
    }
  })

  it('refuses a did:web contact for this flow', () => {
    expect(reason(sharedConnectLink({ from: 'did:web:alice.example.org', now: NOW }))).toBe('from-not-allowed')
  })

  it("keeps the flow's 1,000-character budget under the reader's 1,536 cap", () => {
    // Long-form did:peer:4 with both services runs 1,033 to 1,216 characters (the R1 measurements).
    const both = sharedConnectLink({ from: peer4([tspService(), didcommService()]), now: NOW })
    expect([...both].length).toBeGreaterThan(1000)
    expect([...both].length).toBeLessThanOrEqual(1536)
    expect(read(both)).toEqual({ outcome: 'reject', reason: 'over-flow-budget', ui: 'invalid' })
    // The same budget does not apply to sign-in: the shipping flows keep the reader's cap only.
    expect(KEYRING_TRIGGER_CONFIG.flows?.every((f) => f.maxLength === undefined)).toBe(true)
  })

  it('needs an expiry, refuses an expired code, and one more than 7 days ahead', () => {
    const from = peer2([tspService()])
    expect(reason(sharedConnectLink({ from, now: NOW, exp: null }))).toBe('missing-exp')
    expect(reason(sharedConnectLink({ from, now: NOW, exp: NOW - 61 }))).toBe('expired')
    expect(reason(sharedConnectLink({ from, now: NOW, exp: NOW + 7 * DAY }))).toBe('accept')
    expect(reason(sharedConnectLink({ from, now: NOW, exp: NOW + 7 * DAY + 61 }))).toBe('exp-too-far')
    expect(read(sharedConnectLink({ from, now: NOW, exp: NOW + 8 * DAY }))).toMatchObject({ ui: 'invalid' })
  })

  it('answers another version of the flow "update"', () => {
    const link = sharedConnectLink({ from: peer2([tspService()]), now: NOW, type: '/vti/flow/shared-connect/0.2' })
    expect(read(link)).toEqual({ outcome: 'reject', reason: 'unsupported-version', ui: 'update' })
  })

  it('with the switch on, a sign-in whose contact is a did:peer reads "can\'t be used" instead of "update"', () => {
    const signIn = sharedConnectLink({ from: peer2([tspService()]), now: NOW, type: '/vti/flow/sign-in/0.1' })
    expect(readTrigger(signIn, { now: NOW })).toMatchObject({ reason: 'unsupported-vid', ui: 'update' })
    expect(read(signIn)).toMatchObject({ reason: 'from-not-allowed', ui: 'invalid' })
  })
})

describe('WP1: `_label`, shown unverified or not at all', () => {
  const from = peer2([tspService()])
  const labelOf = (link: string) => (read(link) as TriggerAccept).label

  it('reads it as unverified text and no longer lists it as ignored', () => {
    const result = read(sharedConnectLink({ from, now: NOW, label: 'Ana at the Thursday meetup' })) as TriggerAccept
    expect(result.label).toEqual({ text: 'Ana at the Thursday meetup', verified: false })
    expect(result.ignored).toEqual([])
  })

  it('keeps letters from any script, and emoji', () => {
    for (const text of ['José Núñez', 'Мария', '李雷', '👩🏽‍💻 Dev']) {
      expect(labelOf(sharedConnectLink({ from, now: NOW, label: text }))).toEqual({ text, verified: false })
    }
  })

  it('shows none when it is missing, empty, repeated, or over 64 characters', () => {
    expect(labelOf(sharedConnectLink({ from, now: NOW }))).toBeUndefined()
    expect(labelOf(sharedConnectLink({ from, now: NOW, label: '   ' }))).toBeUndefined()
    expect(labelOf(sharedConnectLink({ from, now: NOW, labels: ['Ana', 'Bank'] }))).toBeUndefined()
    expect(labelOf(sharedConnectLink({ from, now: NOW, label: 'a'.repeat(64) }))).toEqual({
      text: 'a'.repeat(64),
      verified: false,
    })
    expect(labelOf(sharedConnectLink({ from, now: NOW, label: 'a'.repeat(65) }))).toBeUndefined()
  })

  it('shows none that carries a control character, a line break or a direction override', () => {
    for (const text of ['Ana\nYour bank', 'Ana\u0007', 'Ana‮knab', 'Ana⁦x', 'Ana‏x', 'Ana x']) {
      expect(labelOf(sharedConnectLink({ from, now: NOW, label: text }))).toBeUndefined()
    }
  })

  it('is not read by sign-in: there it stays an ignored name', () => {
    const signIn = `https://link.trustoverip.org/t#_from=did:web:example.org&_id=${challenge()}&_exp=${NOW + 60}&_type=/vti/flow/sign-in/0.1&_label=Bank`
    const result = read(signIn) as TriggerAccept
    expect(result.label).toBeUndefined()
    expect(result.ignored).toEqual(['fragment._label'])
  })
})

describe('WP2: the inviter document, resolved by Credo offline, and the service chosen', () => {
  it.each([
    ['a string', RELAY],
    ['{uri}', { uri: RELAY }],
    ['[{uri}]', [{ uri: RELAY }]],
    ['[string]', [RELAY]],
  ])('TSPTransport survives did:peer:2 and did:peer:4 expansion with %s, and TSP is chosen', (_, endpoint) => {
    for (const from of [peer2([tspService(endpoint)]), peer4([tspService(endpoint)])]) {
      const document = contactDocument(from)
      expect(document.services?.map((s) => s.type)).toEqual(['TSPTransport'])
      expect(selectService(document, SHARED_CONNECT_SELECTION)).toEqual({
        outcome: 'select',
        binding: 'tsp',
        endpoint: RELAY,
        source: 'did-document',
        sent: false,
      })
    }
  })

  it('prefers TSP to DIDComm in either order, and takes DIDComm when it is the only one', () => {
    for (const services of [
      [tspService(), didcommService()],
      [didcommService(), tspService()],
    ]) {
      expect(selectService(contactDocument(peer2(services)), SHARED_CONNECT_SELECTION)).toMatchObject({
        binding: 'tsp',
        endpoint: RELAY,
      })
    }
    expect(selectService(contactDocument(peer2([didcommService()])), SHARED_CONNECT_SELECTION)).toMatchObject({
      binding: 'didcomm',
      endpoint: 'https://relay.example.org/didcomm',
    })
  })

  it('takes the first usable entry of an array endpoint, skipping one that fails the endpoint rules', () => {
    const from = peer2([
      tspService([{ uri: 'http://relay.example.org' }, { uri: 'https://relay.example.org:8443' }, RELAY]),
    ])
    expect(selectService(contactDocument(from), SHARED_CONNECT_SELECTION)).toMatchObject({ endpoint: RELAY })
  })

  it('leaves sign-in as it was: an array endpoint is not read there', () => {
    const document = {
      verified: true,
      services: [{ type: 'TrustTaskHTTPS', serviceEndpoint: ['https://community.example.org/tt'] }],
    }
    expect(selectService(document, KEYRING_SELECTION)).toMatchObject({ outcome: 'no-common-transport' })
  })

  it('tells the relay host offline, or none', () => {
    expect(relayHostOf('did:web:relay.example.org')).toBe('relay.example.org')
    expect(relayHostOf('did:web:relay.example.org:tsp')).toBe('relay.example.org')
    expect(relayHostOf('did:webvh:QmScid:Relay.Example.org:tsp')).toBe('relay.example.org')
    expect(relayHostOf('https://relay.example.org/tsp')).toBe('relay.example.org')
    expect(relayHostOf(peer2([]))).toBeUndefined()
    expect(relayHostOf('did:web:localhost')).toBeUndefined()
    expect(relayHostOf('did:web:192.168.1.4')).toBeUndefined()
  })

  it('refuses a did:peer:4 whose hash does not match its document', () => {
    const from = peer4([tspService()])
    const [, hash, encoded] = /^did:peer:4(z[^:]+):(z.+)$/.exec(from) as RegExpExecArray
    const tampered = peer4([tspService('did:web:evil.example.org')])
      .split(':')
      .pop() as string
    expect(() => contactDocument(`did:peer:4${hash}:${tampered}`)).toThrow()
    expect(() => contactDocument(`did:peer:4${hash}:${encoded}`)).not.toThrow()
  })
})

describe('WP1 + WP2: readSharedConnect, what the confirm screen gets', () => {
  beforeEach(() => setSharedConnectEnabled(true))

  it('an offer: who, until when, how reached, and the label unverified', () => {
    const from = peer2([tspService(), didcommService()])
    const id = challenge()
    expect(readSharedConnect(sharedConnectLink({ from, id, now: NOW, label: 'Ana' }), { now: NOW })).toEqual({
      outcome: 'offer',
      offer: {
        from,
        enactment: id,
        exp: NOW + 600,
        label: 'Ana',
        binding: 'tsp',
        endpoint: RELAY,
        relayHost: 'relay.example.org',
      },
    })
  })

  it('no common transport: "can\'t be reached"', () => {
    const from = peer2([{ type: 'LinkedDomains', serviceEndpoint: 'https://example.org' }])
    expect(readSharedConnect(sharedConnectLink({ from, now: NOW }), { now: NOW })).toEqual({
      outcome: 'refuse',
      reason: 'no-common-transport',
      ui: 'unreachable',
    })
  })

  it('a reader refusal keeps its words, and a code of another flow is left to the other handlers', () => {
    expect(
      readSharedConnect(sharedConnectLink({ from: peer2([tspService()]), now: NOW, exp: NOW - 120 }), { now: NOW })
    ).toEqual({ outcome: 'refuse', reason: 'expired', ui: 'expired' })
    const signIn = `https://link.trustoverip.org/t#_from=did:web:example.org&_id=${challenge()}&_exp=${NOW + 60}&_type=/vti/flow/sign-in/0.1`
    expect(readSharedConnect(signIn, { now: NOW })).toEqual({ outcome: 'not-shared-connect' })
    expect(readSharedConnect('https://example.org/nothing-here', { now: NOW })).toEqual({
      outcome: 'not-shared-connect',
    })
  })

  it('shows the inviter as a short prefix', () => {
    expect(didPrefix('did:peer:2.Ez6LSabcdefghijklmnop.Vz6Mk')).toBe('did:peer:2.Ez6LSabcde…')
    expect(didPrefix('did:web:a.org')).toBe('did:web:a.org')
  })
})

describe('the scanner, with the switch off and on (no confirm screen yet: WP3)', () => {
  const now = () => Math.floor(Date.now() / 1000)
  const navigate = jest.fn()
  const words = async (link: string) => {
    try {
      await routeKeyringAgentLink(link, {} as never, navigate)
      return 'navigated'
    } catch (e) {
      return e instanceof KeyringLinkError ? e.message : String(e)
    }
  }

  it('off: every shared-connect code is "update", whatever is wrong with it', async () => {
    const from = peer2([tspService()])
    expect(await words(sharedConnectLink({ from, now: now() }))).toBe(TRIGGER_UI_MESSAGES.update)
    expect(await words(sharedConnectLink({ from, now: now(), exp: now() - 600 }))).toBe(TRIGGER_UI_MESSAGES.update)
  })

  it('on, a code it reads is still "update": there is no confirm screen yet (WP3 sends it there)', async () => {
    setSharedConnectEnabled(true)
    const link = sharedConnectLink({ from: peer2([tspService()]), now: now() })
    expect(readSharedConnect(link).outcome).toBe('offer')
    expect(await words(link)).toBe(TRIGGER_UI_MESSAGES.update)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('on: a refused code says why', async () => {
    setSharedConnectEnabled(true)
    const from = peer2([tspService()])
    expect(await words(sharedConnectLink({ from, now: now(), exp: now() - 600 }))).toBe(TRIGGER_UI_MESSAGES.expired)
    expect(await words(sharedConnectLink({ from: 'did:web:a.example.org', now: now() }))).toBe(
      TRIGGER_UI_MESSAGES.invalid
    )
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('WP12: nothing the sender wrote reaches the log', () => {
  const SENTINEL = 'Zq-label-sentinel-7781'

  it('a trigger link is logged by kind and length only', () => {
    const from = peer2([tspService()])
    const link = sharedConnectLink({ from, now: NOW, label: SENTINEL })
    const line = linkForLog(` ${link}\n`)
    expect(line).toBe(`trigger link (${[...link].length} chars)`)
    for (const secret of [SENTINEL, from, from.slice(0, 30)]) expect(line).not.toContain(secret)
    // Any other link is logged as before.
    expect(linkForLog('https://example.org/oob?c_i=abc')).toBe('https://example.org/oob?c_i=abc')
  })

  it('reading and routing a shared-connect code writes nothing to the console, and its error carries none of it', async () => {
    setSharedConnectEnabled(true)
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation(() => undefined)
    )
    const now = Math.floor(Date.now() / 1000)
    const from = peer2([tspService()])
    const id = challenge()
    const texts: string[] = []
    for (const link of [
      sharedConnectLink({ from, id, now, label: SENTINEL }),
      sharedConnectLink({ from, id, now, label: SENTINEL, exp: now - 600 }),
      sharedConnectLink({
        from: peer2([{ type: 'LinkedDomains', serviceEndpoint: 'https://x.org' }]),
        id,
        now,
        label: SENTINEL,
      }),
    ]) {
      const result = readSharedConnect(link)
      texts.push(JSON.stringify(result.outcome === 'offer' ? { outcome: result.outcome } : result))
      try {
        await routeKeyringAgentLink(link, {} as never, jest.fn())
      } catch (e) {
        texts.push(String((e as Error).message), JSON.stringify(e))
      }
    }
    for (const spy of spies) {
      texts.push(...spy.mock.calls.map((args) => args.map(String).join(' ')))
      spy.mockRestore()
    }
    const all = texts.join('\n')
    for (const secret of [SENTINEL, id, from.slice(11, 40)]) expect(all).not.toContain(secret)
  })
})
