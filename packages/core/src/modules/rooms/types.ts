/**
 * The rooms data layer's contract with the screens: one `RoomsService`, injected through
 * `TOKENS.UTIL_ROOMS_SERVICE`, with a status for every operation so a screen never guesses
 * what is available.
 *
 * A room is a shared, encrypted set of records with its own DID. Members hold credentials the
 * room issued, and the person's own agent (VTA) holds the room's keys. The phone never does:
 * it asks its agent, which reads and writes for it (VTI `docs/02-vta/data-rooms.md` §2, §9).
 * Upstream's code is the reference for every shape here. The reasoning is in
 * docs/plans/openvtc-rooms-plan.md in the wallet repository.
 */
import type { InertText } from './inertText'

export type { InertText } from './inertText'

/** Every operation a screen can ask about. */
export type RoomsOperation =
  | 'listMyRooms'
  | 'getRoom'
  | 'listNotes'
  | 'readNote'
  | 'write'
  | 'curate'
  | 'listOffers'
  | 'acceptOffer'
  | 'hideOffer'
  | 'listFiles'
  | 'openFile'
  | 'listCommunityMembers'
  | 'agentAccess'
  | 'leaveViaCommunity'
  | 'groupChat'
  | 'requestToJoin'

/**
 * Why an operation is or is not available. The screens choose the words from this, never from
 * their own guess:
 * - `ok`: available.
 * - `sample`: available, on fixture data; show the "Sample data" banner.
 * - `clientNotBuilt`: the person's agent serves it, but Keyring has not built it yet ("Coming soon").
 * - `notBuiltUpstream`: nothing anywhere serves it, e.g. group chat ("Not available yet").
 * - `agentDoesNotServe`: this person's agent is too old to serve it ("Your agent needs an update").
 * - `adminOnly`: only a community's administrators may do it.
 * - `noAgentLinked`: the phone has no agent to ask.
 * - `agentUnknown`: the agent could not be asked what it serves; try again later.
 */
export type RoomsReason =
  | 'ok'
  | 'sample'
  | 'clientNotBuilt'
  | 'notBuiltUpstream'
  | 'agentDoesNotServe'
  | 'adminOnly'
  | 'noAgentLinked'
  | 'agentUnknown'

export type RoomsStatus = 'available' | 'comingSoon' | 'unavailable'

export interface OperationStatus {
  status: RoomsStatus
  reason: RoomsReason
  /** A plain explanation for logs and support, not copy for the screen. */
  detail: string
}

export type RoomsCapabilities = Record<RoomsOperation, OperationStatus>

/** Upstream's visibility tiers (vti-rooms `Visibility`). `private` is stored but not served yet. */
export type RoomTier = 'open' | 'attributed' | 'private'

/** What a room's authority credential lets this member do (vti-rooms `Action`). */
export type RoomVerb = 'read' | 'write' | 'curate' | 'admin'

/** An identity as a person sees it: the community's identity words, never a name. */
export interface Identity {
  identityWords: string
  did: string
}

export interface RoomSummary {
  roomId: string
  name: InertText
  communityDid?: string
  communityName?: InertText
  tier: RoomTier
  verbs: RoomVerb[]
  /** When this member's access ends unless renewed (ISO 8601). */
  validUntil?: string
  standing: 'member' | 'lapsed' | 'removed'
}

export interface Room extends RoomSummary {
  /** The identity this member acts as in the room. */
  actingAs: Identity
}

export interface NoteSummary {
  key: string
  version: number
  title: InertText
  author?: Identity
  /** Set when an AI agent wrote it under its person's membership. */
  byAgent?: boolean
  createdAt?: string
  status: 'live' | 'retracted'
  pinned: boolean
}

export interface InertFlags {
  /** The text contains something that looks like a link. It is shown as text and never followed. */
  containsLink: boolean
  /** The text reads like an instruction to an agent. It is shown as text and never acted on. */
  looksLikeInstruction: boolean
}

export interface Note extends NoteSummary {
  body: InertText
  flags: InertFlags
}

export interface WriteDraft {
  title: string
  body: string
  /** Replace this note instead of adding one. */
  replaceKey?: string
}

