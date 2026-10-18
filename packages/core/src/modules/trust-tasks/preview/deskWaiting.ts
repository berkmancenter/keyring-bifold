/**
 * How many vetting requests wait on this phone's vetter desks, for the badge
 * on Communities in the developer preview of the new navigation. Read from
 * the phone's own desk store (no agent or community call), only by preview
 * components, so nothing here runs while the preview is off.
 *
 * @module trust-tasks/preview/deskWaiting
 */
import type { Agent } from '@credo-ts/core'
import { useEffect, useState } from 'react'

import { GenericRecordsVettingStore, type VettingDeskRequest } from '../module/vtiVetting'

/** A request still needs the vetter while it is neither attested nor declined. */
export const deskWaiting = (desk: Pick<VettingDeskRequest, 'status'>[]): number =>
  desk.filter((r) => r.status !== 'attested' && r.status !== 'declined').length

const EVERY_MS = 30_000

export function useDeskWaitingCount(agent: Agent | undefined): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!agent) return
    let cancelled = false
    const read = () =>
      new GenericRecordsVettingStore(agent)
        .listDesk()
        .then((desk) => {
          if (!cancelled) setCount(deskWaiting(desk))
        })
        .catch(() => undefined)
    void read()
    const timer = setInterval(() => void read(), EVERY_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [agent])
  return count
}
