import type { CardAsk } from '../module/vtiJoin'

/**
 * The line for what Check again's ask for the card came to (IN-617): none when
 * it was not needed (the community holds the acknowledgement) or is not
 * supported, which says nothing a person can act on.
 */
export const cardAskKey = (ask: CardAsk | undefined): string | undefined => {
  if (ask?.resend === 'queued') return 'Join.CardAskedAgain'
  if (ask?.resend === 'rateLimited') return ask.retryAfter ? 'Join.CardAskedRecently' : 'Join.CardAskStopped'
  return undefined
}
