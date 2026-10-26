/**
 * Minting a persona asks `vta/webvh/dids/create` at 1.1 first, which every VTA in use serves (vta-service v0.49.0 on),
 * and steps down to 1.0 only when the agent says it does not serve 1.1. 1.0 is withdrawn in the 2027-01-01 batch.
 */
import Ajv from 'ajv/dist/2020'
import { PAYLOAD_SCHEMA as CREATE_1_1 } from '@openvtc/trust-tasks/vta/webvh/dids/create/1.1/payload'

import { MINT_TIMEOUT_MS, VTA_TASK, VtaClient } from '../module/VtaClient'
import { VtiRefusal } from '../module/vtiAgent'

jest.mock('react-native-keychain', () => ({ ACCESS_CONTROL: {}, ACCESSIBLE: {}, STORAGE_TYPE: {} }))

const logger = { info: jest.fn(), warn: jest.fn() }
const MINTED = {
  did: 'did:webvh:QmMinted:dids.example:x',
  contextId: 'vta',
  scid: 'Qm',
  signingKeyId: 's',
  kaKeyId: 'k',
}
const client = () => new VtaClient({ config: { logger } } as never, 'did:webvh:agent', {} as never, {})

beforeEach(() => logger.info.mockClear())

describe('minting a persona', () => {
  it("asks 1.1 first, in a payload 1.1's own schema accepts, and logs the version", async () => {
    const vta = client()
    const task = jest.spyOn(vta, 'task').mockResolvedValueOnce(MINTED)
    await expect(vta.mintPersona({ contextId: 'vta', serverId: 'control', label: 'keyring-x' })).resolves.toBe(MINTED)
    const [type, payload, timeout] = task.mock.calls[0]
    expect(type).toBe(VTA_TASK.didsCreate11)
    expect(timeout).toBe(MINT_TIMEOUT_MS)
    const valid = new Ajv({ strict: false, allErrors: true, logger: false }).compile(CREATE_1_1 as object)
    expect(valid(payload)).toBe(true)
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`didsCreate answered in ${VTA_TASK.didsCreate11}`))
  })

  it('steps down to 1.0 on a version refusal, with the same payload and idempotency key', async () => {
    const vta = client()
    const task = jest
      .spyOn(vta, 'task')
      .mockRejectedValueOnce(new VtiRefusal('unsupportedVersion', 'no', { servedVersions: [VTA_TASK.didsCreate] }))
      .mockResolvedValueOnce(MINTED)
    await vta.mintPersona({ contextId: 'vta', serverId: 'control', idempotencyKey: 'key-1' })
    expect(task.mock.calls.map((c) => c[0])).toEqual([VTA_TASK.didsCreate11, VTA_TASK.didsCreate])
    expect(task.mock.calls[1][1]).toEqual(task.mock.calls[0][1])
    expect(task.mock.calls.map((c) => c[3])).toEqual([{ idempotencyKey: 'key-1' }, { idempotencyKey: 'key-1' }])
  })

  it('never mints again in another version when the refusal is about the request itself', async () => {
    const vta = client()
    const task = jest.spyOn(vta, 'task').mockRejectedValueOnce(new VtiRefusal('forbidden', 'no context'))
    await expect(vta.mintPersona({ contextId: 'vta', serverId: 'control' })).rejects.toThrow(/no context/)
    expect(task).toHaveBeenCalledTimes(1)
  })
})

describe('the version log', () => {
  it('a VTA client whose agent has no logger still mints (the version log is optional)', async () => {
    const vta = new VtaClient({} as never, 'did:webvh:agent', {} as never, {})
    jest.spyOn(vta, 'task').mockResolvedValueOnce(MINTED)
    await expect(vta.mintPersona({ contextId: 'vta', serverId: 'control' })).resolves.toBe(MINTED)
  })
})
