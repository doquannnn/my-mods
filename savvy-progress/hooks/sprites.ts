// Character icons for the pane on surfaces that draw `Svg` (desktop, editor,
// mobile): the person's own orange mascot in nine costumes, chosen by the
// agent's type, model and status, with a small status badge in the corner.

import type { AgentStatus, ShellStatus } from '../types'
import { CHARACTERS } from './characters'
import type { Character } from './characters'

const BADGES: Record<AgentStatus | ShellStatus, { color: string; glyph: string }> = {
  starting: { color: '#2d9cdb', glyph: '•' },
  running: { color: '#2d9cdb', glyph: '•' },
  background: { color: '#f2c94c', glyph: '◌' },
  done: { color: '#27ae60', glyph: '✓' },
  failed: { color: '#eb5757', glyph: '✕' },
  denied: { color: '#9aa0a6', glyph: '–' },
  stopped: { color: '#9aa0a6', glyph: '–' },
}

const BY_TYPE: Array<[RegExp, Character]> = [
  [/^explore$/i, 'explorer'],
  [/^plan$/i, 'pirate'],
  [/^fork$/i, 'assassin'],
]

const BY_MODEL: Array<[RegExp, Character]> = [
  [/fable/i, 'wizard'],
  [/opus/i, 'king'],
  [/sonnet/i, 'knight'],
  [/haiku/i, 'original'],
]

/** Which costume a subagent wears: a failure first, then its type, then its model. */
export function agentCharacter(model: string, type: string, status: AgentStatus): Character {
  if (status === 'failed') return 'berserker'
  return (
    BY_TYPE.find(([re]) => re.test(type))?.[1] ??
    BY_MODEL.find(([re]) => re.test(model))?.[1] ??
    'original'
  )
}

export function agentSvg(model: string, type: string, status: AgentStatus): string {
  return draw(agentCharacter(model, type, status), status)
}

export function shellSvg(status: ShellStatus): string {
  return draw('fire', status)
}

function draw(character: Character, status: AgentStatus | ShellStatus): string {
  const badge = BADGES[status]
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">' +
    `<image href="data:image/png;base64,${CHARACTERS[character]}" width="96" height="96"/>` +
    `<circle cx="80" cy="80" r="14" fill="${badge.color}" stroke="#fff" stroke-width="3"/>` +
    `<text x="80" y="86" font-size="18" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="#fff">${badge.glyph}</text>` +
    '</svg>'
  )
}
