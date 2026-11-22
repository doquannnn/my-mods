import type { EngineInterface as Api, Register } from 'claude-code'

import { skinColors } from './look'
import { SKINS } from './themes'

// One feature: /skin opens a list of the skins from hellosverre/claude-skins, and a pick
// recolours the app. `Default` is Claude's own look: it changes nothing.

const PANE = 'skin-picker'
const PICKER = 'skin'
const DEFAULT = 'default'
// The skin picked last, so the next session starts in it.
const STORED = 'skin'

const OPTIONS = [
  { value: DEFAULT, label: 'Default (Claude)' },
  ...SKINS.map(skin => ({ value: skin.name, label: skin.label })),
]

const stored = async ($: Api): Promise<string> => {
  const value = await $.store.get(STORED)

  return typeof value === 'string' && SKINS.some(skin => skin.name === value) ? value : DEFAULT
}

const labelOf = (name: string): string =>
  OPTIONS.find(one => one.value === name)?.label ?? name

// The hint drawn dim after `/skin` in the prompt: the skin on now, then every name it takes.
const hintFor = (current: string): string =>
  `now: ${labelOf(current)} · ${OPTIONS.map(one => one.value).join(' | ')}`

// Registering again replaces the command, so the hint follows each pick.
const announce = async ($: Api, current: string): Promise<void> => {
  await $.command.register({
    name: 'skin',
    description: `Pick a skin for Claude (now: ${labelOf(current)}), or Default to keep its own look`,
    argumentHint: hintFor(current),
  })
}

// Puts a skin on, or takes this mod's off for `default`. Answers the line to show.
const apply = async ($: Api, name: string): Promise<string> => {
  if (name === DEFAULT) {
    // Always cleared: the theme is the session's, the stored pick is every session's, so a
    // pick of Default in another session leaves this one's skin standing with nothing stored.
    // With no theme standing, the clear changes nothing on screen.
    await $.store.delete(STORED)
    await $.theme.clear()
    await announce($, DEFAULT)

    return 'Default: Claude’s own look.'
  }
  const skin = SKINS.find(one => one.name === name)

  if (skin === undefined) {
    return `No skin named "${name}". Skins: ${OPTIONS.map(one => one.value).join(', ')}.`
  }
  const set = await $.theme.set({ colors: skinColors(skin).theme })
  await $.store.set(STORED, skin.name)
  await announce($, skin.name)

  return set.isDrawn
    ? `Skin: ${skin.label}.`
    : `Skin: ${skin.label}, saved, but not drawn here: ${set.reason}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const name = await stored($)

    if (name === DEFAULT) {
      await announce($, DEFAULT)
    } else {
      await apply($, name)
    }

    return next(e)
  })

  on('command.run', { command: 'skin' }, async ($, e) => {
    const typed = e.args.trim().toLowerCase()

    if (typed !== '') {
      return { text: await apply($, typed) }
    }
    const opened = await $.ui.open({ id: PANE, title: 'Skin' })

    return {
      text: opened.isPlaced
        ? 'Pick a skin in the Skin pane.'
        : `Skins: ${OPTIONS.map(one => one.value).join(', ')}. Type /skin <name>.`,
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Select } = $.ui.resolve(e)
    const current = await stored($)

    return (
      <Box flexDirection="column">
        <Select
          key={PICKER}
          label="Skin"
          options={OPTIONS}
          value={current}
          autoFocus
          onSelect={async value => {
            $.ui.toast(await apply($, value))
            await $.ui.close({ id: PANE })
          }}
        />
      </Box>
    )
  })
}
