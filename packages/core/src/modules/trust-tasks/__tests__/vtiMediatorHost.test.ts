/**
 * The mediator's host in the transport's log lines: a tester's 277.4 log (11-02) said "socket for … on  closed",
 * because React Native's URL finds a host only in http(s) addresses and a mediator's socket is wss://.
 */
import { endpointHost } from '../module/VtiMediatorTransport'

describe("a mediator endpoint's host, for the log", () => {
  it('reads the host of a wss:// socket, as of an https:// one', () => {
    expect(endpointHost('wss://mediator.firstperson.dev/mediator/v1/ws')).toBe('mediator.firstperson.dev')
    expect(endpointHost('https://mediator.firstperson.dev/mediator/v1/authenticate')).toBe('mediator.firstperson.dev')
    expect(endpointHost('ws://10.0.2.2:3010')).toBe('10.0.2.2:3010')
    expect(endpointHost('wss://m.example?x=1')).toBe('m.example')
  })

  it("does not lean on URL, whose React Native build finds no host in a wss:// address (control: Node's does)", () => {
    const NodeURL = global.URL
    // React Native 0.81's URL (Libraries/Blob/URL.js): a host only for http(s).
    class NativeURL {
      host: string
      constructor(url: string) {
        this.host = /^https?:\/\/([^/?#]+)/.exec(url)?.[1] ?? ''
      }
    }
    expect(new NodeURL('wss://m.example/ws').host).toBe('m.example')
    global.URL = NativeURL as unknown as typeof URL
    try {
      expect(new URL('wss://m.example/ws').host).toBe('')
      expect(endpointHost('wss://m.example/ws')).toBe('m.example')
    } finally {
      global.URL = NodeURL
    }
  })

  it('gives none for what has no host, so the caller says the mediator by its DID', () => {
    expect(endpointHost(undefined)).toBeUndefined()
    expect(endpointHost('')).toBeUndefined()
    expect(endpointHost('not a url')).toBeUndefined()
  })
})