/**
 * What the confirmation sheet shows before anything leaves the phone. `confirmWrite(token)` sends
 * exactly this. The identity is named before consent, never after.
 */
export interface WritePreview {
  token: string
  roomId: string
  roomName: InertText
  communityName?: InertText
  tier: RoomTier
  actingAs: Identity
  /** `members`: only members can read it. `membersAndHost`: an open room, readable by its host too. */
  visibleTo: 'members' | 'membersAndHost'
  /** Whether members (and on attributed rooms, the host) see that it is this member's. */
  authorShown: boolean
  title: InertText
  body: InertText
  validUntil?: string
}

export interface RoomOffer {
  offerId: string
  roomId: string
  roomName: InertText
  communityDid: string
  communityName: InertText
  tier: RoomTier
  verbs: RoomVerb[]
  validUntil?: string
}

/** What the offer sheet shows before accepting. `acceptOffer(token)` accepts exactly this. */
export interface OfferPreview {
  token: string
  offer: RoomOffer
  actingAs: Identity
}

export interface RoomFile {
  fileId: string
  name: InertText
  mediaType?: string
  size?: number
  sharedBy?: Identity
  sharedAt?: string
}

/**
 * A file opened for viewing: a protected local copy. The file's key never leaves the service:
 * upstream warns it never expires (VTI `docs/05-design-notes/data-rooms-files.md`).
 */
export interface OpenedFile {
  localUri: string
  mediaType?: string
  size: number
}

export interface CommunityRoomMember {
  identity: Identity
  verbs: RoomVerb[]
}

export interface AgentGrant {
  grantId: string
  roomId: string
  agentLabel: InertText
  agentDid: string
  verbs: RoomVerb[]
  expiresAt?: string
}

export interface AgentGrantRequest {
  roomId: string
  agentDid: string
  verbs: RoomVerb[]
  expiresAt: string
}

/** Thrown by an operation whose status is not `available`. */
export class RoomsUnavailable extends Error {
  public constructor(
    public readonly operation: RoomsOperation,
    public readonly reason: RoomsReason,
    detail: string
  ) {
    super(`${operation} is not available (${reason}): ${detail}`)
    this.name = 'RoomsUnavailable'
  }
}

export interface RoomsService {
  /** True for the fixture service: every screen it feeds shows the "Sample data" banner. */
  readonly isSample: boolean
  /** One status per operation. Cached per agent; `refresh` asks again. */
  capabilities(options?: { refresh?: boolean }): Promise<RoomsCapabilities>

  listMyRooms(): Promise<RoomSummary[]>
  getRoom(roomId: string): Promise<Room>
  listNotes(roomId: string): Promise<NoteSummary[]>
  readNote(roomId: string, key: string): Promise<Note>
  prepareWrite(roomId: string, draft: WriteDraft): Promise<WritePreview>
  confirmWrite(token: string): Promise<{ key: string; version: number }>
  curate(roomId: string, key: string, action: 'pin' | 'unpin' | 'retract'): Promise<void>

  listOffers(communityDid?: string): Promise<RoomOffer[]>
  previewOffer(offerId: string): Promise<OfferPreview>
  acceptOffer(token: string): Promise<{ roomId: string }>
  /** Hides an offer on this phone only. Upstream has no decline: the community is not told. */
  hideOffer(offerId: string): Promise<void>

  listFiles(roomId: string): Promise<RoomFile[]>
  openFile(roomId: string, fileId: string): Promise<OpenedFile>

  /** Administrator-only upstream (`vtc.rooms.manage`); a member gets `adminOnly`. */
  listCommunityMembers(communityDid: string, roomId?: string): Promise<CommunityRoomMember[]>

  listAgentAccess(roomId?: string): Promise<AgentGrant[]>
  grantAgentAccess(request: AgentGrantRequest): Promise<AgentGrant>
  withdrawAgentAccess(grantId: string): Promise<void>

  /** Leaving goes through the community: leaving it takes the member out of its rooms. */
  leaveViaCommunity(communityDid: string): Promise<void>
}
