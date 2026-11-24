import { expect, mock, test } from 'claude-code/testing'
import { quickSummary } from '../hooks/register'
import { agentCharacter, agentSvg, isAnimated, shellSvg } from '../hooks/sprites'

const BAND = {
  plugin: 'savvy-progress',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 10, bodyColumns: 120 },
} as const

const PANE = {
  plugin: 'savvy-progress',
  component: 'Pane',
  requestId: 'savvy-progress',
  props: {
    title: 'Progress',
    isFocused: false,
    bodyColumns: 120,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

// Hooks registered here sit beneath the mod and stand for the engine.
let clock = 1_000_000
// What $.agent.list() answers: the test's subagent a1, running.
let listed: unknown[] = [{ id: 'a1', type: 'Explore', description: 'Find auth code', status: 'running' }]

function engine(on: any, shell: () => unknown, ownClock = true) {
  if (ownClock) {
    on('clock.now', () => ({ value: (clock += 1000) }))
    on('clock.every', () => ({ value: undefined }))
  }
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'savvy-progress' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.list', () => ({ value: listed }))
  on('tool.call', () => shell())
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_: unknown, e: unknown) => e)
}

// Opens every pane card's details, as a person pressing each arrow.
async function openAll(ui: any) {
  for (const b of await ui.findAll({ type: 'Button', text: '▾' })) {
    await ui.press({ key: b.key })
  }
}

const ok = { result: { stdout: 'ok', stderr: '', interrupted: false } }

for (const surface of ['terminal', 'desktop'] as const) {
  test(`shell commands show in the band and the pane (${surface})`, async ($, on) => {
    let answer: unknown = ok
    engine(on, () => answer)
    await $.session.start({ cwd: '/', surface, isInteractive: true } as any)

    await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run tests' } as any)
    answer = { isError: true, result: 'exit 1', text: 'exit 1' }
    await $.tool.call({ tool: 'Bash', command: 'npm run lint' } as any)
    answer = { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b7' } }
    await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true } as any)

    const band = await $.ui.mount({ ...BAND, surface } as any)
    expect(await band.find({ type: 'Text', text: /2\/3/ })).toBeDefined()
    // One line only: the running items are in the pane, not under the bar.
    expect(await band.find({ type: 'Text', text: /npm run dev/ })).toBeUndefined()
    await band.unmount()

    const pane = await $.ui.mount({ ...PANE, surface } as any)
    if (surface === 'terminal') {
      expect(await pane.find({ type: 'Text', text: /✓ \$ npm test — Run tests/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /✗ \$ npm run lint/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /◌ \$ npm run dev .*bg/ })).toBeDefined()
    } else {
      expect(await pane.findAll({ type: 'Svg' } as any)).toHaveLength(3)
      // Collapsed: the description alone, the command hidden.
      expect(await pane.find({ type: 'Text', text: /^Run tests$/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /npm test/ })).toBeUndefined()
      expect(await pane.find({ type: 'Text', text: /^npm run lint$/ })).toBeDefined()
      await openAll(pane)
      expect(await pane.find({ type: 'Text', text: /^\$ npm test$/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /^\$ npm run dev\nbackground$/ })).toBeDefined()
      expect(await pane.findAll({ type: 'Button', text: '▴' })).toHaveLength(3)
      expect(await pane.find({ type: 'Text', text: /^✗ / })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /^◌ / })).toBeDefined()
    }
    await pane.unmount()

    // The background task's notification settles it.
    await $.prompt.submit({
      text: '<task-notification><task-id>b7</task-id><status>completed</status></task-notification>',
      origin: { kind: 'task-notification' },
    } as any)
    const after = await $.ui.mount({ ...PANE, surface } as any)
    if (surface === 'terminal') {
      expect(await after.find({ type: 'Text', text: /✓ \$ npm run dev/ })).toBeDefined()
    } else {
      expect(await after.find({ type: 'Text', text: /^◌ / })).toBeUndefined()
    }
    await after.unmount()
  })

  test(`a subagent shows its steps, tools and end (${surface})`, async ($, on) => {
    engine(on, () => ok)
    await $.session.start({ cwd: '/', surface, isInteractive: true } as any)

    await $.agent.spawn({ prompt: 'look', description: 'Find auth code', subagentType: 'Explore' } as any)
    await $.tool.call({ tool: 'Grep', pattern: 'login', agentId: 'a1' } as any)
    await $.tool.call({ tool: 'Bash', command: 'git log -1', agentId: 'a1' } as any)

    const pane = await $.ui.mount({ ...PANE, surface } as any)
    if (surface === 'terminal') {
      expect(await pane.find({ type: 'Text', text: /Explore "Find auth code".*2 tools.*\$ git log -1/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /\$ git log -1 · .* by Explore/ })).toBeDefined()
    } else {
      expect(await pane.find({ type: 'Text', text: /^Find auth code$/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /^Explore · / })).toBeUndefined()
      await openAll(pane)
      expect(await pane.find({ type: 'Text', text: /^Explore · .*2 tools · \$ git log -1$/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /^\$ git log -1\nby Explore$/ })).toBeDefined()
      const icons = await pane.findAll({ type: 'Svg' } as any)
      expect(icons).toHaveLength(2)
    }
    await pane.unmount()

    await $.turn.complete({
      reason: 'answer',
      answer: 'found',
      durationMs: 5,
      isAborted: false,
      turnId: 't1',
      agentId: 'a1',
      usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-5-5' },
    } as any)

    const done = await $.ui.mount({ ...PANE, surface } as any)
    if (surface === 'terminal') {
      expect(await done.find({ type: 'Text', text: /✓ Explore "Find auth code" · haiku-5-5 .*1\.5k tok/ })).toBeDefined()
    } else {
      expect(await done.find({ type: 'Text', text: /^Explore · haiku-5-5 .*1\.5k tok$/ })).toBeDefined()
    }
    await done.unmount()
  })
}

