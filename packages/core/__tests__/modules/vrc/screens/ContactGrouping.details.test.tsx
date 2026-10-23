/**
 * A contact's screen covers every relationship linked to it: the cards of all of them, newest first, while the DID it
 * shows (and messages, upgrade, removal) stay on the relationship the row opened. Unlinked, the same store shows that
 * relationship's cards only, which is the positive control.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { container } from 'tsyringe'
import { useAgent } from '@bifold/react-hooks'

import ContactDetails from '../../../../src/modules/vrc/screens/ContactDetails'
import { ContainerProvider } from '../../../../src/container-api'
import { MainContainer } from '../../../../src/container-impl'
import { useOpenIDCredentials } from '../../../../src/modules/openid/context/OpenIDCredentialRecordProvider'
import { testIdWithKey } from '../../../../src/utils/testable'
import { ALICE_AGAIN, ALICE_FIRST, SEVERAL_RELATIONSHIPS } from '../fixtures/severalRelationships'

jest.mock('@bifold/react-hooks')
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon')
jest.mock('../../../../src/modules/openid/context/OpenIDCredentialRecordProvider')
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), getParent: jest.fn() }),
}))

const mockUseAgent = useAgent as jest.MockedFunction<typeof useAgent>
const mockUseOpenIDCredentials = useOpenIDCredentials as jest.MockedFunction<typeof useOpenIDCredentials>

const Container: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ContainerProvider value={new MainContainer(container.createChildContainer()).init()}>{children}</ContainerProvider>
)

const findRelationship = jest.fn(async () => null)
const withLinks = (links: { issuerDid: string; contactId: string }[]) =>
  mockUseAgent.mockReturnValue({
    agent: {
      config: { logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
      dependencyManager: { resolve: () => ({ findByCounterpartyRelationshipDid: findRelationship }) },
      genericRecords: { findAllByQuery: async () => links.map((content) => ({ content })) },
    },
  } as any)

const openAliceAgain = () =>
  render(<ContactDetails route={{ params: { contact: { issuer: ALICE_AGAIN } } } as any} navigation={{} as any} />, {
    wrapper: Container,
  })

describe("a contact's screen grouped by contact", () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => null)
    findRelationship.mockClear()
    mockUseOpenIDCredentials.mockReturnValue({ openIdState: { w3cCredentialRecords: SEVERAL_RELATIONSHIPS } } as any)
  })
  afterEach(() => jest.restoreAllMocks())

  test('unlinked: the one card of this relationship', async () => {
    withLinks([])
    const tree = openAliceAgain()
    await waitFor(() => expect(tree.getAllByTestId(testIdWithKey('RelationshipLayer'))).toHaveLength(1))
  })

  test('linked: the cards of both relationships, and the DID and connection of the one the row opened', async () => {
    withLinks([{ issuerDid: ALICE_AGAIN.id, contactId: ALICE_FIRST.id }])
    const tree = openAliceAgain()
    await waitFor(() => expect(tree.getAllByTestId(testIdWithKey('RelationshipLayer'))).toHaveLength(3))
    fireEvent.press(tree.getByTestId(testIdWithKey('ContactRelationshipToggle')))
    expect(tree.getByText(ALICE_AGAIN.id)).toBeTruthy()
    expect(tree.queryByText(ALICE_FIRST.id)).toBeNull()
    expect(findRelationship).toHaveBeenCalledWith(undefined, ALICE_AGAIN.id)
    expect(findRelationship).not.toHaveBeenCalledWith(undefined, ALICE_FIRST.id)
  })
})
