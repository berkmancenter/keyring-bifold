/**
 * Shared-connect codes for the reader's tests, made the way an inviter would
 * make them, from the specifications and NOT from Keyring's or Credo's code,
 * so that where the reader and the spec disagree the tests fail:
 *
 * - did:peer:2 and long-form did:peer:4: the DIF Peer DID method spec
 *   (purpose codes E and V, one S per service with the `t`/`s`/`r`/`a`
 *   abbreviations and `dm` for DIDCommMessaging; numalgo 4 = multihash of the
 *   encoded document, then the document as multicodec JSON, base58btc);
 * - the link: dtgwg-vti-spec#86 as revised 2026-11-05 (`_from`, a 16-byte
 *   `_id`, `_exp`, `_type=/vti/flow/shared-connect/0.1`, optional `_label`).
 *
 * Kept from the in-process rungs (bifold test/shared-connect-rungs, 697bf8bad),
 * which ran Keyring's code against an inviter built the same way.
 */
import { ed25519, x25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'

export const FLOW_TYPE = '/vti/flow/shared-connect/0.1'
export const LINK_BASE = 'https://link.trustoverip.org/t'
/** A relay, named by its DID, as the VTA and Keyring write a TSPTransport endpoint. */
export const RELAY = 'did:web:relay.example.org'

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
export function base58(bytes: Uint8Array): string {
  let n = 0n
  for (const b of bytes) n = n * 256n + BigInt(b)
  let out = ''
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out
    n /= 58n
  }
  for (const b of bytes) {
    if (b !== 0) break
    out = '1' + out
  }
  return out
}

const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url')
const utf8 = (s: string) => new TextEncoder().encode(s)
const random = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n))
const ED25519_PUB = [0xed, 0x01]
const X25519_PUB = [0xec, 0x01]
const multikey = (prefix: number[], key: Uint8Array) => 'z' + base58(Uint8Array.from([...prefix, ...key]))

function keys() {
  return {
    ed: ed25519.getPublicKey(random(32)),
    x: x25519.getPublicKey(random(32)),
  }
}

export type Service = Record<string, unknown>

/** A TSPTransport service naming the relay, in one of the endpoint forms DID Core allows. */
export const tspService = (endpoint: unknown = RELAY): Service => ({ type: 'TSPTransport', serviceEndpoint: endpoint })
export const didcommService = (uri = 'https://relay.example.org/didcomm'): Service => ({
  type: 'DIDCommMessaging',
  serviceEndpoint: { uri, accept: ['didcomm/v2'] },
})

/** did:peer:2: E (X25519), V (Ed25519), then one S per service, abbreviated per the spec. */
export function peer2(services: Service[]): string {
  const k = keys()
  const abbreviate = (s: Service) => {
    const long: Record<string, string> = { type: 't', serviceEndpoint: 's', routingKeys: 'r', accept: 'a' }
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(s)) {
      out[long[key] ?? key] = key === 'type' && value === 'DIDCommMessaging' ? 'dm' : value
    }
    return out
  }
  return [
    'did:peer:2',
    'E' + multikey(X25519_PUB, k.x),
    'V' + multikey(ED25519_PUB, k.ed),
    ...services.map((s) => 'S' + b64u(utf8(JSON.stringify(abbreviate(s))))),
  ].join('.')
}

/** Long-form did:peer:4: the multihash of the encoded document, then the document. */
export function peer4(services: Service[]): string {
  const k = keys()
  const doc = {
    '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/multikey/v1'],
    verificationMethod: [
      { id: '#key-1', type: 'Multikey', publicKeyMultibase: multikey(ED25519_PUB, k.ed) },
      { id: '#key-2', type: 'Multikey', publicKeyMultibase: multikey(X25519_PUB, k.x) },
    ],
    authentication: ['#key-1'],
    assertionMethod: ['#key-1'],
    keyAgreement: ['#key-2'],
    service: services.map((s, i) => ({ id: `#service-${i}`, ...s })),
  }
  const encoded = 'z' + base58(Uint8Array.from([0x80, 0x04, ...utf8(JSON.stringify(doc))]))
  const hash = 'z' + base58(Uint8Array.from([0x12, 0x20, ...sha256(utf8(encoded))]))
  return `did:peer:4${hash}:${encoded}`
}

/** A 16-byte challenge, canonical unpadded base64url (22 characters). */
export const challenge = (): string => b64u(random(16))

/** A shared-connect link, its parts in the order #86 writes them. */
export function sharedConnectLink(options: {
  from: string
  now: number
  ttlSeconds?: number
  id?: string
  exp?: number | null
  type?: string
  /** The raw label, percent-encoded here. Pass `labels` for more than one. */
  label?: string
  labels?: string[]
}): string {
  const exp = options.exp === undefined ? options.now + (options.ttlSeconds ?? 600) : options.exp
  let link = `${LINK_BASE}#_from=${options.from}&_id=${options.id ?? challenge()}`
  if (exp !== null) link += `&_exp=${exp}`
  link += `&_type=${options.type ?? FLOW_TYPE}`
  for (const label of options.labels ?? (options.label === undefined ? [] : [options.label])) {
    link += `&_label=${encodeURIComponent(label)}`
  }
  return link
}
