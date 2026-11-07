/**
 * What the rooms backend hands the agent's client for a task. A batch read's wait and its refusal to sit waiting for
 * consent only mean something if they reach the client's own arguments.
 */
const mockTask = jest.fn(async (..._args: unknown[]) => ({}))

jest.mock('../../trust-tasks/module/vtaAgent', () => ({
  vtaAgent: { roomsClient: async () => ({ task: mockTask }), agentAddress: () => 'did:key:agent' },
}))
jest.mock('../../trust-tasks/module/vtiAgent', () => ({ vtiAgent: {}, VtiRefusal: class extends Error {} }))
jest.mock('../../trust-tasks/module/vtiJoin', () => ({ leaveCommunity: jest.fn() }))
jest.mock('../../trust-tasks/module/keyedRecords', () => ({ listKeyed: jest.fn(), putKeyed: jest.fn() }))
jest.mock('../../trust-tasks/module/VtiIdentityStore', () => ({ GenericRecordsIdentityStore: class {} }))
jest.mock('../../trust-tasks/module/VtiCommunityStore', () => ({ GenericRecordsCommunityStore: class {} }))
jest.mock('../../trust-tasks/module/vtiVetting', () => ({ GenericRecordsVettingStore: class {} }))
jest.mock('../../trust-tasks/module/vtiTsp', () => ({ GenericRecordsTspPeerRevisionStore: class {} }))
jest.mock('../roomsLeave', () => ({ afterLeavingCommunity: jest.fn() }))

import { createAgentRoomsBackend } from '../real/agentRoomsBackend'

const agent = { config: { logger: { warn: jest.fn() } } } as never

describe('agentTask', () => {
  beforeEach(() => mockTask.mockClear())

  test('a timeout and waitForConsent reach the client where it reads them', async () => {
    await createAgentRoomsBackend(agent).agentTask('t', { a: 1 }, { timeoutMs: 60000, waitForConsent: false })
    expect(mockTask).toHaveBeenCalledWith('t', { a: 1 }, 60000, undefined, undefined, { waitForConsent: false })
  })

  test("a task with no options keeps the client's own defaults (control)", async () => {
    await createAgentRoomsBackend(agent).agentTask('t', { a: 1 })
    expect(mockTask).toHaveBeenCalledWith('t', { a: 1 }, undefined, undefined, undefined, undefined)
  })
})
