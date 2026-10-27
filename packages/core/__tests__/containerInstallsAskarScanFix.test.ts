/**
 * MainContainer.init() installs the Askar scan fix whether or not the container was given a logger. In OTA 1 the
 * installer ran inside the log call's arguments, `this.log?.info(...)`, so a container built without a logger never
 * installed it and nothing said so.
 */
import { Scan } from '@openwallet-foundation/askar-shared'
import { container } from 'tsyringe'

import { MainContainer } from '../src/container-impl'

jest.mock('react-native-fs', () => ({
  CachesDirectoryPath: '/caches',
  readDir: jest.fn(async () => []),
  unlink: jest.fn(async () => undefined),
}))

test('a container with no logger still installs the fix, and a later one logs that it is there', () => {
  const unpatched = Scan.prototype.forEachRow
  new MainContainer(container.createChildContainer()).init()
  expect(Scan.prototype.forEachRow).not.toBe(unpatched)

  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
  new MainContainer(container.createChildContainer(), log as never).init()
  expect(log.info).toHaveBeenCalledWith('Askar scan list free: already')
})
