/**
 * Every screen shows and counts the agent's requests through `shownApprovals` (or `waitingRequests`, which uses it),
 * so a request from someone else's agent never shows while the trusted-approvers switch is off. A screen that read
 * `state.approvals` directly would show one: the rows for each screen prove that screen today, this one fails the
 * moment any screen, now or added later, writes the direct read.
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')
const DIRS = ['screens', 'components']
const THROUGH = /(shownApprovals|waitingRequests)\(\s*$/

const reads = DIRS.flatMap((dir) =>
  readdirSync(join(ROOT, dir))
    .filter((file) => file.endsWith('.tsx') || file.endsWith('.ts'))
    .flatMap((file) => {
      const text = readFileSync(join(ROOT, dir, file), 'utf8')
      return [...text.matchAll(/\b[\w.]+\.approvals\b/g)].map((m) => ({
        at: `${dir}/${file}:${text.slice(0, m.index).split('\n').length}`,
        through: THROUGH.test(text.slice(0, m.index)),
      }))
    })
)

describe('the requests a screen shows', () => {
  it('are read only through shownApprovals or waitingRequests, in every screen and component', () => {
    // Too few found means the scan stopped looking, not that the rule holds.
    expect(reads.length).toBeGreaterThanOrEqual(5)
    expect(reads.filter((read) => !read.through).map((read) => read.at)).toEqual([])
  })
})
