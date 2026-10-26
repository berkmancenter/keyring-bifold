/**
 * DO NOT MERGE. A test environment for one-off detector runs over the whole suite.
 *
 * KEYRING_DETECTOR=slow  every mocked async result (a jest.fn implementation that returns a promise, or
 *                        mockResolvedValue/RejectedValue) settles 1.2 s later, on a real timer: tests that read
 *                        post-read state on waitFor's 1 s default fail. Reported: failing tests that made such calls.
 * KEYRING_DETECTOR=hang  every mocked async result never settles: a test that still passes with its reads hanging
 *                        does not depend on them. Reported: passing tests that made such calls.
 * KEYRING_DETECTOR=refusal  nothing is wrapped; the chat refusal points log (see the probe commit).
 */
const Base = require(require.resolve('react-native/jest/react-native-env.js'))
const BaseEnv = Base.default ?? Base

const MODE = process.env.KEYRING_DETECTOR
// 1200 by default (past waitFor's 1 s); a small value separates tests coupled to promise order from time-budget waits.
const DELAY_MS = Number(process.env.KEYRING_DETECTOR_DELAY_MS || 1200)

class DetectorEnv extends BaseEnv {
  constructor(config, context) {
    super(config, context)
    this.testPath = context.testPath
    this.asyncCalls = 0
    if (MODE !== 'slow' && MODE !== 'hang') return
    const G = this.global
    const realSetTimeout = G.setTimeout // captured before any test installs fake timers
    const settle = (value) =>
      MODE === 'hang'
        ? new G.Promise(() => undefined)
        : new G.Promise((resolve, reject) => realSetTimeout(() => G.Promise.resolve(value).then(resolve, reject), DELAY_MS))
    const env = this
    const wrap = (impl) =>
      typeof impl !== 'function' || impl.__detector
        ? impl
        : Object.assign(
            function (...args) {
              const result = impl.apply(this, args)
              if (result && typeof result.then === 'function') {
                env.asyncCalls += 1
                return settle(result)
              }
              return result
            },
            { __detector: true }
          )
    const patch = (m) => {
      if (!m || m.__detectorPatched) return m
      m.__detectorPatched = true
      for (const name of ['mockImplementation', 'mockImplementationOnce']) {
        const original = m[name].bind(m)
        m[name] = (impl) => original(wrap(impl))
      }
      m.mockResolvedValue = (v) => m.mockImplementation(() => G.Promise.resolve(v))
      m.mockResolvedValueOnce = (v) => m.mockImplementationOnce(() => G.Promise.resolve(v))
      m.mockRejectedValue = (v) => m.mockImplementation(() => G.Promise.reject(v))
      m.mockRejectedValueOnce = (v) => m.mockImplementationOnce(() => G.Promise.reject(v))
      return m
    }
    const mm = this.moduleMocker
    const fn = mm.fn.bind(mm)
    mm.fn = (impl) => patch(fn(wrap(impl)))
    const spyOn = mm.spyOn.bind(mm)
    mm.spyOn = (...args) => patch(spyOn(...args))
  }

  async handleTestEvent(event, state) {
    if (super.handleTestEvent) await super.handleTestEvent(event, state)
    if (!MODE) return
    if (event.name === 'test_start') this.asyncCalls = 0
    if (event.name !== 'test_done') return
    const names = []
    for (let block = event.test; block && block.name !== 'ROOT_DESCRIBE_BLOCK'; block = block.parent) names.unshift(block.name)
    const failed = event.test.errors.length > 0
    const timedOut = failed && String(event.test.errors[0]?.[0]?.message ?? event.test.errors[0]).includes('Exceeded timeout')
    const where = `${this.testPath.replace(/^.*\/packages\/core\//, '')} › ${names.join(' › ')}`
    if (MODE === 'slow' && failed && this.asyncCalls > 0)
      process.stdout.write(`DETECTOR-SLOW-FAIL ${timedOut ? '[timeout] ' : ''}${where} (async mocks: ${this.asyncCalls})\n`)
    if (MODE === 'hang' && !failed && this.asyncCalls > 0)
      process.stdout.write(`DETECTOR-HANG-PASS ${where} (async mocks: ${this.asyncCalls})\n`)
  }
}

module.exports = DetectorEnv
