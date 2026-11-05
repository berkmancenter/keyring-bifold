/**
 * TEST BUILDS ONLY, for the device run of bifold #924: every private application this phone
 * created, kept apart from the real records, so a tester can ask the agent about one after
 * the app has closed it (a closed note keeps no handle, by design). Nothing here runs in a
 * build without E2E_CLOCKS, and nothing here is logged: the handle stays on the screen.
 *
 * This branch is never merged.
 *
 * @module trust-tasks/module/hiddenVettingProbe
 */
import type { Agent } from '@credo-ts/core'

import { e2eClocksSet } from '../../../utils/e2eClocks'

import { getKeyed, listKeyed, putKeyed } from './keyedRecords'
import { pcsErrorCode } from './pcsVtaPayloads'
import { vtaAgent } from './vtaAgent'

const RECORD_TYPE = 'keyring/hidden-vetting-probe'
const KIND = 'application'

export interface HiddenApplicationProbe {
  applicationId: string
  community: string
  joinDid: string
  vtaDid?: string
  createdAt: string
  /** The app's own last attempt to delete it: `ok`, `notFound`, or the failure. */
  deleteOutcome?: string
  deleteAt?: string
}

export async function recordProbe(agent: Agent, probe: Omit<HiddenApplicationProbe, 'createdAt'>): Promise<void> {
  if (!e2eClocksSet()) return
  await putKeyed(agent, RECORD_TYPE, KIND, probe.applicationId, {
    ...probe,
    createdAt: new Date().toISOString(),
  } as unknown as Record<string, unknown>)
}

export async function noteDeleteOutcome(agent: Agent | undefined, applicationId: string, outcome: string) {
  if (!agent || !e2eClocksSet()) return
  const held = await getKeyed<HiddenApplicationProbe>(agent, RECORD_TYPE, KIND, applicationId)
  if (!held) return
  await putKeyed(agent, RECORD_TYPE, KIND, applicationId, {
    ...held,
    deleteOutcome: outcome,
    deleteAt: new Date().toISOString(),
  } as unknown as Record<string, unknown>)
}

export async function listProbes(agent: Agent): Promise<HiddenApplicationProbe[]> {
  if (!e2eClocksSet()) return []
  return (await listKeyed<HiddenApplicationProbe>(agent, RECORD_TYPE, KIND)).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  )
}

/**
 * `vta/pcs/applications/show`, as this phone, at the agent that holds the application. The
 * raw answer: found with what it holds, or the refusal code, or the error. A timeout reads
 * as an error, never as `notFound`.
 */
export async function askAgent(agent: Agent, probe: HiddenApplicationProbe): Promise<string> {
  const vtaDid = probe.vtaDid ?? vtaAgent.agentAddress()
  if (!vtaDid) return 'no agent to ask'
  try {
    await vtaAgent.connect(agent, vtaDid)
    const application = await vtaAgent.client(agent, vtaDid).showPcsApplication(probe.applicationId)
    if (!application) return 'answered with no application (not a refusal)'
    return `FOUND: ${Array.isArray(application.attestations) ? application.attestations.length : 0} attestation(s)`
  } catch (error) {
    const code = pcsErrorCode((error as { document?: unknown })?.document ?? error)
    if (code) return `REFUSED: ${code}`
    return `ERROR (not an answer): ${error instanceof Error ? error.message : String(error)}`
  }
}
