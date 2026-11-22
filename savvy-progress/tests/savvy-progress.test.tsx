import { expect, test } from 'claude-code/testing'

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

function engine(on: any, shell: () => unknown) {
  on('clock.now', () => ({ value: (clock += 1000) }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'savvy-progress' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.list', () => ({ value: [] }))
  on('tool.call', () => shell())
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_: unknown, e: unknown) => e)
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
    expect(await band.find({ type: 'Text', text: /npm run dev \(bg\)/ })).toBeDefined()
    await band.unmount()

    const pane = await $.ui.mount({ ...PANE, surface } as any)
    expect(await pane.find({ type: 'Text', text: /✓ \$ npm test — Run tests/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /✗ \$ npm run lint/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /◌ \$ npm run dev .*bg/ })).toBeDefined()
    await pane.unmount()

    // The background task's notification settles it.
    await $.prompt.submit({
      text: '<task-notification><task-id>b7</task-id><status>completed</status></task-notification>',
      origin: { kind: 'task-notification' },
    } as any)
    const after = await $.ui.mount({ ...PANE, surface } as any)
    expect(await after.find({ type: 'Text', text: /✓ \$ npm run dev/ })).toBeDefined()
    await after.unmount()
  })

  test(`a subagent shows its steps, tools and end (${surface})`, async ($, on) => {
    engine(on, () => ok)
    await $.session.start({ cwd: '/', surface, isInteractive: true } as any)

    await $.agent.spawn({ prompt: 'look', description: 'Find auth code', subagentType: 'Explore' } as any)
    await $.tool.call({ tool: 'Grep', pattern: 'login', agentId: 'a1' } as any)
    await $.tool.call({ tool: 'Bash', command: 'git log -1', agentId: 'a1' } as any)

    const pane = await $.ui.mount({ ...PANE, surface } as any)
    expect(await pane.find({ type: 'Text', text: /Explore "Find auth code".*2 tools.*\$ git log -1/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /\$ git log -1 · .* by Explore/ })).toBeDefined()
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
    expect(await done.find({ type: 'Text', text: /✓ Explore "Find auth code" · haiku-5-5 .*1\.5k tok/ })).toBeDefined()
    await done.unmount()
  })
}

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
