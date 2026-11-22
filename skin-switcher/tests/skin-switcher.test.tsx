import type { CommandRunInput, On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'skin-switcher',
  component: 'Pane',
  requestId: 'skin-picker',
  props: {
    title: 'Skin',
    isFocused: true,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

// `/skin <args>` as the person types it.
const typed = (args: string): CommandRunInput => ({
  command: 'skin',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
})

// Hooks here stand for the engine: each records what the mod asked of it.
const engine = (on: On) => {
  const calls = { set: 0, clear: 0, stored: new Map<string, unknown>() }

  on('command.register', () => ({ value: { command: 'skin' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('theme.set', () => {
    calls.set += 1

    return { value: { isDrawn: true, requestId: 'theme' } }
  })
  on('theme.clear', () => {
    calls.clear += 1

    return { value: { isDrawn: false, reason: 'cleared' } }
  })
  on('store.get', (_, e) => ({ value: calls.stored.get(e.key) }))
  on('store.set', (_, e) => {
    calls.stored.set(e.key, e.value)

    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    calls.stored.delete(e.key)

    return { value: undefined }
  })

  return calls
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/skin lists Default and every skin, and a pick sets it (${surface})`, async ($, on) => {
    const calls = engine(on)
    await $.session.start({ cwd: '/', surface, isInteractive: true })

    const ran = await $.command.run(typed(''))
    expect(ran.text).toBe('Pick a skin in the Skin pane.')

    const ui = await $.ui.mount({ ...PANE, surface })
    const picker = await ui.find({ type: 'Select', key: 'skin' })
    const options = (picker?.props as { options?: readonly { value: string }[] } | undefined)?.options
    const values = (options ?? []).map(one => one.value)
    expect(values[0]).toBe('default')
    expect(values).toContain('nord')
    expect(values).toHaveLength(16)

    await ui.select({ key: 'skin', value: 'nord' })
    expect(calls.set).toBe(1)
    expect(calls.stored.get('skin')).toBe('nord')
    await ui.unmount()
  })
}

test('Default does nothing when no skin is on', async ($, on) => {
  const calls = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ran = await $.command.run(typed('default'))
  expect(ran.text).toBe('Default: Claude keeps its own look.')
  expect(calls.set).toBe(0)
  expect(calls.clear).toBe(0)
})

test('Default takes a skin off, and a picked skin comes back next session', async ($, on) => {
  const calls = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run(typed('dracula'))
  expect(calls.set).toBe(1)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(calls.set).toBe(2)

  await $.command.run(typed('default'))
  expect(calls.clear).toBe(1)
  expect(calls.stored.has('skin')).toBe(false)
})

test('an unknown name sets nothing', async ($, on) => {
  const calls = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ran = await $.command.run(typed('neon'))
  expect(ran.text).toMatch(/No skin named "neon"/)
  expect(calls.set).toBe(0)
})
