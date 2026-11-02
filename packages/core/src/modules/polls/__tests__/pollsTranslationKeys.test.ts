/**
 * No raw key on a polls screen: every literal `Polls.*` key the polls module asks for exists in English. fr and pt-BR
 * fall back to English until a human reader has translated them (Community Polls mock, open for the build).
 */
import fs from 'fs'
import path from 'path'

import en from '../../../localization/en/en.json'

const ROOT = path.join(__dirname, '..')
const KEY = /['"](Polls\.[A-Za-z0-9]+)['"]/g

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

const polls = (en as unknown as { Polls: Record<string, string> }).Polls
const has = (key: string) => {
  const leaf = key.slice('Polls.'.length)
  return typeof polls[leaf] === 'string' || typeof polls[`${leaf}_one`] === 'string'
}

test('every Polls key the polls module uses exists in English', () => {
  const used = new Set(sources(ROOT).flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(KEY)].map((m) => m[1])))
  expect(used.size).toBeGreaterThan(40)
  expect([...used].filter((key) => !has(key))).toEqual([])
})
