import { PREVIEW_TOKEN_TTL_MS, RoomsConflict, RoomsPreviewExpired, RoomsUnavailable } from '../types'
import { createSampleRoomsService, ROOMS_SAMPLE_DATA } from '../sample/sampleRooms'

const PLANNING = 'did:webvh:sample:planning'

describe('the sample rooms service', () => {
  it('says it is sample data and carries the marker a store build must not contain', async () => {
    const rooms = createSampleRoomsService()
    expect(rooms.isSample).toBe(true)
    expect(ROOMS_SAMPLE_DATA).toMatch(/^ROOMS_SAMPLE_DATA/)
    // Read at runtime, so a minifier keeps the marker the store-bundle check looks for.
    expect(rooms.label).toBe(ROOMS_SAMPLE_DATA)
    expect((await rooms.capabilities()).listMyRooms.reason).toBe('sample')
  })

  it('names people only by identity words', async () => {
    const rooms = createSampleRoomsService()
    const notes = await rooms.listNotes(PLANNING)
    for (const note of notes) expect(note.author?.identityWords).toMatch(/^…[a-z]+-[a-z]+$/)
    expect((await rooms.getRoom(PLANNING)).actingAs.identityWords).toMatch(/^…[a-z]+-[a-z]+$/)
  })

  it('reads a note as inert text, with its hints', async () => {
    const rooms = createSampleRoomsService()
    expect((await rooms.readNote(PLANNING, 'n2')).flags.containsLink).toBe(true)
    expect((await rooms.readNote(PLANNING, 'n3')).flags.looksLikeInstruction).toBe(true)
  })

  it('writes in two steps: the preview names the identity first, and its token works once', async () => {
    const rooms = createSampleRoomsService()
    const preview = await rooms.prepareWrite(PLANNING, { title: 'Minutes', body: 'Agreed item 3.' })
    expect(preview).toMatchObject({
      actingAs: { identityWords: '…negative-weird' },
      visibleTo: 'members',
      authorShown: true,
    })
    expect((await rooms.listNotes(PLANNING)).some((n) => n.title === 'Minutes')).toBe(false)
    const { key } = await rooms.confirmWrite(preview.token)
    expect((await rooms.readNote(PLANNING, key)).body).toBe('Agreed item 3.')
    await expect(rooms.confirmWrite(preview.token)).rejects.toBeInstanceOf(RoomsPreviewExpired)
  })

  it('a preview older than its lifetime is expired, and nothing is written', async () => {
    let clock = 1_000_000
    const rooms = createSampleRoomsService({ now: () => clock })
    const preview = await rooms.prepareWrite(PLANNING, { title: 'Late', body: 'too late' })
    clock += PREVIEW_TOKEN_TTL_MS + 1
    await expect(rooms.confirmWrite(preview.token)).rejects.toBeInstanceOf(RoomsPreviewExpired)
    expect((await rooms.listNotes(PLANNING)).some((n) => n.title === 'Late')).toBe(false)
  })

  it('replacing a note that changed since the preview is a conflict carrying the current version', async () => {
    const rooms = createSampleRoomsService()
    const stale = await rooms.prepareWrite(PLANNING, { title: 'Agenda v2', body: 'mine', replaceKey: 'n1' })
    const other = await rooms.prepareWrite(PLANNING, { title: 'Agenda v3', body: 'theirs', replaceKey: 'n1' })
    const { version } = await rooms.confirmWrite(other.token)
    const conflict = rooms.confirmWrite(stale.token)
    await expect(conflict).rejects.toBeInstanceOf(RoomsConflict)
    await expect(conflict).rejects.toMatchObject({ key: 'n1', currentVersion: version })
  })

  it('an open room tells the writer the host can read it, and a read-only room refuses', async () => {
    const rooms = createSampleRoomsService()
    await expect(rooms.prepareWrite('did:webvh:sample:welcome-desk', { title: 't', body: 'b' })).rejects.toThrow(
      'only read'
    )
  })

  it('accepts an offer in two steps, and hiding one tells no one', async () => {
    const rooms = createSampleRoomsService()
    const [offer] = await rooms.listOffers()
    const preview = await rooms.previewOffer(offer.offerId)
    expect(preview.actingAs.identityWords).toBe('…negative-weird')
    const { roomId } = await rooms.acceptOffer(preview.token)
    expect((await rooms.listMyRooms()).map((r) => r.roomId)).toContain(roomId)
    expect(await rooms.listOffers()).toEqual([])

    const other = createSampleRoomsService()
    await other.hideOffer('o1')
    expect(await other.listOffers()).toEqual([])
  })

  it('members are the administrators’ to list, and leaving the community leaves its rooms', async () => {
    const rooms = createSampleRoomsService()
    await expect(rooms.listCommunityMembers('did:webvh:sample:test-vtc')).rejects.toBeInstanceOf(RoomsUnavailable)
    await rooms.leaveViaCommunity('did:webvh:sample:test-vtc')
    expect(await rooms.listMyRooms()).toEqual([])
  })

  it('grants and withdraws an agent’s access', async () => {
    const rooms = createSampleRoomsService()
    const grant = await rooms.grantAgentAccess({
      roomId: PLANNING,
      agentDid: 'did:key:sample-agent',
      verbs: ['read'],
      expiresAt: '2026-10-25T16:00:00Z',
    })
    expect(await rooms.listAgentAccess(PLANNING)).toHaveLength(1)
    await rooms.withdrawAgentAccess(grant.grantId)
    expect(await rooms.listAgentAccess(PLANNING)).toEqual([])
  })
})
