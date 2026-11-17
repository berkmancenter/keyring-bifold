/**
 * What the badges screens read: the service on this phone's agent, the member's own badges in a community, and
 * another member's wall.
 *
 * One service per agent, made the first time a screen asks, as polls has it (`usePolls`). Badges are read when a screen
 * opens and when it is returned to, never on a timer: the community sees each read. Nothing is read, and nothing
 * shown, while badges are off (`badgesSwitch`).
 *
 * Tests (and the screens, until the client lands) put a service in with `setBadgeServiceForTests`, e.g. the fake in
 * `fakeBadgeService`, and take it out again with `resetBadgeService`.
 *
 * @module badges/useBadges
 */
import type { Agent } from '@credo-ts/core'
import { useAgent } from '@bifold/react-hooks'
import { useFocusEffect } from '@react-navigation/native'
import { useCallback, useRef, useState } from 'react'

import { isMemberBadgesOn } from './badgesSwitch'
import type { BadgeService, MemberWallState, MyBadges, MyBadgesState } from './types'

let made: { agent: Agent; service: BadgeService } | undefined
let injected: BadgeService | undefined
/** Made by the client (badgeService.ts) once it lands; until then only an injected service answers. */
let factory: ((agent: Agent) => BadgeService) | undefined

/** The client registers how a service is made for an agent (badgeService.ts). */
export function registerBadgeServiceFactory(make: (agent: Agent) => BadgeService): void {
  factory = make
  made = undefined
}

/** The badge service on this phone's agent, or none before the agent is up, or while badges are off. */
export function badgeServiceFor(agent: Agent | undefined): BadgeService | undefined {
  if (!isMemberBadgesOn()) return undefined
  if (injected) return injected
  if (!agent || !factory) return undefined
  if (made?.agent !== agent) made = { agent, service: factory(agent) }
  return made.service
}

/** Put a service in place of the agent's (tests; the screens' build against the fake). */
export function setBadgeServiceForTests(service: BadgeService | undefined): void {
  injected = service
}

/** Forget the service and any injected one (tests). */
export function resetBadgeService(): void {
  made = undefined
  injected = undefined
}

export function useBadgeService(): BadgeService | undefined {
  const { agent } = useAgent()
  return badgeServiceFor(agent as Agent | undefined)
}

/** The member's own badges and offers in one community, read on opening and on coming back. */
export function useMyBadges(communityDid: string): MyBadgesState {
  const service = useBadgeService()
  const [badges, setBadges] = useState<MyBadges | undefined>(undefined)
  const [served, setServed] = useState(false)
  const [loading, setLoading] = useState(true)
  const asked = useRef(0)
  const load = useCallback(() => {
    if (!service) {
      setBadges(undefined)
      setServed(false)
      setLoading(false)
      return
    }
    const mine = ++asked.current
    setLoading(true)
    service
      .mine(communityDid)
      .then((answer) => {
        if (mine !== asked.current) return
        if (answer === 'notServed') {
          setBadges(undefined)
          setServed(false)
        } else {
          setBadges(answer)
          setServed(true)
        }
      })
      .catch(() => {
        // A read that failed shows what was shown before; the next visit asks again.
        if (mine === asked.current) setServed((was) => was)
      })
      .finally(() => {
        if (mine === asked.current) setLoading(false)
      })
  }, [service, communityDid])
  useFocusEffect(load)
  return { badges, served, loading, refresh: load }
}

/** Another member's wall in one community, by their directory entry, read on opening and on coming back. */
export function useMemberWall(communityDid: string, entryId: string | undefined): MemberWallState {
  const service = useBadgeService()
  const [state, setState] = useState<MemberWallState>({ state: 'loading' })
  const asked = useRef(0)
  const load = useCallback(() => {
    if (!service || !entryId) {
      setState({ state: 'notServed' })
      return
    }
    const mine = ++asked.current
    service
      .wall(communityDid, entryId)
      .then((answer) => {
        if (mine !== asked.current) return
        if (answer === 'notServed' || answer === 'hidden') setState({ state: answer })
        else setState({ state: 'shown', wall: answer })
      })
      .catch(() => {
        if (mine === asked.current) setState((was) => (was.state === 'loading' ? { state: 'notServed' } : was))
      })
  }, [service, communityDid, entryId])
  useFocusEffect(load)
  return state
}
