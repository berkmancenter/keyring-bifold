/**
 * IN-452: with no BiometricConfirmationProvider mounted, nothing can ask the person, so the step stops. It used to
 * answer 'not_available', which the confirm step read as success: the action went ahead unasked.
 */
import { requestBiometricConfirmationUI } from '../../../src/contexts/biometric-confirmation'

describe('a confirm asked with no provider mounted', () => {
  it('answers an error, never a pass', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const response = await requestBiometricConfirmationUI('Keyring Lab Community', 'join', false, 'keyringPin')
    expect(response.status).toBe('error')
    expect(response.error).toMatch(/not mounted/)
    warn.mockRestore()
  })
})