test('a subagent long shell command is shown short', async ($, on) => {
  engine(on, () => ok)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as any)
  await $.agent.spawn({ prompt: 'look', description: 'Review', subagentType: 'general-purpose' } as any)
  const long = 'cd "/home/me/Project" && ' + 'grep -nE x file | head -20; '.repeat(20)
  await $.tool.call({ tool: 'Bash', command: long, agentId: 'a1' } as any)
  let pane = await $.ui.mount({ ...PANE, surface: 'desktop' } as any)
  await openAll(pane)
  const sub = await pane.find({ type: 'Text', text: /^general-purpose · / })
  expect(sub?.text.length).toBeLessThan(140)
  expect(sub?.text).toContain('…')
  await pane.unmount()

  await $.tool.call({ tool: 'Bash', command: long, description: 'Scan the repo for links', agentId: 'a1' } as any)
  pane = await $.ui.mount({ ...PANE, surface: 'desktop' } as any)
  expect(await pane.find({ type: 'Text', text: /· Scan the repo for links$/ })).toBeDefined()
  await pane.unmount()
})

test('a command without a description gets a short summary', async ($, on) => {
  const time = mock.clock(on)
  engine(on, () => ok, false)
  const asked: string[] = []
  on('model.complete', (_: unknown, e: { prompt: string; model: string; effort?: string }) => {
    asked.push(`${e.model}/${e.effort}`)
    return { value: { isAnswered: true, text: 'Inspect project folder and tools.', usage: {} } } as any
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as any)
  await $.tool.call({ tool: 'Bash', command: 'cd "/home/me/Personal Assistant" && git ls-files | head -300' } as any)
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' } as any)

  const before = await $.ui.mount({ ...PANE, surface: 'desktop' } as any)
  expect(await before.find({ type: 'Text', text: /^git ls-files, head in Personal Assistant$/ })).toBeDefined()
  await before.unmount()

  await time.advance(1000)
  const after = await $.ui.mount({ ...PANE, surface: 'desktop' } as any)
  expect(await after.find({ type: 'Text', text: /^Inspect project folder and tools$/ })).toBeDefined()
  expect(await after.find({ type: 'Text', text: /^Run the tests$/ })).toBeDefined()
  expect(asked).toEqual(['haiku/low']) // only the command without a description
  await after.unmount()
})

test('the quick summary names the programs and the folder', () => {
  expect(quickSummary('cd "/a/Personal Assistant" && git ls-files | grep -v x | head -300 && git ls-files | wc -l'))
    .toBe('git ls-files, grep, head, wc in Personal Assistant')
  expect(quickSummary('npm run build')).toBe('npm run build')
  expect(quickSummary('FOO=1 sudo python3 -m pytest -q tests/')).toBe('python3 pytest')
  expect(quickSummary("for i in 1 2; do find /usr -name '*.py' | wc -l; done")).toBe('find, wc')
  expect(quickSummary('cd app')).toBe('Go to app')
})

test('a background shell that is no longer in flight stops showing as running', async ($, on) => {
  let answer: unknown = ok
  engine(on, () => answer)
  on('classic.Stop', () => ({}))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as any)
  answer = { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'gone' } }
  await $.tool.call({ tool: 'Bash', command: 'sleep 600', description: 'Wait for render loop', run_in_background: true } as any)
  answer = { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'alive' } }
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', description: 'Serve the app', run_in_background: true } as any)

  // Claude Code was closed: only one task is still in flight at the turn's end.
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 'alive', type: 'shell', status: 'running', description: 'Serve the app' }] } as any)

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' } as any)
  expect(await pane.findAll({ type: 'Text', text: /^◌ / })).toHaveLength(1)
  expect(await pane.find({ type: 'Text', text: /^– / })).toBeDefined()
  await openAll(pane)
  expect(await pane.find({ type: 'Text', text: /stopped: no longer running/ })).toBeDefined()
  await pane.unmount()
})

