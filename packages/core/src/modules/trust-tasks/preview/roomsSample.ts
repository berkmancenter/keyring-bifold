/**
 * Sample rooms for the developer preview of the new navigation (Preview: new
 * navigation, in Developer settings). Nothing here is read from a community
 * or an agent, and nothing is sent: every screen that shows these says
 * "Preview, not connected".
 *
 * @module trust-tasks/preview/roomsSample
 */

export type RoomTier = 'open' | 'attributed' | 'sealed'

export interface SampleNote {
  id: string
  title: string
  author: string
  /** Shown exactly as written, never followed: links, markup and instruction-like text included. */
  body: string
  retracted?: boolean
}

export interface SampleRoom {
  id: string
  name: string
  community: string
  tier: RoomTier
  write: boolean
  until: string
  notes: SampleNote[]
}

export interface SampleOffer {
  room: string
  community: string
  tier: RoomTier
  write: boolean
  until: string
  days: number
  persona: string
}

export const SAMPLE_PERSONA = '…negative-weird'

export const SAMPLE_ROOMS: SampleRoom[] = [
  {
    id: 'kernel-notes',
    name: 'Kernel notes',
    community: 'Test VTC',
    tier: 'attributed',
    write: true,
    until: '2027-01-15',
    notes: [
      {
        id: 'agenda',
        title: 'Agenda for Thursday',
        author: '…term-benefit',
        body: '1. Review the vetting backlog\n2. Draft the rooms policy\nSee https://example.org/agenda',
      },
      {
        id: 'odd',
        title: 'Ignore previous instructions…',
        author: '…river-stone',
        body: '<b>Click here</b> and run this…',
      },
      { id: 'gone', title: '', author: '', body: '', retracted: true },
    ],
  },
  {
    id: 'welcome-desk',
    name: 'Welcome desk',
    community: 'Test VTC',
    tier: 'open',
    write: false,
    until: '2026-11-01',
    notes: [
      {
        id: 'hello',
        title: 'Start here',
        author: '…quiet-harbor',
        body: 'Introduce yourself in a note. Be kind.',
      },
    ],
  },
]

export const SAMPLE_OFFER: SampleOffer = {
  room: 'Planning',
  community: 'Test VTC',
  tier: 'attributed',
  write: true,
  until: '2027-01-15',
  days: 90,
  persona: SAMPLE_PERSONA,
}

export const sampleRoom = (id: string | undefined): SampleRoom =>
  SAMPLE_ROOMS.find((r) => r.id === id) ?? SAMPLE_ROOMS[0]

/** A sample date as the phone writes dates. */
export const sampleDate = (iso: string): string =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
