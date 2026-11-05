/**
 * The shared-connect confirm screen (plan WP3): what is shown, what is not,
 * and that nothing is sent before Connect — against fake steps.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import type { SharedConnectPreview } from '../module/sharedConnectStart'
import { SharedConnectFlow, type SharedConnectSteps } from '../screens/SharedConnect'
import { SharedConnectIds } from '../screens/SharedConnect.ids'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const LINK = 'https://link.trustoverip.org/t#_from=did:peer:2.x&_id=XOcGXOQTCHb5iz4T2JD2RQ'
const PREVIEW: SharedConnectPreview = {
  inviterDid: 'did:peer:2.Vz6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK.Ez6LS',
  didShort: 'did:peer:2.Vz6MkhaXgBZDv…',
  label: 'Ada Lovelace',
  relayHost: 'relay.example.org',
  carriage: 'tsp',
  exp: 1_800_000_600,
  enactment: 'XOcGXOQTCHb5iz4T2JD2RQ',
}

const steps = (over: Partial<SharedConnectSteps> = {}): jest.Mocked<SharedConnectSteps> =>
  ({
    preview: jest.fn(async () => ({ kind: 'ready', preview: PREVIEW, endpoint: 'did:peer:2.m' })),
    start: jest.fn(async () => ({ kind: 'started', encounter: {} })),
    ...over,
  }) as jest.Mocked<SharedConnectSteps>

const onClose = jest.fn()
const show = async (s: SharedConnectSteps, link: string | null = LINK) => {
  const tree = render(
    <BasicAppContext>
      <SharedConnectFlow link={link ?? undefined} steps={s} onClose={onClose} />
    </BasicAppContext>
  )
  await act(async () => undefined)
  return tree
}
const press = async (tree: ReturnType<typeof render>, key: string) =>
  act(async () => {
    fireEvent.press(tree.getByTestId(id(key)))
  })

beforeEach(() => onClose.mockReset())

describe('the confirm step', () => {
  it('shows the name marked unverified, a DID prefix, the relay host and the expiry', async () => {
    const tree = await show(steps())
    expect(tree.getByTestId(id(SharedConnectIds.confirm))).toBeTruthy()
    expect(tree.getByTestId(id(SharedConnectIds.name)).props.children).toBe('Ada Lovelace')
    expect(tree.getByTestId(id(SharedConnectIds.unverified))).toBeTruthy()
    expect(tree.getByTestId(id(SharedConnectIds.contact)).props.children).toBe(PREVIEW.didShort)
    expect(tree.getByTestId(id(SharedConnectIds.relay)).props.children).toBe('relay.example.org')
    expect(tree.getByTestId(id(SharedConnectIds.expires)).props.children).toBeDefined()
  })

  it('shows "No name given" and no unverified marker without a label, and "No relay name" without a host', async () => {
    const s = steps({
      preview: jest.fn(async () => ({
        kind: 'ready' as const,
        endpoint: 'did:peer:2.m',
        preview: { ...PREVIEW, label: undefined, relayHost: undefined },
      })),
    })
    const tree = await show(s)
    expect(tree.getByTestId(id(SharedConnectIds.name)).props.children).toBe('SharedConnect.NoName')
    expect(tree.queryByTestId(id(SharedConnectIds.unverified))).toBeNull()
    expect(tree.getByTestId(id(SharedConnectIds.relay)).props.children).toBe('SharedConnect.NoRelay')
  })

  it('never shows the link or the full DID', async () => {
    const tree = await show(steps())
    const text = JSON.stringify(tree.toJSON())
    expect(text).not.toContain('_from=')
    expect(text).not.toContain(PREVIEW.inviterDid)
    expect(text).not.toContain(PREVIEW.enactment)
  })

  it('sends nothing before Connect: the link is only read', async () => {
    const s = steps()
    await show(s)
    expect(s.preview).toHaveBeenCalledTimes(1)
    expect(s.start).not.toHaveBeenCalled()
  })

  it('Cancel closes without starting', async () => {
    const s = steps()
    const tree = await show(s)
    await press(tree, SharedConnectIds.cancel)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(s.start).not.toHaveBeenCalled()
  })
})

describe('Connect', () => {
  it('starts once, with the link, and says it is ready', async () => {
    const s = steps()
    const tree = await show(s)
    await press(tree, SharedConnectIds.connect)
    expect(s.start).toHaveBeenCalledWith(LINK)
    expect(tree.getByTestId(id(SharedConnectIds.result))).toBeTruthy()
    expect(JSON.stringify(tree.toJSON())).toContain('SharedConnect.Ready')
    await press(tree, SharedConnectIds.done)
    expect(onClose).toHaveBeenCalled()
  })

  it.each([
    ['an expiry that passed meanwhile', { kind: 'refused', ui: 'expired' }, 'Scan.TriggerLinkExpired'],
    ['a failure', { kind: 'failed' }, 'SharedConnect.Failed'],
  ])('says so for %s', async (_, outcome, words) => {
    const tree = await show(steps({ start: jest.fn(async () => outcome as never) }))
    await press(tree, SharedConnectIds.connect)
    expect(JSON.stringify(tree.toJSON())).toContain(words)
  })

  it('says it could not be set up when the step throws', async () => {
    const tree = await show(steps({ start: jest.fn(async () => Promise.reject(new Error('x'))) }))
    await press(tree, SharedConnectIds.connect)
    expect(JSON.stringify(tree.toJSON())).toContain('SharedConnect.Failed')
  })
})

describe('a link that cannot be used', () => {
  it.each([
    ['expired', 'Scan.TriggerLinkExpired'],
    ['unreachable', 'Scan.TriggerLinkUnreachable'],
    ['invalid', 'Scan.TriggerLinkInvalid'],
  ] as const)('says %s, with no Connect', async (ui, words) => {
    const s = steps({ preview: jest.fn(async () => ({ kind: 'refused' as const, ui })) })
    const tree = await show(s)
    expect(JSON.stringify(tree.toJSON())).toContain(words)
    expect(tree.queryByTestId(id(SharedConnectIds.connect))).toBeNull()
  })

  it('says it cannot be used when the screen holds no link, and reads nothing', async () => {
    const s = steps()
    const tree = await show(s, null)
    expect(JSON.stringify(tree.toJSON())).toContain('Scan.TriggerLinkInvalid')
    expect(s.preview).not.toHaveBeenCalled()
  })
})
