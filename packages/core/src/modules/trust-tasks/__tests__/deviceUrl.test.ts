/**
 * Trigger links under the phone's URL, not jest's.
 *
 * jest runs on Node, whose `URL` is WHATWG. The app runs React Native's own `URL` class (0.81,
 * Libraries/Blob/URL.js), which appends `/` to a URL with no `?` or `#`, so the `pathname` of
 * `https://link.trustoverip.org/vti/flow/shared-connect` is `/vti/flow/shared-connect/` on a phone. The WP9 live run
 * (2026-11-07, Android emulator) read a code Keyring showed: its link carried `_type=/vti/flow/shared-connect//0.1`,
 * which Keyring's own reader then takes as an unknown flow ("update the app"). Every test here passed under Node's URL
 * before the fix; these run the same code with React Native's class installed as the global, as the app has it.
 */
import file from './fixtures/trigger-link-vectors.json'
import { buildSharedConnectLink } from '../module/sharedConnectInvite'
import { setSharedConnectEnabled } from '../module/sharedConnectFlag'
import { readTrigger, type TriggerChannel, type TriggerConfig } from '../module/triggerLink'

// The class the app gets as `URL` on a phone.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { URL: DeviceURL } = jest.requireActual('react-native/Libraries/Blob/URL')

const NodeURL = globalThis.URL
const onDevice = () => {
  globalThis.URL = DeviceURL as typeof URL
}
afterEach(() => {
  globalThis.URL = NodeURL
  setSharedConnectEnabled(false)
})

const ME =
  'did:peer:2.Ez6LSqnPsQ1h1ZeJL4T5UojRfbiUMVTqnJ8M3yY9HHriE5tDx.Vz6MknXiLdXEHE9n8JM8x1dmkqucrVVZrYFFZFEoFa1He4FEs'
const ENACTMENT = 'OQyt0-RiESmbfGEqFQ0bpw'
const EXP = 1794053710

describe("the phone's URL (the control: without it nothing here could fail)", () => {
  test('React Native gives a path a trailing slash that Node does not', () => {
    const flow = 'https://link.trustoverip.org/vti/flow/shared-connect'
    expect(new NodeURL(flow).pathname).toBe('/vti/flow/shared-connect')
    expect(new DeviceURL(flow).pathname).toBe('/vti/flow/shared-connect/')
  })
})

describe('the code Keyring shows, built on a phone', () => {
  test.each([
    ['Node', () => undefined],
    ['React Native', onDevice],
  ])('under %s, `_type` is exactly /vti/flow/shared-connect/0.1', (_, install) => {
    install()
    expect(buildSharedConnectLink({ from: ME, id: ENACTMENT, exp: EXP })).toBe(
      `https://link.trustoverip.org/t#_from=${ME}&_id=${ENACTMENT}&_exp=${EXP}&_type=/vti/flow/shared-connect/0.1`
    )
  })

  test("and Keyring's own reader, also on the phone, takes it as shared-connect", () => {
    onDevice()
    setSharedConnectEnabled(true)
    const read = readTrigger(buildSharedConnectLink({ from: ME, id: ENACTMENT, exp: EXP }), {
      channel: 'scan',
      now: EXP - 300,
    })
    expect(read).toMatchObject({ outcome: 'accept', flow: 'shared-connect', from: ME, id: ENACTMENT, exp: EXP })
  })
})

describe('reading a trigger link on a phone: every conformance vector', () => {
  const config = file.config as unknown as TriggerConfig
  it.each(file.vectors.map((v) => [v.id, v] as const))('%s', (_, vector) => {
    onDevice()
    expect(readTrigger(vector.input, { channel: vector.channel as TriggerChannel, config })).toEqual(vector.expect)
  })
})
