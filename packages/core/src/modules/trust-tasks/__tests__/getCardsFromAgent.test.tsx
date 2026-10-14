/**
 * Manage → "Get your cards from your agent" (226): every identity on this
 * phone asks its agent for the cards it keeps; the person sees a running
 * count, then what came back and, in words, what did not. Since 242 it first
 * takes on the agent's identities this phone lacks, so a new phone is offered
 * it too and gets its communities and their cards back.
 */
import type { Agent } from '@credo-ts/core'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { persona } from '../../../../__tests__/helpers/cardVault'
import { testIdWithKey } from '../../../utils/testable'
import type { VtiPersona } from '../module/VtiIdentityStore'
import {
  bringBackFromAgent,
  GetCardsFromAgent,
  getCardsFromAgent,
  type GetCardsDeps,
} from '../screens/GetCardsFromAgent'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('react-i18next', () => {
  const t = (key: string, values?: Record<string, unknown>) =>
    values
      ? `${key}(${Object.entries(values)
          .map(([k, v]) => `${k}=${v}`)
          .join(',')})`
      : key
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', t, changeLanguage: () => new Promise(() => {}) } }),
    initReactI18next: { type: '3rdParty', init: jest.fn() },
    Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  }
})

const agent = {} as Agent
const second: VtiPersona = {
  ...persona,
  communityDid: 'did:webvh:QmOther:vtc.example:first-vtc',
  did: 'did:webvh:QmP2:x',
}

const deps = (
  answers: Record<
    string,
    'down' | { found: number; restored: string[]; refused: { reason: 'failedCheck' | 'notOurs' | 'unreadable' }[] }
  >,
  adopt: GetCardsDeps['adopt'] = async () => []
): GetCardsDeps => ({
  adopt,
  store: () => ({}) as never,
  taskFor: async (_a, p) => {
    if (answers[p.did] === 'down') throw new Error('no answer')
    return (async () => ({})) as never
  },
  recover: (async (
    _a: Agent,
    _s: unknown,
    p: VtiPersona,
    _t: unknown,
    o: { onProgress?: (x: { found: number; restored: number }) => void }
  ) => {
    const got = answers[p.did] as { found: number; restored: string[]; refused: never[] }
    o.onProgress?.({ found: got.found, restored: 0 })
    o.onProgress?.({ found: got.found, restored: got.restored.length })
    return got
  }) as never,
})

describe('getting the cards back, identity by identity', () => {
  it('adds up across identities, counts one whose agent is down, and goes on with the others', async () => {
    const progress: { found: number; restored: number }[] = []
    const got = await getCardsFromAgent(
      agent,
      [persona, second],
      (p) => progress.push(p),
      deps({
        [persona.did]: { found: 3, restored: ['a', 'b'], refused: [{ reason: 'failedCheck' }] },
        [second.did]: 'down',
      })
    )
    expect(got).toEqual({ found: 3, restored: 2, refused: [{ reason: 'failedCheck' }], unreachable: 1 })
    expect(progress.at(-1)).toEqual({ found: 3, restored: 2 })
  })

  it('the count runs on from one identity to the next', async () => {
    const progress: { found: number; restored: number }[] = []
    await getCardsFromAgent(
      agent,
      [persona, second],
      (p) => progress.push(p),
      deps({
        [persona.did]: { found: 2, restored: ['a', 'b'], refused: [] },
        [second.did]: { found: 1, restored: ['c'], refused: [] },
      })
    )
    expect(progress.at(-1)).toEqual({ found: 3, restored: 3 })
  })
})

