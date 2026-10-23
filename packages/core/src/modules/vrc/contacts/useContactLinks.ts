import { useAgent } from '@bifold/react-hooks'
import { useEffect, useState } from 'react'

import { ContactLinks, NO_CONTACT_LINKS, loadContactLinks } from './contactLinks'

/**
 * The contact links on this phone, read on mount and again whenever `refresh` changes (the Contacts list passes its
 * focus, so a merge or a separation made on another screen shows on return). Until the first read, and when the read
 * fails, no links: each relationship is its own contact, as before links existed.
 */
export function useContactLinks(refresh?: unknown): ContactLinks {
  const { agent } = useAgent()
  const [links, setLinks] = useState<ContactLinks>(NO_CONTACT_LINKS)

  useEffect(() => {
    let cancelled = false
    loadContactLinks(agent)
      .then((loaded) => {
        if (!cancelled) setLinks(loaded)
      })
      .catch((error: unknown) => {
        agent?.config?.logger?.warn(
          `[VRC:Contacts] could not read contact links: ${(error as Error)?.message ?? error}`
        )
      })
    return () => {
      cancelled = true
    }
  }, [agent, refresh])

  return links
}
