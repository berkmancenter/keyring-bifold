/**
 * One room offer, as its consent screen shows it: the service's preview of exactly what accepting does, then
 * accept or hide. The offer is named by an `offerRef`, so the screen never depends on how it was reached: the
 * offers list today, a join link or QR later (rooms member sprint, "Join entry points").
 *
 * Accepting sends the preview's token. A token that has gone stale (older than ten minutes, or from before the
 * app restarted) is not an error the person caused: the preview is read again and the screen asks them to look
 * once more, since what they agreed to may have changed. Nothing is sent in that case.
 *
 * @module rooms/useRoomOffer
 */
import { useCallback, useEffect, useState } from 'react'

import type { OfferPreview, OperationStatus, RoomsService } from './types'

export type OfferStep = 'reading' | 'ready' | 'accepting' | 'hiding'

export interface RoomOfferState {
  /** Undefined until the first read answers. */
  acceptStatus?: OperationStatus
  hideStatus?: OperationStatus
  preview?: OfferPreview
  step: OfferStep
  /** The offer could not be read. */
  readFailed: boolean
  /** The last accept or hide failed; nothing changed. */
  actFailed?: 'accept' | 'hide'
  /** The preview was stale and has been read again: ask the person to check it once more. */
  refreshed: boolean
  reload: () => void
  /** Accepts the previewed offer and answers the room it joined; undefined when nothing was accepted. */
  accept: () => Promise<string | undefined>
  /** Hides the offer on this phone; false when it could not. */
  hide: () => Promise<boolean>
}

const isExpired = (e: unknown): boolean => e instanceof Error && e.name === 'RoomsPreviewExpired'

export function useRoomOffer(service: RoomsService | undefined, offerRef: string): RoomOfferState {
  const [acceptStatus, setAcceptStatus] = useState<OperationStatus>()
  const [hideStatus, setHideStatus] = useState<OperationStatus>()
  const [preview, setPreview] = useState<OfferPreview>()
  const [step, setStep] = useState<OfferStep>('reading')
  const [readFailed, setReadFailed] = useState(false)
  const [actFailed, setActFailed] = useState<'accept' | 'hide'>()
  const [refreshed, setRefreshed] = useState(false)
  const [generation, setGeneration] = useState(0)
  const reload = useCallback(() => setGeneration((g) => g + 1), [])

  useEffect(() => {
    if (!service) return
    let live = true
    setStep('reading')
    setReadFailed(false)
    void (async () => {
      try {
        const capabilities = await service.capabilities({ refresh: generation > 0 })
        if (!live) return
        setAcceptStatus(capabilities.acceptOffer)
        setHideStatus(capabilities.hideOffer)
        if (capabilities.acceptOffer.status !== 'available') return setStep('ready')
        const read = await service.previewOffer(offerRef)
        if (!live) return
        setPreview(read)
        setStep('ready')
      } catch {
        if (live) {
          setReadFailed(true)
          setStep('ready')
        }
      }
    })()
    return () => {
      live = false
    }
  }, [service, offerRef, generation])

  const accept = useCallback(async () => {
    if (!service || !preview) return undefined
    setActFailed(undefined)
    setRefreshed(false)
    setStep('accepting')
    try {
      const { roomId } = await service.acceptOffer(preview.token)
      setStep('ready')
      return roomId
    } catch (e) {
      if (isExpired(e)) {
        try {
          setPreview(await service.previewOffer(offerRef))
          setRefreshed(true)
        } catch {
          setReadFailed(true)
        }
      } else {
        setActFailed('accept')
      }
      setStep('ready')
      return undefined
    }
  }, [service, preview, offerRef])

  const hide = useCallback(async () => {
    if (!service) return false
    setActFailed(undefined)
    setStep('hiding')
    try {
      await service.hideOffer(offerRef)
      setStep('ready')
      return true
    } catch {
      setActFailed('hide')
      setStep('ready')
      return false
    }
  }, [service, offerRef])

  return { acceptStatus, hideStatus, preview, step, readFailed, actFailed, refreshed, reload, accept, hide }
}
