/**
 * The shared-connect confirm screen (keyring-wallet #853 WP3): what it shows
 * from the code alone, that nothing is sent before Connect, the expiry checked
 * again at Connect, every ending, and the scanner's route to it. Codes are made
 * by the spec-side fixture; Credo reads the did:peer for real.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import {
  readSharedConnect,
  registerSharedConnectStarter,
  setSharedConnectEnabled,
  timeLeftWords,
  type SharedConnectOffer,
} from '../module/sharedConnect'
import { TRIGGER_UI_MESSAGE_KEYS } from '../module/triggerLink'
import { MY_AGENT_SCREEN, myAgentLinkParams, routeKeyringAgentLink } from '../module/vtiLinks'
import { SharedConnectFlow } from '../screens/SharedConnect'
import { SharedConnectIds } from '../screens/SharedConnect.ids'

import {
  challenge,
  didcommService,
  peer2,
  sharedConnectLink,
  tspService,
} from './fixtures/shared-connect/sharedConnectLinks'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const NOW = 1_794_000_000
const FROM = peer2([tspService(), didcommService()])
const ID = challenge()
const LABEL = 'Ana at the meetup'

let clock = NOW
const now = () => clock
const onClose = jest.fn()

const show = async (link: string | undefined, start?: ((offer: SharedConnectOffer) => Promise<void>) | null) => {
  const tree = render(
    <BasicAppContext>
      <SharedConnectFlow link={link} start={start} now={now} onClose={onClose} />
    </BasicAppContext>
  )
  await act(async () => undefined)
  return tree
}

const press = async (tree: ReturnType<typeof render>, key: string) => {
  await act(async () => {
    fireEvent.press(tree.getByTestId(id(key)))
  })
}

const text = (tree: ReturnType<typeof render>, key: string) => tree.getByTestId(id(key))

beforeEach(() => {
  clock = NOW
  onClose.mockReset()
  setSharedConnectEnabled(true)
})
afterEach(() => {
  setSharedConnectEnabled(false)
  registerSharedConnectStarter(undefined)
})

describe('confirm, from the code alone', () => {
  it('shows the name as given and not checked, the ID as a prefix, the relay host and the time left', async () => {
    const start = jest.fn(async () => undefined)
    const tree = await show(sharedConnectLink({ from: FROM, id: ID, now: NOW, label: LABEL }), start)
    expect(text(tree, SharedConnectIds.confirm)).toBeTruthy()
    expect(text(tree, SharedConnectIds.name)).toHaveTextContent(LABEL)
    expect(text(tree, SharedConnectIds.nameUnverified)).toHaveTextContent('SharedConnect.NameUnverified')
    expect(text(tree, SharedConnectIds.did)).toHaveTextContent(`${FROM.slice(0, 'did:peer:'.length + 12)}…`)
    expect(text(tree, `${SharedConnectIds.did}Did`)).toHaveTextContent(FROM)
    expect(text(tree, SharedConnectIds.relay)).toHaveTextContent('relay.example.org')
    expect(text(tree, SharedConnectIds.expires)).toHaveTextContent('SharedConnect.ExpiresMinutes')
    // Nothing is sent, and nothing started, before Connect.
    expect(start).not.toHaveBeenCalled()
  })

  it('never puts the name in the heading', async () => {
    const tree = await show(sharedConnectLink({ from: FROM, now: NOW, label: 'Your Bank' }))
    const headings = tree.UNSAFE_root.findAll((node) => node.props.accessibilityRole === 'header')
    expect(headings.length).toBeGreaterThan(0)
    for (const heading of headings) expect(heading).not.toHaveTextContent(/Your Bank/)
  })

  it('says "No name given" when the code gives none (or one not shown), with no unverified note', async () => {
    for (const link of [
      sharedConnectLink({ from: FROM, now: NOW }),
      sharedConnectLink({ from: FROM, now: NOW, label: 'Ana‮knab' }),
    ]) {
      const tree = await show(link)
      expect(text(tree, SharedConnectIds.name)).toHaveTextContent('SharedConnect.NoName')
      expect(tree.queryByTestId(id(SharedConnectIds.nameUnverified))).toBeNull()
      tree.unmount()
    }
  })

  it('says the relay has no web address when it is named by a did:peer', async () => {
    const tree = await show(sharedConnectLink({ from: peer2([tspService(peer2([]))]), now: NOW }))
    expect(text(tree, SharedConnectIds.relay)).toHaveTextContent('SharedConnect.NoRelayHost')
  })

  it('Cancel closes, having sent nothing', async () => {
    const start = jest.fn(async () => undefined)
    const tree = await show(sharedConnectLink({ from: FROM, now: NOW }), start)
    await press(tree, SharedConnectIds.cancel)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(start).not.toHaveBeenCalled()
  })
})

describe('Connect', () => {
  it('starts the exchange once, with what the confirm screen showed, and says it is connecting', async () => {
    const start = jest.fn(async () => undefined)
    const link = sharedConnectLink({ from: FROM, id: ID, now: NOW, label: LABEL })
    const tree = await show(link, start)
    await press(tree, SharedConnectIds.connect)
    expect(start).toHaveBeenCalledTimes(1)
    const read = readSharedConnect(link, { now: NOW })
    if (read.outcome !== 'offer') throw new Error(`the code did not read: ${read.outcome}`)
    expect(start).toHaveBeenCalledWith(read.offer)
    expect(read.offer).toMatchObject({ from: FROM, enactment: ID, label: LABEL, binding: 'tsp' })
    expect(text(tree, SharedConnectIds.resultMessage)).toHaveTextContent('SharedConnect.Started')
  })

  it('uses the registered starter by default', async () => {
    const start = jest.fn(async () => undefined)
    registerSharedConnectStarter(start)
    const tree = await show(sharedConnectLink({ from: FROM, now: NOW }))
    await press(tree, SharedConnectIds.connect)
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('shows Connecting while the start is under way', async () => {
    let finish: () => void = () => undefined
    const start = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const tree = await show(sharedConnectLink({ from: FROM, now: NOW }), start)
    await press(tree, SharedConnectIds.connect)
    expect(text(tree, SharedConnectIds.connecting)).toBeTruthy()
    await act(async () => finish())
    expect(text(tree, SharedConnectIds.resultMessage)).toHaveTextContent('SharedConnect.Started')
  })

  it('a start that fails says so', async () => {
    const tree = await show(
      sharedConnectLink({ from: FROM, now: NOW }),
      jest.fn(async () => {
        throw new Error('relay refused')
      })
    )
    await press(tree, SharedConnectIds.connect)
    expect(text(tree, SharedConnectIds.resultMessage)).toHaveTextContent('SharedConnect.Failed')
    expect(tree.queryByText(/relay refused/)).toBeNull()
  })

  it('with nothing registered, says this version cannot connect yet', async () => {
    const tree = await show(sharedConnectLink({ from: FROM, now: NOW }), null)
    await press(tree, SharedConnectIds.connect)
    expect(text(tree, SharedConnectIds.resultMessage)).toHaveTextContent('SharedConnect.NotBuilt')
    await press(tree, SharedConnectIds.done)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('checks the expiry again: a code that ran out while the screen was open is not used', async () => {
    const start = jest.fn(async () => undefined)
    const tree = await show(sharedConnectLink({ from: FROM, now: NOW, ttlSeconds: 120 }), start)
    clock = NOW + 120
    await press(tree, SharedConnectIds.connect)
    expect(start).not.toHaveBeenCalled()
    expect(text(tree, SharedConnectIds.resultMessage)).toHaveTextContent(TRIGGER_UI_MESSAGE_KEYS.expired)
  })

  it('turns Connect off when the time runs out on screen', async () => {
    jest.useFakeTimers()
    try {
      const tree = await show(sharedConnectLink({ from: FROM, now: NOW, ttlSeconds: 90 }))
      expect(text(tree, SharedConnectIds.connect)).not.toBeDisabled()
      clock = NOW + 90
      await act(async () => {
        jest.advanceTimersByTime(1000)
      })
      expect(text(tree, SharedConnectIds.connect)).toBeDisabled()
      expect(text(tree, SharedConnectIds.expires)).toHaveTextContent('SharedConnect.ExpiredShort')
      expect(tree.getByText(TRIGGER_UI_MESSAGE_KEYS.expired)).toBeTruthy()
    } finally {
      jest.useRealTimers()
    }
  })
})

describe("a code that can't be used says why on its first frame", () => {
  it.each([
    ['expired', sharedConnectLink({ from: FROM, now: NOW, exp: NOW - 600 }), TRIGGER_UI_MESSAGE_KEYS.expired],
    [
      'no common transport',
      sharedConnectLink({ from: peer2([{ type: 'LinkedDomains', serviceEndpoint: 'https://x.org' }]), now: NOW }),
      TRIGGER_UI_MESSAGE_KEYS.unreachable,
    ],
    ['no code', undefined, TRIGGER_UI_MESSAGE_KEYS.invalid],
  ])('%s', async (_, link, key) => {
    const tree = await show(link)
    expect(tree.queryByTestId(id(SharedConnectIds.confirm))).toBeNull()
    expect(text(tree, SharedConnectIds.resultMessage)).toHaveTextContent(key)
  })

  it('with the switch off, "update"', async () => {
    setSharedConnectEnabled(false)
    const tree = await show(sharedConnectLink({ from: FROM, now: NOW }))
    expect(text(tree, SharedConnectIds.resultMessage)).toHaveTextContent(TRIGGER_UI_MESSAGE_KEYS.update)
  })
})

describe('time left, in words', () => {
  it.each([
    [7 * 86_400, 'SharedConnect.ExpiresDays', 7],
    [86_400, 'SharedConnect.ExpiresDays', 1],
    [86_399, 'SharedConnect.ExpiresHours', 23],
    [3_600, 'SharedConnect.ExpiresHours', 1],
    [3_599, 'SharedConnect.ExpiresMinutes', 59],
    [60, 'SharedConnect.ExpiresMinutes', 1],
  ])('%i s → %s %i', (seconds, key, count) => {
    expect(timeLeftWords(seconds)).toEqual({ key, count })
  })

  it('below a minute, and none once expired', () => {
    expect(timeLeftWords(59)).toEqual({ key: 'SharedConnect.ExpiresSoon' })
    expect(timeLeftWords(0)).toBeUndefined()
    expect(timeLeftWords(-5)).toBeUndefined()
  })
})

describe('the scanner opens it', () => {
  it('with the switch on, an accepted code opens the confirm screen as its own route', async () => {
    const navigate = jest.fn()
    const link = sharedConnectLink({ from: FROM, now: Math.floor(Date.now() / 1000) })
    await routeKeyringAgentLink(link, {} as never, navigate)
    expect(navigate).toHaveBeenCalledTimes(1)
    const destination = navigate.mock.calls[0][0]
    expect(destination).toMatchObject({ screen: 'SharedConnect', link })
    expect(typeof destination.scanId).toBe('string')
    expect(MY_AGENT_SCREEN.SharedConnect).toBe(Screens.SharedConnect)
    expect(myAgentLinkParams(destination)).toEqual({
      screen: Screens.SharedConnect,
      initial: false,
      params: { link, scanId: destination.scanId },
    })
  })

  it('with the switch off, it does not', async () => {
    setSharedConnectEnabled(false)
    const navigate = jest.fn()
    const link = sharedConnectLink({ from: FROM, now: Math.floor(Date.now() / 1000) })
    await expect(routeKeyringAgentLink(link, {} as never, navigate)).rejects.toThrow()
    expect(navigate).not.toHaveBeenCalled()
  })
})
