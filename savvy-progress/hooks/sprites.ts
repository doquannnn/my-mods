// Pixel-art icons for the pane on surfaces that draw `Svg` (desktop, editor,
// mobile). Original drawings: a small robot per subagent and a terminal
// window per shell command. Each sprite is a grid of letters, one per pixel,
// mapped to colors by a palette; '.' is transparent.

import type { AgentStatus, ShellStatus } from '../types'

type Palette = Record<string, string>

const ROBOT_BODY = [
  '.....aa.....',
  '......k.....',
  '..bbbbbbbb..',
  '.bbbbbbbbbb.',
  '.bEEEbbEEEb.',
  '.bEEEbbEEEb.',
  '.bbbbbbbbbb.',
  '.bbbMMMMbbb.',
  'kbbbbbbbbbbk',
  '..bbbbbbbb..',
  '..kk....kk..',
]

// Eyes and mouth per status, drawn over rows 4, 5 and 7 of the body.
const FACES: Record<AgentStatus, { eyes: [string, string]; mouth: string }> = {
  starting: { eyes: ['wwk', 'wwk'], mouth: 'bbbb' },
  running: { eyes: ['wwk', 'wwk'], mouth: 'kkkk' },
  done: { eyes: ['bkb', 'kbk'], mouth: 'kkkk' },
  failed: { eyes: ['kbk', 'bkb'], mouth: 'bkkb' },
}

const TERMINAL = [
  'kkkkkkkkkkkk',
  'krryyggkkkkk',
  'kkkkkkkkkkkk',
  'kddddddddddk',
  'kdPddddddddk',
  'kddPdddddddk',
  'kdPddddddddk',
  'kdddddUUUddk',
  'kddddddddddk',
  'kkkkkkkkkkkk',
]

const MODEL_COLORS: Array<[RegExp, string]> = [
  [/fable/i, '#9b6bd6'],
  [/opus/i, '#d97757'],
  [/sonnet/i, '#5b8def'],
  [/haiku/i, '#3fae7f'],
]

const ACCENTS = ['#f2c94c', '#56ccf2', '#eb5757', '#bb6bd9', '#6fcf97', '#f2994a']

const STATUS_COLORS: Record<string, string> = {
  running: '#56ccf2',
  starting: '#56ccf2',
  background: '#f2c94c',
  done: '#6fcf97',
  failed: '#eb5757',
  denied: '#9aa0a6',
  stopped: '#9aa0a6',
}

export function robotSvg(model: string, type: string, status: AgentStatus): string {
  const body = MODEL_COLORS.find(([re]) => re.test(model))?.[1] ?? '#8a8f98'
  const face = FACES[status]
  const rows = ROBOT_BODY.map((row, y) => {
    if (y === 4 || y === 5) {
      const eye = face.eyes[y - 4]
      return `${row.slice(0, 2)}${eye}bb${eye}${row.slice(10)}`
    }
    if (y === 7) return `${row.slice(0, 4)}${face.mouth}${row.slice(8)}`
    return row
  })
  return draw(rows, {
    a: ACCENTS[hash(type) % ACCENTS.length] ?? '#f2c94c',
    k: '#2b2b2b',
    b: body,
    w: '#ffffff',
  })
}

export function shellSvg(status: ShellStatus): string {
  return draw(TERMINAL, {
    k: '#3c3f44',
    r: '#ff5f57',
    y: '#febc2e',
    g: '#28c840',
    d: '#1e1f22',
    P: STATUS_COLORS[status] ?? '#9aa0a6',
    U: STATUS_COLORS[status] ?? '#9aa0a6',
  })
}

function draw(rows: readonly string[], palette: Palette): string {
  const width = Math.max(...rows.map(r => r.length))
  const height = rows.length
  const size = Math.max(width, height)
  const dx = Math.floor((size - width) / 2)
  const dy = Math.floor((size - height) / 2)
  let rects = ''
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const fill = palette[row[x] ?? '.']
      if (fill) rects += `<rect x="${x + dx}" y="${y + dy}" width="1" height="1" fill="${fill}"/>`
    }
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">${rects}</svg>`
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}
