// PROBE (throwaway, switch-miss 234): never merged.
import { findNodeHandle, type LayoutChangeEvent } from 'react-native'

import { releaseWarn } from './releaseLog'

type Measurable = { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void }

/** onLayout that logs where a view sits on screen, in window dp, with its native tag. */
export const probeLayout = (name: string) => (e: LayoutChangeEvent) => {
  const target = e.currentTarget as unknown as Measurable
  let tag: number | null = null
  try {
    tag = findNodeHandle(e.currentTarget as never)
  } catch {
    tag = null
  }
  const { x, y, width, height } = e.nativeEvent.layout
  releaseWarn(
    `[PROBE] layout ${name} tag=${tag} local=${Math.round(x)},${Math.round(y)} ${Math.round(width)}x${Math.round(height)}`
  )
  target.measureInWindow?.((wx, wy, ww, wh) =>
    releaseWarn(
      `[PROBE] window ${name} tag=${tag} ${Math.round(wx)},${Math.round(wy)} ${Math.round(ww)}x${Math.round(wh)}`
    )
  )
}