describe('the Manage row', () => {
  const renderRow = (personas: VtiPersona[], d: GetCardsDeps, vtaDid?: string) =>
    render(
      <BasicAppContext>
        <GetCardsFromAgent agent={agent} personas={personas} vtaDid={vtaDid} deps={d} />
      </BasicAppContext>
    )

  it('is not offered with no agent linked and no identity', () => {
    const tree = renderRow([], deps({}))
    expect(tree.queryByTestId(testIdWithKey('AgentGetCards'))).toBeNull()
  })

  // 240 gate (cards-back-new-install): a new install held no identity, so it
  // was not offered this at all, and neither card came back.
  it('a new phone with its agent linked: offered, and it brings the communities back, then their cards', async () => {
    const adopt = jest.fn(async () => [persona])
    const d = deps({ [persona.did]: { found: 2, restored: ['m', 'r'], refused: [] } }, adopt)
    const recover = jest.spyOn(d, 'recover')
    const tree = renderRow([], d, persona.vtaDid)
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsButton'))).toBeTruthy()
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('AgentGetCardsButton')))
    })
    expect(adopt).toHaveBeenCalledWith(agent, persona.vtaDid)
    expect(recover.mock.calls.map((c) => (c[2] as VtiPersona).did)).toEqual([persona.did])
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsCommunities'))).toHaveTextContent(
      'VtaLink.CommunitiesBack(count=1)'
    )
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsResult'))).toHaveTextContent(/VtaLink\.CardsBack\(count=2\)/)
  })

  it('a second tap asks again for the cards of the identities the first one took on', async () => {
    let first = true
    const adopt = jest.fn(async () => (first ? ((first = false), [persona]) : []))
    const d = deps({ [persona.did]: { found: 1, restored: ['m'], refused: [] } }, adopt)
    const recover = jest.spyOn(d, 'recover')
    const tree = renderRow([], d, persona.vtaDid)
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        fireEvent.press(tree.getByTestId(testIdWithKey('AgentGetCardsButton')))
      })
    }
    expect(recover).toHaveBeenCalledTimes(2)
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsResult'))).toHaveTextContent(/VtaLink\.CardsBack\(count=1\)/)
  })

  it('a new phone whose agent does not answer is told so, not that there are no cards', async () => {
    const tree = renderRow(
      [],
      deps({}, async () => {
        throw new Error('no answer')
      }),
      persona.vtaDid
    )
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('AgentGetCardsButton')))
    })
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsResult'))).toHaveTextContent('VtaLink.CardsBackUnreachable')
    expect(tree.queryByTestId(testIdWithKey('AgentGetCardsCommunities'))).toBeNull()
  })

  it('an identity already here is asked once, even when the agent names it again', async () => {
    const d = deps({ [persona.did]: { found: 1, restored: ['m'], refused: [] } }, async () => [persona])
    const recover = jest.spyOn(d, 'recover')
    const got = await bringBackFromAgent(agent, persona.vtaDid, [persona], () => undefined, d)
    expect(recover).toHaveBeenCalledTimes(1)
    expect(got).toMatchObject({ restored: 1, adopted: 0, asked: 1 })
  })

  // K7 (Alberto, 10-04): "Get your cards" did not say what it was for. It
  // restores the agent's cards to this phone, and says when to use it.
  it('says it restores from the agent, and when to use it', () => {
    const tree = renderRow([persona], deps({}))
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsButton'))).toHaveTextContent('VtaLink.GetCardsButton')
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsHint'))).toHaveTextContent('VtaLink.GetCardsHint')
  })

  it('says how many came back, and why the others did not, in words', async () => {
    const tree = renderRow(
      [persona],
      deps({
        [persona.did]: { found: 4, restored: ['a', 'b'], refused: [{ reason: 'failedCheck' }, { reason: 'notOurs' }] },
      })
    )
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('AgentGetCardsButton')))
    })
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsResult'))).toHaveTextContent(/VtaLink\.CardsBack\(count=2\)/)
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsRefused_failedCheck'))).toHaveTextContent(
      'VtaLink.CardsBackFailedCheck(count=1)'
    )
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsRefused_notOurs'))).toHaveTextContent(
      'VtaLink.CardsBackNotOurs(count=1)'
    )
    expect(tree.queryByTestId(testIdWithKey('AgentGetCardsRefused_unreadable'))).toBeNull()
  })

  it('an agent that does not answer is said plainly, and the button can be tried again', async () => {
    const tree = renderRow([persona], deps({ [persona.did]: 'down' }))
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('AgentGetCardsButton')))
    })
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsResult'))).toHaveTextContent('VtaLink.CardsBackUnreachable')
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsButton'))).not.toBeDisabled()
  })

  it('nothing kept for these communities is not an error', async () => {
    const tree = renderRow([persona], deps({ [persona.did]: { found: 0, restored: [], refused: [] } }))
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('AgentGetCardsButton')))
    })
    expect(tree.getByTestId(testIdWithKey('AgentGetCardsResult'))).toHaveTextContent('VtaLink.CardsBackNone')
  })
})
