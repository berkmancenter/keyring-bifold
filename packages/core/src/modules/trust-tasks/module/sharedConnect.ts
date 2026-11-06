/**
 * sharedConnect — reading a shared-connect code (two people connecting from
 * one QR code or link, dtgwg-vti-spec#86) up to the point where the person
 * decides: who is asking, how they are reached, and until when. Nothing is
 * sent and nothing is stored here; the exchange itself starts on Connect.
 *
 * Plan: keyring-wallet `docs/plans/relationship-over-tsp-plan.md` (#853),
 * WP1 (the reader) and WP2 (resolution and service choice).
 *
 * Behind a developer switch, off by default: with it off the scanner reads
 * trigger links exactly as before, and a shared-connect code is answered
 * "This code needs a newer version of the app."
 *
 * Nothing from the link is logged: not the text, not `_label`, not the DID.
 * A caller logs only the outcome code (`reason`).
 *
 * @module trust-tasks/module/sharedConnect
 */

import { didToNumAlgo2DidDocument, didToNumAlgo4DidDocument } from '@credo-ts/core'

import {
  hostMeetsRules,
  KEYRING_TRIGGER_CONFIG,
  readTrigger,
  selectService,
  SHARED_CONNECT_SELECTION,
  SHARED_CONNECT_TRIGGER_FLOW,
  triggerAction,
  type SelectionDocument,
  type TriggerChannel,
  type TriggerConfig,
  type TriggerUi,
} from './triggerLink'

let enabled = false

/** Whether the scanner reads shared-connect codes. Off unless the developer switch turns it on. */
export const sharedConnectEnabled = (): boolean => enabled

/** Set from the app's developer screen and at start-up, as the TSP carriage switch is. */
export function setSharedConnectEnabled(on: boolean): void {
  enabled = on
}

/** The shipping reader plus the shared-connect flow. */
export const SHARED_CONNECT_TRIGGER_CONFIG: TriggerConfig = {
  ...KEYRING_TRIGGER_CONFIG,
  flows: [...(KEYRING_TRIGGER_CONFIG.flows ?? []), SHARED_CONNECT_TRIGGER_FLOW],
}

/**
 * The config the scanner reads trigger links with: the shipping one, or with
 * the switch on, that plus shared-connect. With the switch on a sign-in code
 * whose contact is a did:peer is refused as "can't be used" rather than
 * "needs a newer version", since this reader now reads did:peer syntax.
 */
export const activeTriggerConfig = (): TriggerConfig =>
  sharedConnectEnabled() ? SHARED_CONNECT_TRIGGER_CONFIG : KEYRING_TRIGGER_CONFIG

/** What the confirm screen shows, read offline from the code and the inviter's own DID. */
export type SharedConnectOffer = {
  /** The inviter's did:peer, from `_from`. Shown only as a short prefix. */
  from: string
  /** `_id`: the enactment every document of the exchange carries. */
  enactment: string
  /** `_exp`, in seconds since the epoch. */
  exp: number
  /** `_label`, never verified, or undefined when the code gives none (or one that is not shown). */
  label?: string
  /** How the inviter is reached, from their DID document: TSP first, then DIDComm. */
  binding: 'tsp' | 'didcomm'
  /** The service endpoint: a relay's DID or an https URL. */
  endpoint: string
  /** The relay's host, when it can be told offline; undefined for a relay named only by a did:peer. */
  relayHost?: string
}

export type SharedConnectRead =
  | { outcome: 'offer'; offer: SharedConnectOffer }
  /** A readable code of another flow, not a trigger link, or the switch is off: the scanner's other handlers take it. */
  | { outcome: 'not-shared-connect' }
  /** A trigger link that cannot be used: why (a code, safe to log), and the words to show. */
  | { outcome: 'refuse'; reason: string; ui: Exclude<TriggerUi, 'pass-on'> }

