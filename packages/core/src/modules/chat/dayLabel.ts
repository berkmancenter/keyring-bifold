/**
 * The words for one day of a chat, as its day marker shows them: "Today", "Yesterday", the weekday within
 * the past week, then "Wed 15 Oct", with the year once it is not this year. In the app's language (the
 * same one the rest of the screen speaks), from the phone's clock and time zone.
 *
 * One function for the marker in the list and the one that floats while scrolling, so the two never say
 * the same day differently (272 showed "15 October" over "October 15, 2026 4:01 PM").
 *
 * @module chat/dayLabel
 */
import type { TFunction } from 'i18next'

/** Midnight at the start of `date`'s local day. */
const startOfDay = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

/** Whole local days from `date` to `now` (0 today, 1 yesterday). Counted on calendar days, not 24-hour spans. */
export const daysAgo = (date: Date, now: Date): number => Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)

/**
 * @param locale the app's language (`i18n.language`: "en", "fr", "pt-BR"); undefined uses the phone's.
 */
export function dayLabel(date: Date, t: TFunction, locale: string | undefined, now: Date = new Date()): string {
  const ago = daysAgo(date, now)
  if (ago === 0) return t('Chat.Today') as string
  if (ago === 1) return t('Chat.Yesterday') as string
  if (ago > 1 && ago < 7) return date.toLocaleDateString(locale, { weekday: 'long' })
  if (date.getFullYear() === now.getFullYear())
    return date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
}
