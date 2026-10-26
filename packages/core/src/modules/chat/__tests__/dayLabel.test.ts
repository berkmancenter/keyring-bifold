/**
 * A chat day's words: Today, Yesterday, the weekday within the week, then the date with the year only when it
 * is not this year; counted on calendar days in the phone's zone, in the app's language.
 *
 * What these tests prove: which branch a date takes, and which locale it asks for. They run on Node, which has
 * full ICU, so "mercredi" and "quarta-feira" here say nothing about what Hermes prints in a release build: a
 * Hermes without the locale data falls back to English without throwing. That is the simulator check's job
 * (release build, each language, dates two or more days old).
 */
import type { TFunction } from 'i18next'

import { dayLabel, daysAgo, timeLabel } from '../dayLabel'

const t = ((key: string) => key) as unknown as TFunction
// Saturday 25 October 2026, 09:00 local.
const now = new Date(2026, 9, 25, 9, 0)

describe('a chat day', () => {
  test('today and yesterday are words, counted on calendar days, not 24-hour spans', () => {
    expect(dayLabel(new Date(2026, 9, 25, 0, 5), t, 'en', now)).toBe('Chat.Today')
    // 23:50 the day before is 9 hours ago, and still yesterday.
    expect(dayLabel(new Date(2026, 9, 24, 23, 50), t, 'en', now)).toBe('Chat.Yesterday')
    expect(daysAgo(new Date(2026, 9, 24, 23, 50), now)).toBe(1)
  })

  test('within the past week: the weekday, in the app language', () => {
    const wednesday = new Date(2026, 9, 21, 15, 0)
    expect(dayLabel(wednesday, t, 'en', now)).toBe('Wednesday')
    expect(dayLabel(wednesday, t, 'fr', now)).toBe('mercredi')
    expect(dayLabel(wednesday, t, 'pt-BR', now)).toBe('quarta-feira')
  })

  test('earlier this year: weekday, day and month, no year and no time', () => {
    const label = dayLabel(new Date(2026, 9, 15, 16, 1), t, 'en', now)
    expect(label).toMatch(/Thu/)
    expect(label).toMatch(/15/)
    expect(label).toMatch(/Oct/)
    expect(label).not.toMatch(/2026|4:01|PM/)
  })

  test('another year: the year is said', () => {
    const label = dayLabel(new Date(2025, 11, 31, 10, 0), t, 'en', now)
    expect(label).toMatch(/2025/)
    expect(label).toMatch(/Dec/)
  })

  test('a day ahead (a sender clock up to a day fast is accepted) is a date, never "Today"', () => {
    const label = dayLabel(new Date(2026, 9, 26, 10, 0), t, 'en', now)
    expect(label).not.toBe('Chat.Today')
    expect(label).toMatch(/26/)
    expect(label).toMatch(/Oct/)
  })

  test('a week ago exactly is a date, not a weekday (which would name today)', () => {
    const label = dayLabel(new Date(2026, 9, 18, 9, 0), t, 'en', now)
    expect(label).not.toBe('Saturday')
    expect(label).toMatch(/18/)
  })
})

describe("a message's time", () => {
  const at = new Date(2026, 9, 15, 16, 1)

  test('each language its own clock, and no date', () => {
    expect(timeLabel(at, 'en')).toBe('4:01 PM')
    expect(timeLabel(at, 'fr')).toBe('16:01')
    expect(timeLabel(at, 'pt-BR')).toBe('16:01')
    expect(timeLabel(at, 'en')).not.toMatch(/Oct|15|2026/)
  })
})