/**
 * The inviter's DID document, read from the DID itself. A did:peer:2 is its
 * document; a long-form did:peer:4 carries it with its hash, which Credo
 * checks. Throws on anything else or on a document that does not decode.
 */
export function contactDocument(did: string): SelectionDocument {
  let document
  if (did.startsWith('did:peer:2')) document = didToNumAlgo2DidDocument(did)
  else if (did.startsWith('did:peer:4')) document = didToNumAlgo4DidDocument(did)
  else throw new Error('not a did:peer:2 or long-form did:peer:4')
  const services = (document.service ?? []).map((s) => ({
    id: s.id,
    type: s.type,
    serviceEndpoint: (s as unknown as { serviceEndpoint: unknown }).serviceEndpoint,
  }))
  // Self-certifying: what resolves from the identifier is the document.
  return { verified: true, services }
}

/**
 * The host a relay endpoint names, read without the network: an https URL's
 * host, or the domain of a did:web / did:webvh. Undefined for anything else
 * (a did:peer relay has no host), and for a host that fails the host rules.
 */
export function relayHostOf(endpoint: string): string | undefined {
  let host: string | undefined
  if (/^https:\/\//i.test(endpoint)) {
    try {
      host = new URL(endpoint).hostname
    } catch {
      return undefined
    }
  } else {
    const parts = endpoint.split(':')
    if (parts[0] !== 'did') return undefined
    if (parts[1] === 'web') host = parts[2]
    else if (parts[1] === 'webvh') host = parts[3]
    host = host?.toLowerCase()
  }
  return host && hostMeetsRules(host) ? host : undefined
}

const refuse = (reason: string, ui: Exclude<TriggerUi, 'pass-on'>): SharedConnectRead => ({
  outcome: 'refuse',
  reason,
  ui,
})

/**
 * Read a code as a shared-connect: the link (WP1), then the inviter's own
 * document and the service to reach them by (WP2). Offline and pure.
 */
export function readSharedConnect(
  text: string,
  options: { channel?: TriggerChannel; now?: number } = {}
): SharedConnectRead {
  if (!sharedConnectEnabled()) return { outcome: 'not-shared-connect' }
  const result = readTrigger(text, { ...options, config: SHARED_CONNECT_TRIGGER_CONFIG })
  // A refused link gets the same words whichever flow it named, as the scanner
  // reads every trigger link with this config while the switch is on.
  if (result.outcome === 'reject') {
    return result.ui === 'pass-on' ? { outcome: 'not-shared-connect' } : refuse(result.reason, result.ui)
  }
  const action = triggerAction(result, SHARED_CONNECT_TRIGGER_CONFIG)
  if (action.kind !== 'proceed' || action.flow !== 'shared-connect') return { outcome: 'not-shared-connect' }
  const trigger = action.trigger

  let document: SelectionDocument
  try {
    document = contactDocument(trigger.from)
  } catch {
    return refuse('did-document-unreadable', 'invalid')
  }
  const selected = selectService(document, SHARED_CONNECT_SELECTION)
  if (selected.outcome === 'reject') return refuse(selected.reason, selected.ui)
  if (selected.outcome === 'no-common-transport') return refuse('no-common-transport', 'unreachable')

  const relayHost = relayHostOf(selected.endpoint)
  return {
    outcome: 'offer',
    offer: {
      from: trigger.from,
      enactment: trigger.id,
      // expRequired: the reader refuses a shared-connect code without one.
      exp: trigger.exp as number,
      ...(trigger.label ? { label: trigger.label.text } : {}),
      binding: selected.binding as 'tsp' | 'didcomm',
      endpoint: selected.endpoint,
      ...(relayHost ? { relayHost } : {}),
    },
  }
}

/** The inviter's DID as a person sees it: the method and the first characters after it. */
export function didPrefix(did: string, length = 12): string {
  const m = /^(did:[a-z0-9]+:)(.*)$/.exec(did)
  if (!m) return did.slice(0, length)
  return m[2].length > length ? `${m[1]}${m[2].slice(0, length)}…` : did
}
