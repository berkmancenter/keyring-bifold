/** The testIDs of the SharedConnect screen: the contract the e2e drivers and the tests hold against. Add, never rename. */
export const SharedConnectIds = {
  screen: 'SharedConnect',
  // 1. Confirm, before anything is sent.
  confirm: 'SharedConnectConfirm',
  name: 'SharedConnectName',
  nameUnverified: 'SharedConnectNameUnverified',
  // The inviter's DID: a short prefix, the whole of it behind Details (`SharedConnectDid…`).
  did: 'SharedConnectDid',
  relay: 'SharedConnectRelay',
  expires: 'SharedConnectExpires',
  connect: 'SharedConnectConnect',
  cancel: 'SharedConnectCancel',
  // 2. After Connect.
  connecting: 'SharedConnectConnecting',
  // 3. How it ended, or why the code can't be used.
  result: 'SharedConnectResult',
  resultMessage: 'SharedConnectResultMessage',
  done: 'SharedConnectDone',
} as const
