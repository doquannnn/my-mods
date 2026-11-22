import type { ThemeColors } from 'claude-code'

import { makeColors } from './make-colors.js'
import type { Palette, Skin } from './skin'

// A skin's palette, turned into the app's theme colours.

type Rgb = readonly [number, number, number]

const toRgb = (hex: string): Rgb => {
  const n = Number.parseInt(hex.slice(1), 16)

  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const toHex = ([r, g, b]: Rgb): string =>
  '#' + [r, g, b].map(c => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')

// `amount` of the way from `a` to `b`.
export const mix = (a: string, b: string, amount: number): string => {
  const x = toRgb(a)
  const y = toRgb(b)

  return toHex([0, 1, 2].map(i => x[i]! + (y[i]! - x[i]!) * amount) as unknown as Rgb)
}

export const lightness = (hex: string): number => {
  const [r, g, b] = toRgb(hex)

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const sorted = (a: string, b: string): [string, string] =>
  lightness(a) <= lightness(b) ? [a, b] : [b, a]

// How far `skinColors` has lifted the skin's text toward full contrast: 0 is the skin as written.
type Step = number

const STEPS = 10

const lift = (p: Palette, step: Step, toward: string) => {
  const t = step / STEPS
  const fg = mix(p.fg, toward, t * 0.5)
  const muted = mix(p.muted, fg, t * 0.8)

  return { fg, muted, secondary: mix(fg, muted, 0.4) }
}

// Surfaces darkest first: the skin's two backgrounds are the cards, the page a step below them.
const darkAnchors = (p: Palette, step: Step) => {
  // A light dark skin (Nord) also has its surfaces sunk a little, so coloured text reads on them.
  const sink = (hex: string) => mix(hex, '#000000', (step / STEPS) * 0.35)
  const [low, high] = sorted(sink(p.surface), sink(p.zebra))
  const text = lift(p, step, '#ffffff')

  return {
    'surface-0': mix(low, '#000000', 0.25),
    'surface-1': low,
    'surface-2': high,
    'surface-3': high,
    'text-primary': text.fg,
    'text-secondary': text.secondary,
    'text-muted': text.muted,
  }
}

// In light mode the page is the darkest surface too, and panels and menus match.
const lightAnchors = (p: Palette, step: Step) => {
  const [low, high] = sorted(p.surface, p.zebra)
  const top = mix(high, '#ffffff', 0.5)
  const text = lift(p, step, '#000000')

  return {
    'surface-0': low,
    'surface-1': high,
    'surface-2': top,
    'surface-3': top,
    'text-primary': text.fg,
    'text-secondary': text.secondary,
    'text-muted': text.muted,
  }
}

type RoleName = 'accent' | 'danger' | 'success' | 'warning' | 'pro'

const roles = (p: Palette, without: ReadonlySet<RoleName>) => {
  const all: Record<RoleName, string> = {
    accent: p.user,
    danger: p.err,
    success: p.ok,
    warning: p.warn,
    pro: p.search,
  }

  return Object.fromEntries(Object.entries(all).filter(([role]) => !without.has(role as RoleName)))
}

const build = (skin: Skin, step: Step, without: ReadonlySet<RoleName> = new Set()) =>
  makeColors({
    label: skin.label,
    id: `skin-${skin.name}`,
    dark: { gray: { anchors: darkAnchors(skin.palette, step) }, roles: roles(skin.palette, without) },
    ...(skin.light === undefined
      ? { only: 'dark' as const }
      : {
          light: {
            gray: { anchors: lightAnchors(skin.light, step) },
            roles: roles(skin.light, without),
          },
        }),
  })

export const isUnpainted = (line: string): boolean => line.startsWith("Desktop won't paint")

// The skin's colours as close to as written as Desktop will still paint: the text is lifted
// toward full contrast one step at a time, only as far as needed. `step` says how far it went.
export const skinColors = (skin: Skin): { theme: ThemeColors; problems: string[]; step: Step } => {
  let made = build(skin, 0)
  let step = 0

  while (made.problems.some(isUnpainted) && step < STEPS) {
    step += 1
    made = build(skin, step)
  }

  // Still refused over a role's own text (Nord's and Everforest's pale greens): that role keeps
  // the app's colour, the rest of the skin stays.
  const refused = new Set(
    made.problems
      .filter(isUnpainted)
      .map(line => /text-(accent|danger|success|warning|pro) on/.exec(line)?.[1])
      .filter((role): role is RoleName => role !== undefined),
  )

  if (refused.size > 0) {
    made = build(skin, step, refused)
  }

  return { ...made, step }
}
