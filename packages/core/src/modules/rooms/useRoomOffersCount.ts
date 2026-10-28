/**
 * How many room offers wait for the member, for the Rooms card's badge. Nothing pushes an offer to a phone
 * (rooms member sprint): it is pulled while the app is in the foreground, an agent is linked and the rooms flag is on
 * (a service exists), every {@link OFFERS_POLL_MS} while offers wait and every {@link OFFERS_IDLE_POLL_MS} while none
 * do. Any of those false, and nothing is asked: no call, and the count already read stays.
 *
 * @module rooms/useRoomOffersCount
 */
import { useEffect, useState } from 'react'
import { AppState } from 'react-native'

import type { RoomsService } from './types'

/** One minute: offers change rarely, and each poll is one signed request per community. */
export const OFFERS_POLL_MS = 60_000

/** Five minutes, after a poll that found no offers or failed: most members have none waiting most of the time. */
export const OFFERS_IDLE_POLL_MS = 300_000

/**
 * Undefined until the first answer. A failed poll keeps the last count. Asked again after a minute while offers
 * wait, after five when none do or the poll failed.
 */
export function useRoomOffersCount(service: RoomsService | undefined, linked: boolean): number | undefined {
  const [count, setCount] = useState<number>()
  // Only the background stops it: 'inactive' (a passing system sheet) and iOS's 'unknown' at launch are still in use.
  const [active, setActive] = useState(AppState.currentState !== 'background')

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state !== 'background'))
    return () => subscription?.remove()
  }, [])

  useEffect(() => {
    if (!service || !linked || !active) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    /** Asks once and says whether any offer is waiting: the next ask comes sooner if one is. */
    const ask = async (): Promise<boolean> => {
      try {
        const capabilities = await service.capabilities()
        if (capabilities.listOffers.status !== 'available') return false
        const offers = await service.listOffers()
        if (live) setCount(offers.length)
        return offers.length > 0
      } catch {
        // The badge keeps what it last knew; the card says when the agent can't be reached.
        return false
      }
    }
    const poll = async () => {
      const waiting = await ask()
      if (live) timer = setTimeout(() => void poll(), waiting ? OFFERS_POLL_MS : OFFERS_IDLE_POLL_MS)
    }
    void poll()
    return () => {
      live = false
      if (timer) clearTimeout(timer)
    }
  }, [service, linked, active])

  return count
}
