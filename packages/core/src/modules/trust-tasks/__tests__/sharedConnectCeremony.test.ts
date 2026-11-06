/** The connectionless pieces of the shared-connect document sequence (plan WP7). */
import type { Agent } from '@credo-ts/core'

import {
  acceptableProofSigners,
  buildSharedConnectDocument,
  ceremonyMember,
  encounterMismatch,
  isChallengeShaped,
  newProposeId,
  proofSignerFor,
  signSharedConnectDocument,
} from '../module/sharedConnectCeremony'
import {
  SHARED_CONNECT_FLOW_OWNER,
  SHARED_CONNECT_PROOF_SIGNER,
  SHARED_CONNECT_TSP_REVISION,
  SHARED_CONNECT_VRC_PROFILE,
} from '../module/sharedConnectDecisions'

const mockSign = jest.fn()
jest.mock('../documentProof', () => ({
  ...jest.requireActual('../documentProof'),
  signDocumentProof: (...args: unknown[]) => mockSign(...args),
}))

const ME = 'did:peer:2.mine'
const THEM = 'did:peer:2.theirs'
const ENACTMENT = 'XOcGXOQTCHb5iz4T2JD2RQ'
const PROPOSE_ID = 'A1b2C3d4E5f6G7h8I9j0Kw'

describe('the propose id', () => {
  it('is 22 characters of base64url from 16 random bytes', () => {
    const id = newProposeId(() => new Uint8Array(16).fill(255))
    expect(id).toBe('_____________________w')
    expect(isChallengeShaped(id)).toBe(true)
    expect(isChallengeShaped(PROPOSE_ID)).toBe(true)
  })

  it('refuses anything but 16 bytes', () => {
    expect(() => newProposeId(() => new Uint8Array(8))).toThrow()
  })

  it.each(['', 'short', 'a'.repeat(23), '550e8400-e29b-41d4-a716-446655440000', 42, undefined])(
    'does not take %p for a challenge (a uuid is not one)',
    (value) => expect(isChallengeShaped(value)).toBe(false)
  )
})

describe('a document', () => {
  const doc = buildSharedConnectDocument({
    id: PROPOSE_ID,
    type: 'https://trusttasks.org/spec/vrc/relationships/propose/0.1',
    threadId: PROPOSE_ID,
    issuer: ME,
    recipient: THEM,
    enactment: ENACTMENT,
    step: 1,
    payload: { relationshipDid: 'did:peer:0z6Mk' },
    issuedAt: '2027-01-15T08:00:00Z',
  })

  it('carries the thread, the in-band VIDs and a ceremony member of enactment and step only', () => {
    expect(doc).toEqual({
      id: PROPOSE_ID,
      type: 'https://trusttasks.org/spec/vrc/relationships/propose/0.1',
      threadId: PROPOSE_ID,
      issuer: ME,
      recipient: THEM,
      issuedAt: '2027-01-15T08:00:00Z',
      ceremony: { enactment: ENACTMENT, step: 1 },
      payload: { relationshipDid: 'did:peer:0z6Mk' },
    })
    expect(ceremonyMember(ENACTMENT, 3)).toEqual({ enactment: ENACTMENT, step: 3 })
    expect(Object.keys(doc.ceremony as object)).not.toContain('definition')
  })

  describe('as it arrives', () => {
    const expected = { enactment: ENACTMENT, threadId: PROPOSE_ID, myVid: THEM, theirVid: ME }

    it('belongs to the encounter when enactment, thread and both VIDs match', () => {
      expect(encounterMismatch(doc, expected)).toBeUndefined()
    })

    it('accepts a ceremony that names its definition together with the digest', () => {
      const ceremony = { enactment: ENACTMENT, step: 1, definition: 'x', definitionDigest: 'uEi' }
      expect(encounterMismatch({ ...doc, ceremony }, expected)).toBeUndefined()
    })

    it.each([
      ['a different enactment', { ceremony: { enactment: 'other', step: 1 } }, 'enactment'],
      ['no ceremony member', { ceremony: undefined }, 'enactment'],
      [
        'a ceremony naming a definition without its digest',
        { ceremony: { enactment: ENACTMENT, step: 1, definition: 'x' } },
        'ceremony',
      ],
      [
        'a ceremony with a member the schema does not have',
        { ceremony: { enactment: ENACTMENT, step: 1, extra: 1 } },
        'ceremony',
      ],
      ['a ceremony that is not an object', { ceremony: 'x' }, 'ceremony'],
      ['a ceremony with no step', { ceremony: { enactment: ENACTMENT } }, 'ceremony'],
      ['a different thread', { threadId: 'other' }, 'thread'],
      ['a different recipient', { recipient: 'did:peer:2.else' }, 'recipient'],
      ['a different issuer', { issuer: 'did:peer:2.else' }, 'issuer'],
    ])('does not belong with %s', (_, over, reason) => {
      expect(encounterMismatch({ ...doc, ...over }, expected)).toBe(reason)
    })
  })
})

describe('the proof', () => {
  const doc = { issuer: ME, id: PROPOSE_ID }

  it('is made by the issuer VID by default and either key is accepted inbound', () => {
    expect(SHARED_CONNECT_PROOF_SIGNER).toBe('issuer-vid')
    expect(proofSignerFor(doc, 'did:peer:0zRel')).toBe(ME)
    expect(acceptableProofSigners(doc, 'did:peer:0zRel')).toEqual([ME, 'did:peer:0zRel'])
    expect(acceptableProofSigners(doc)).toEqual([ME])
  })

  it('signs through the document-proof helper with that DID and returns the signed document', async () => {
    mockSign.mockResolvedValueOnce({ ...doc, proof: { type: 'DataIntegrityProof' } })
    const agent = {} as Agent
    await expect(signSharedConnectDocument(agent, doc)).resolves.toEqual({
      ...doc,
      proof: { type: 'DataIntegrityProof' },
    })
    expect(mockSign).toHaveBeenCalledWith(agent, doc, ME)
  })
})

describe('the decisions awaiting Alberto sit at the plan defaults, in one file', () => {
  it('names each default', () => {
    expect(SHARED_CONNECT_TSP_REVISION).toBe('1.0')
    expect(SHARED_CONNECT_FLOW_OWNER).toBe('core')
    expect(SHARED_CONNECT_VRC_PROFILE).toEqual({
      vc20: true,
      dataIntegrity: true,
      suite: 'eddsa-jcs-2022',
      validUntil: false,
      evidence: false,
    })
  })
})
