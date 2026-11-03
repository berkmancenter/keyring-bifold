/**
 * Before a remote VRC: the notifications ask shows only where turning them on makes this phone wakeable (push in
 * the build, an agent linked, permission not given), and turning them on also makes the phone wakeable (IN-448).
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { container } from 'tsyringe'

import { useAgent } from '@bifold/react-hooks'

import { TOKENS } from '../../../../src/container-api'
import { MainContainer, defaultConfig } from '../../../../src/container-impl'
import RemoteVrcNotificationsAsk, {
  resetRemoteVrcNotificationsAsk,
} from '../../../../src/modules/vrc/components/RemoteVrcNotificationsAsk'
import { vtaAgent } from '../../../../src/modules/trust-tasks/module/vtaAgent'
import { testIdWithKey } from '../../../../src/utils/testable'
import { CustomBasicAppContext } from '../../../helpers/app'

jest.mock('@bifold/react-hooks')

const agent = { config: { logger: { warn: jest.fn() } } }

function setup(opts: { push?: boolean; linked?: boolean; status?: string; afterSetup?: string }) {
  const status = jest.fn().mockResolvedValue(opts.status ?? 'denied')
  const setupFn = jest.fn().mockResolvedValue(opts.afterSetup ?? 'granted')
  const toggle = jest.fn().mockResolvedValue(undefined)
  const child = container.createChildContainer()
  const c = new MainContainer(child).init()
  child.registerInstance(TOKENS.CONFIG, {
    ...defaultConfig,
    ...(opts.push === false ? {} : { enablePushNotifications: { status, setup: setupFn, toggle } }),
  })
  jest
    .spyOn(vtaAgent, 'getState')
    .mockReturnValue({
      ...vtaAgent.getState(),
      link: (opts.linked === false ? { kind: 'notLinked' } : { kind: 'linked' }) as never,
    })
  const tree = render(
    <CustomBasicAppContext container={c}>
      <RemoteVrcNotificationsAsk />
    </CustomBasicAppContext>
  )
  return { tree, status, setupFn, toggle }
}

describe('the notifications ask before a remote VRC', () => {
  beforeEach(() => {
    resetRemoteVrcNotificationsAsk()
    ;(useAgent as jest.Mock).mockReturnValue({ agent })
  })
  afterEach(() => jest.restoreAllMocks())

  it('asks a linked phone whose notifications are off', async () => {
    const { tree } = setup({})
    await waitFor(() => expect(tree.getByTestId(testIdWithKey('RemoteVrcNotificationsAsk'))).toBeTruthy())
    expect(tree.getByText('RemoteVrcNotify.Ask')).toBeTruthy()
  })

  it.each([
    ['no push in the build', { push: false }],
    ['no agent linked: turning them on would not make it wakeable', { linked: false }],
    ['notifications already on', { status: 'granted' }],
  ] as const)('does not ask with %s', async (_label, opts) => {
    const { tree, status } = setup(opts)
    await act(async () => undefined)
    if (opts.push !== false && opts.linked !== false) await waitFor(() => expect(status).toHaveBeenCalled())
    expect(tree.queryByTestId(testIdWithKey('RemoteVrcNotificationsAsk'))).toBeNull()
  })

  it('"Turn on" asks for the permission, then makes the phone wakeable, and goes away', async () => {
    const { tree, setupFn, toggle } = setup({})
    const turnOn = await waitFor(() => tree.getByTestId(testIdWithKey('RemoteVrcNotificationsTurnOn')))
    await act(async () => fireEvent.press(turnOn))
    expect(setupFn).toHaveBeenCalledTimes(1)
    expect(toggle).toHaveBeenCalledWith(true, agent)
    expect(tree.queryByTestId(testIdWithKey('RemoteVrcNotificationsAsk'))).toBeNull()
  })

  it('a refused permission says so, and does not try to make the phone wakeable', async () => {
    const { tree, toggle } = setup({ afterSetup: 'denied' })
    const turnOn = await waitFor(() => tree.getByTestId(testIdWithKey('RemoteVrcNotificationsTurnOn')))
    await act(async () => fireEvent.press(turnOn))
    expect(toggle).not.toHaveBeenCalled()
    expect(tree.getByText('RemoteVrcNotify.Denied')).toBeTruthy()
  })

  it('"Not now" puts it away for this run of the app', async () => {
    const first = setup({})
    const notNow = await waitFor(() => first.tree.getByTestId(testIdWithKey('RemoteVrcNotificationsNotNow')))
    fireEvent.press(notNow)
    expect(first.tree.queryByTestId(testIdWithKey('RemoteVrcNotificationsAsk'))).toBeNull()
    first.tree.unmount()
    const again = setup({})
    await act(async () => undefined)
    expect(again.tree.queryByTestId(testIdWithKey('RemoteVrcNotificationsAsk'))).toBeNull()
  })
})
