/**
 * The demo state's did:webs host, checked LIVE over the network: the check to run after every publish to the host
 * (keyring-wallet docs/plans/demo-state-hosting-plan.md §3.3). Skipped unless DEMO_STATE_HOST is set, so CI and every
 * ordinary run never touch the network.
 *
 *   cd packages/core && DEMO_STATE_HOST=<host[:port]> yarn jest websLiveHost
 *
 * DEMO_STATE_AIDS (comma-separated) names the AIDs to check; by default the K0 kit's three, the state root, the org unit
 * and the issuing agent, which a demo host serves under one path (guardianEvidence `intermediateDid`).
 * DEMO_STATE_PATH names that path, its labels separated by `/` or `:`; by default `keyring-demo-state`. A host that
 * serves the state below a prefix (a storage bucket: `<bucket>/keyring-demo-state`) sets it, and the DIDs checked are
 * then `did:webs:<host>:<bucket>:keyring-demo-state:<AID>`.
 *
 * DEMO_STATE_CARDS (comma-separated pickup ids, 22 base64url characters each) names Guardian cards to check as well. A
 * card's three files sit at `cards/<pickupId>.json`, `.status.json` and `.html`, beside the state path, not inside it:
 * `https://<host>/cards/…`, or `https://<host>/<bucket>/cards/…` below a prefix. Test names show only the first 6
 * characters of an id, as the publish script's log does: an id is private by URL.
 *
 * Three parts, kept apart on purpose:
 * - "the phone accepts it": each AID resolves through the app's own resolver (resolveWebs), so a host that passes is one
 *   the phones accept; any refusal fails with the resolver's own reason.
 * - "the plan's headers": the host's own rules, which the resolver does not check: no redirect, `Cache-Control:
 *   no-store` (live revocation needs it) and the content types. A temporary tunnel served by a plain static server
 *   passes the first part and fails this one, as it should.
 * - "the cards": the same headers for each card file, plus the shape the plan gives them: the card within the phone's
 *   size cap and tagged with its type, the status one of issued or revoked, the page static and not indexed. Whether
 *   the card's evidence verifies is the card fetch's own check, not this one.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import { GUARDIAN_EVIDENCE_MAX_BYTES } from '../../trust-tasks/approverRoleSpec'
import { setStateVerifiedApproversEnabled } from '../../trust-tasks/module/stateVerifiedApproversFlag'
import { resolveWebs, type WebsFetch, type WebsResponse } from '../webs'

const HOST = process.env.DEMO_STATE_HOST?.trim() ?? ''
const PATH = (process.env.DEMO_STATE_PATH ?? 'keyring-demo-state').split(/[/:]/).filter(Boolean)

const prov = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'k0-utah-v2', 'PROVENANCE.json'), 'utf8')) as {
  aids: Record<string, string>
}
const K0_SERVED = ['roy', 'deb', 'sue'].map((who) => prov.aids[who])
const AIDS = (process.env.DEMO_STATE_AIDS ?? K0_SERVED.join(','))
  .split(',')
  .map((a) => a.trim())
  .filter(Boolean)

const CARDS = (process.env.DEMO_STATE_CARDS ?? '')
  .split(',')
  .map((c) => c.trim())
  .filter(Boolean)

const didFor = (aid: string) => ['did:webs', HOST.replace(':', '%3A'), ...PATH, aid].join(':')
const urlFor = (aid: string, name: 'did.json' | 'keri.cesr') => ['https://' + HOST, ...PATH, aid, name].join('/')
const CARD_FILES = { json: 'application/json', 'status.json': 'application/json', html: 'text/html' } as const
type CardFile = keyof typeof CARD_FILES
const cardUrlFor = (id: string, file: CardFile) =>
  ['https://' + HOST, ...PATH.slice(0, -1), 'cards', `${id}.${file}`].join('/')
const shortId = (id: string) => id.slice(0, 6) + '…'

/** Node's own fetch, in the shape the resolver takes. Never a mock: this check exists to touch the real host. */
const liveFetch: WebsFetch = (url, init) => fetch(url, init) as unknown as Promise<WebsResponse>

/** The headers every published file must carry, read without following a redirect. */
async function served(url: string) {
  const res = await fetch(url, { redirect: 'manual' })
  const body = new Uint8Array(await res.arrayBuffer())
  return {
    seen: {
      status: res.status,
      location: res.headers.get('location'),
      noStore: /(^|,)\s*no-store\s*(,|$)/i.test(res.headers.get('cache-control') ?? ''),
      type: (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase(),
    },
    body,
  }
}

const live = HOST ? describe : describe.skip

live(`the demo state's host, live (${HOST || 'DEMO_STATE_HOST not set'})`, () => {
  beforeEach(() => setStateVerifiedApproversEnabled(true))
  afterEach(() => setStateVerifiedApproversEnabled(false))

  describe('the phone accepts it', () => {
    it.each(AIDS)(
      '%s resolves through the app resolver',
      async (aid) => {
        const r = await resolveWebs(didFor(aid), { fetch: liveFetch })
        // The whole result on failure, so the resolver's reason and detail show in the report.
        expect(r.ok ? { ok: true, aid: r.aid } : r).toEqual({ ok: true, aid })
      },
      30_000
    )
  })

  describe("the plan's headers", () => {
    const cases = AIDS.flatMap((aid) => [
      [aid, 'did.json', 'application/json'],
      [aid, 'keri.cesr', 'application/cesr'],
    ]) as [string, 'did.json' | 'keri.cesr', string][]

    it.each(cases)(
      '%s/%s: 200, no redirect, no-store, %s',
      async (aid, name, type) => {
        const { seen } = await served(urlFor(aid, name))
        expect(seen).toEqual({ status: 200, location: null, noStore: true, type })
      },
      30_000
    )
  })

  const cards = CARDS.length ? describe : describe.skip
  cards('the cards', () => {
    const cases = CARDS.flatMap((id) => (Object.keys(CARD_FILES) as CardFile[]).map((file) => [shortId(id), file, id]))

    it.each(cases)(
      '%s.%s: 200, no redirect, no-store, its type, its shape',
      async (_short, file, id) => {
        expect(/^[A-Za-z0-9_-]{22}$/.test(id) ? 'a pickup id' : 'not a pickup id').toBe('a pickup id')
        const { seen, body } = await served(cardUrlFor(id, file as CardFile))
        expect(seen).toEqual({ status: 200, location: null, noStore: true, type: CARD_FILES[file as CardFile] })

        const text = new TextDecoder().decode(body)
        if (file === 'json') {
          // The whole file within the phone's cap: the evidence it carries is then within it too.
          expect(body.length).toBeLessThanOrEqual(GUARDIAN_EVIDENCE_MAX_BYTES)
          expect((JSON.parse(text) as { type?: unknown }).type).toBe('keyring.sedi.guardian-card/0.1')
        } else if (file === 'status.json') {
          expect(['issued', 'revoked']).toContain((JSON.parse(text) as { status?: unknown }).status)
        } else {
          expect({
            noindex: /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(text),
            script: /<script\b/i.test(text),
          }).toEqual({ noindex: true, script: false })
        }
      },
      30_000
    )
  })
})