// The case seen on a real machine: a subagent's foreground wait (timeout
// 560s) was moved to the background after 180s, then Claude Code was killed
// for lack of memory and reopened.
const stuck = {
  tool: 'Bash',
  agentId: 'a1',
  command: "cd no_blender; timeout 540 sh -c 'until [ -s renders/loop_log.txt ]; do sleep 5; done'; cat renders/loop_log.txt",
  description: 'Wait for loop render completion',
  timeout: 560_000,
}
const movedToBackground = { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bt5a1aoda' } }

test('a moved-to-background wait lost when Claude Code was killed stops at the next turn end', async ($, on) => {
  let answer: unknown = movedToBackground
  engine(on, () => answer)
  on('classic.Stop', () => ({}))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as any)
  await $.agent.spawn({ prompt: 'x', description: 'Rebuild island without Blender', subagentType: 'general-purpose' } as any)
  await $.tool.call(stuck as any)

  // Reopened: a new session start, and the task is no longer in flight.
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as any)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as any)

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' } as any)
  expect(await pane.find({ type: 'Text', text: /^◌ / })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /Shell\s+1 done/ })).toBeDefined()
  await openAll(pane)
  expect(await pane.find({ type: 'Text', text: /stopped: no longer running/ })).toBeDefined()
  await pane.unmount()
})

test('a moved-to-background wait stops showing as running after 41 minutes even with no turn end', async ($, on) => {
  const time = mock.clock(on)
  engine(on, () => movedToBackground, false)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as any)
  await $.tool.call(stuck as any)

  await time.advance(40 * 60_000)
  let pane = await $.ui.mount({ ...PANE, surface: 'desktop' } as any)
  expect(await pane.find({ type: 'Text', text: /^◌ / })).toBeDefined()
  await pane.unmount()

  // The screenshot's 43m54s.
  await time.advance(3 * 60_000 + 54_000)
  pane = await $.ui.mount({ ...PANE, surface: 'desktop' } as any)
  expect(await pane.find({ type: 'Text', text: /^◌ / })).toBeUndefined()
  await openAll(pane)
  expect(await pane.find({ type: 'Text', text: /stopped: past its timeout/ })).toBeDefined()
  await pane.unmount()
})

test('a subagent lost when Claude Code closed stops showing as running', async ($, on) => {
  engine(on, () => ok)
  on('classic.Stop', () => ({}))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as any)
  await $.agent.spawn({ prompt: 'x', description: 'Rebuild island', subagentType: 'general-purpose' } as any)
  // Claude Code restarted: it no longer lists the subagent.
  const before = listed
  listed = []
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as any)
  listed = before
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' } as any)
  expect(await pane.find({ type: 'Text', text: /^✗ / })).toBeDefined()
  await pane.unmount()
})

test('a background shell past its own timeout is not live', async ($, on) => {
  const time = mock.clock(on)
  let answer: unknown = ok
  engine(on, () => answer, false)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as any)
  answer = { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } }
  await $.tool.call({ tool: 'Bash', command: 'sleep 100', description: 'Wait a bit', run_in_background: true, timeout: 60_000 } as any)
  await time.advance(2 * 60_000 + 1000)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' } as any)
  expect(await pane.find({ type: 'Text', text: /^◌ / })).toBeUndefined()
  await openAll(pane)
  expect(await pane.find({ type: 'Text', text: /stopped: past its timeout/ })).toBeDefined()
  await pane.unmount()
})

test('the band stays out of the way until something runs', async ($, on) => {
  engine(on, () => ok)
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as any)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' } as any)
  expect((await band.find({ type: 'Text' }))?.text).toBe('engine')
  await band.unmount()
})

test('each subagent wears a costume by status, type and model', () => {
  expect(agentCharacter('claude-sonnet-5-5', 'Explore', 'failed')).toBe('berserker')
  expect(agentCharacter('claude-sonnet-5-5', 'Explore', 'running')).toBe('explorer')
  expect(agentCharacter('claude-opus-5-5', 'Plan', 'done')).toBe('pirate')
  expect(agentCharacter('', 'fork', 'running')).toBe('assassin')
  expect(agentCharacter('claude-fable-5-2', 'general-purpose', 'done')).toBe('wizard')
  expect(agentCharacter('claude-opus-5-5', 'general-purpose', 'done')).toBe('king')
  expect(agentCharacter('claude-sonnet-5-5', 'general-purpose', 'done')).toBe('knight')
  expect(agentCharacter('claude-haiku-5-5', 'general-purpose', 'done')).toBe('original')
  expect(agentCharacter('', 'my-plugin:reviewer', 'running')).toBe('original')
  expect(agentSvg('claude-haiku-5-5', 'Explore', 'done')).toContain('#27ae60')
  expect(shellSvg('failed')).toContain('#eb5757')
  expect(shellSvg('done').length).toBeLessThan(131072)
  // Only live runs move, slowly, and reduced motion turns it off.
  expect(isAnimated('running')).toBe(true)
  expect(isAnimated('done')).toBe(false)
  expect(agentSvg('claude-opus-5-5', 'Plan', 'running')).toContain('bob 2.4s')
  expect(shellSvg('background')).toContain('sway 4s')
  expect(agentSvg('claude-opus-5-5', 'Plan', 'running')).toContain('prefers-reduced-motion')
  expect(agentSvg('claude-opus-5-5', 'Plan', 'done')).not.toContain('@keyframes')
})
