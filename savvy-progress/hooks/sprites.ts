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

// Motion, kept slow and small: a live run bobs gently (2.4s), a background
// shell sways (4s), the badge of a live run breathes. Finished runs stand
// still. Viewers who ask for reduced motion get none.
const MOTION: Partial<Record<AgentStatus | ShellStatus, string>> = {
  starting: 'bob 2.4s ease-in-out infinite',
  running: 'bob 2.4s ease-in-out infinite',
  background: 'sway 4s ease-in-out infinite',
}

const STYLE =
  '<style>' +
  '@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}' +
  '@keyframes sway{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}' +
  '@keyframes breathe{0%,100%{opacity:1}50%{opacity:.6}}' +
  '.body{transform-box:fill-box;transform-origin:50% 100%}' +
  '@media (prefers-reduced-motion:reduce){*{animation:none!important}}' +
  '</style>'

/** True when the icon of a run in this status moves. */
export function isAnimated(status: AgentStatus | ShellStatus): boolean {
  return MOTION[status] !== undefined
}

function draw(character: Character, status: AgentStatus | ShellStatus): string {
  const badge = BADGES[status]
  const motion = MOTION[status]
  const body = motion ? ` class="body" style="animation:${motion}"` : ''
  const pulse = motion ? ' style="animation:breathe 2.4s ease-in-out infinite"' : ''
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">' +
    (motion ? STYLE : '') +
    `<g${body}><image href="data:image/png;base64,${CHARACTERS[character]}" x="0" y="4" width="92" height="92"/></g>` +
    `<g${pulse}>` +
    `<circle cx="80" cy="80" r="14" fill="${badge.color}" stroke="#fff" stroke-width="3"/>` +
    `<text x="80" y="86" font-size="18" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="#fff">${badge.glyph}</text>` +
    '</g></svg>'
  )
}
