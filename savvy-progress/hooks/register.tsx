// Savvy Progress: live progress of shell commands and subagents, above the
// prompt and in a pane. Written from scratch for my-mods; the idea of a
// progress bar plus an agents panel comes from johnnyvizz/claude-kit's
// savvy-progress (MIT), which tracks only its own savvy-flow workers.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRun, AgentStatus, ShellRun, ShellStatus } from '../types'
import { agentSvg, shellSvg } from './sprites'

type Engine = EngineInterface

const PANE = 'savvy-progress'
const TITLE = 'Progress'
const KEEP = 60 // runs kept per list
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
const BG_LIMIT_MS = 2 * 60 * 60 * 1000 // a background shell cannot outlive 2h
const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

// Change a shape tag when the fields of a run change: values stored by an
// earlier version outlive a reload and are declined by a new tag.
const shells = atom({ plugin: 'savvy-progress', key: 'shells' } as const, [], { shape: 'shells-1' })
const agents = atom({ plugin: 'savvy-progress', key: 'agents' } as const, [], { shape: 'agents-1' })
// Bumped once a second while something runs, so the elapsed times redraw.
const now = atom({ plugin: 'savvy-progress', key: 'now' } as const, 0)
// Runs started at or after this moment count in the band's bar.
const batchStart = atom({ plugin: 'savvy-progress', key: 'batchStart' } as const, 0)
const isHidden = atom({ plugin: 'savvy-progress', key: 'isHidden' } as const, false)

export const register: Register = (on, options) => {
  const autoOpen = (options as { autoOpen?: unknown } | undefined)?.autoOpen === 'never' ? 'never' : 'agents'
  let openedForBatch = -1
  let spawns = 0

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'savvy-progress',
      description: 'Shell and subagent progress: open (default), close, clear, hide, show',
    })
    $.clock.every(1000, () => {
      void quietly(() => tick($))
    })

    return next(e)
  })

  on('command.run', { command: 'savvy-progress' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'Progress pane closed.' }
    }
    if (arg === 'clear') {
      await clearFinished($)
      return { text: 'Finished shell commands and subagents cleared.' }
    }
    if (arg === 'hide' || arg === 'show') {
      await update($, isHidden, () => arg === 'hide')
      return { text: arg === 'hide' ? 'Progress band hidden.' : 'Progress band shown.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Progress pane opened.' }
  })

  // A prompt from the person starts a new batch once nothing runs. A
  // background task's notification settles the shell it reports on.
  on('prompt.submit', async ($, e, next) => {
    await quietly(async () => {
      const t = await $.clock.now()
      if (e.origin?.kind === 'task-notification') {
        await settleTasks($, e.text, t)
        return
      }
      const [s, a] = await Promise.all([read($, shells), read($, agents)])
      if (!s.some(r => isLive(r, t)) && !a.some(r => isLive(r, t))) {
        await update($, batchStart, () => t)
      }
    })

    return next(e)
  }).catch(($, e, next) => next(e))

  // ---- subagents -------------------------------------------------------

  on('agent.spawn', async ($, e, next) => {
    spawns += 1
    const id = `${e.tool_use_id || 'spawn'}#${spawns}`
    await quietly(async () => {
      const t = await $.clock.now()
      const run: AgentRun = {
        id,
        toolUseId: e.tool_use_id || undefined,
        parentAgentId: e.parentAgentId,
        type: e.subagentType,
        description: e.description,
        model: e.model ?? '',
        isBackground: e.background,
        status: 'starting',
        startedAt: t,
        steps: 0,
        tools: 0,
        tokens: 0,
      }
      await update($, agents, list => [...list, run].slice(-KEEP))
      if (autoOpen === 'agents') {
        const batch = await read($, batchStart)
        if (openedForBatch !== batch) {
          openedForBatch = batch
          void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
        }
      }
    })

    let res
    try {
      res = await next(e)
    } catch (err) {
      await quietly(() => endAgent($, r => r.id === id, 'failed', 'spawn failed'))
      throw err
    }

    await quietly(async () => {
      if (res.deny !== undefined) {
        await endAgent($, r => r.id === id, 'failed', res.deny)
        return
      }
      const { agentId, model } = res
      await update($, agents, list =>
        list.map(r =>
          r.id === id
            ? {
                ...r,
                agentId: r.agentId ?? agentId,
                model: model || r.model,
                status: r.status === 'starting' ? 'running' : r.status,
              }
            : r,
        ),
      )
    })

    return res
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    if (e.agentId) {
      const agentId = e.agentId
      await quietly(() =>
        touchAgent($, agentId, r => ({
          ...r,
          steps: r.steps + 1,
          status: r.status === 'starting' || r.status === 'done' ? 'running' : r.status,
        })),
      )
    }

    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) {
      const agentId = e.agentId
      await quietly(async () => {
        const t = await $.clock.now()
        const u = e.usage
        const tokens = u
          ? (u.input_tokens ?? 0) +
            (u.output_tokens ?? 0) +
            (u.cache_read_input_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0)
          : 0
        const status: AgentStatus = e.reason === 'answer' ? 'done' : 'failed'
        await touchAgent($, agentId, r => ({
          ...r,
          status,
          note: status === 'failed' ? e.reason : undefined,
          endedAt: t,
          tokens: r.tokens + tokens,
          model: u?.model || r.model,
          current: undefined,
        }))
      })
    }

    return result
  })

  // ---- tool calls: shell commands, and what each subagent is doing -------

  on('tool.call', async ($, e, next) => {
    const tool: string = e.tool
    const args = e as unknown as Record<string, unknown>

    if (e.agentId) {
      const agentId = e.agentId
      await quietly(() =>
        touchAgent($, agentId, r => ({ ...r, tools: r.tools + 1, current: toolLabel(tool, args) })),
      )
    }

    if (!SHELL_TOOLS.has(tool)) {
      const ran = await next(e)
      await quietly(async () => {
        if (tool === 'Agent' && ran.isError === true) {
          await endAgent(
            $,
            r => r.toolUseId === e.tool_use_id && (r.status === 'starting' || r.status === 'running'),
            'failed',
            'Agent call failed',
          )
        }
        if (tool === 'TaskStop' && ran.deny === undefined && ran.isError !== true) {
          const taskId = String(args.task_id ?? args.shell_id ?? '')
          if (taskId) {
            await settleShell($, r => r.taskId === taskId, 'stopped', await $.clock.now())
          }
        }
      })
      return ran
    }

    const id = e.tool_use_id
    await quietly(async () => {
      const run: ShellRun = {
        id,
        tool,
        command: String(args.command ?? ''),
        description: typeof args.description === 'string' ? args.description : undefined,
        agentId: e.agentId,
        status: 'running',
        isBackground: args.run_in_background === true,
        startedAt: await $.clock.now(),
      }
      await update($, shells, list => [...list, run].slice(-KEEP))
    })

    let ran
    try {
      ran = await next(e)
    } catch (err) {
      await quietly(async () => settleShell($, r => r.id === id, 'failed', await $.clock.now()))
      throw err
    }

    await quietly(async () => {
      const t = await $.clock.now()
      let status: ShellStatus = 'done'
      let taskId: string | undefined
      if (ran.deny !== undefined) {
        status = 'denied'
      } else if (ran.isError === true) {
        status = 'failed'
      } else {
        const out = (ran.result ?? {}) as { backgroundTaskId?: string; interrupted?: boolean }
        if (out.backgroundTaskId) {
          status = 'background'
          taskId = out.backgroundTaskId
        } else if (out.interrupted) {
          status = 'failed'
        }
      }
      await update($, shells, list =>
        list.map(r =>
          r.id === id
            ? { ...r, status, taskId, isBackground: status === 'background', endedAt: status === 'background' ? undefined : t }
            : r,
        ),
      )
    })

    return ran
  }).catch(($, e, next) => next(e))

  // ---- drawing ------------------------------------------------------------

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const [s, a, tick, batch, hidden] = await Promise.all([
      read($, shells),
      read($, agents),
      read($, now),
      read($, batchStart),
      read($, isHidden),
    ])
    const S = s.filter(r => r.startedAt >= batch)
    const A = a.filter(r => r.startedAt >= batch)
    if (hidden || S.length + A.length === 0) {
      return next(e)
    }
    const t = Math.max(tick, await $.clock.now())

    const { Box, Text, Button } = $.ui.resolve(e)
    const cols = Math.max(20, e.props.bodyColumns)
    const total = S.length + A.length
    const live = [...A.filter(r => isLive(r, t)), ...S.filter(r => isLive(r, t))]
    const finished = total - live.length
    const failed = S.filter(r => r.status === 'failed').length + A.filter(r => r.status === 'failed').length
    const width = cols >= 80 ? 12 : 6
    const filled = Math.round((finished / total) * width)
    const spin = spinner(t)
    const head = live.length > 0 ? spin : failed > 0 ? '!' : '✓'
    const headColor = live.length > 0 ? 'cyan' : failed > 0 ? 'red' : 'green'
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row">
          <Text color={headColor} bold>
            {head} Progress{' '}
          </Text>
          <Text color={headColor}>{'█'.repeat(filled)}</Text>
          <Text dimColor>{'░'.repeat(width - filled)}</Text>
          <Text>
            {' '}
            {finished}/{total}
          </Text>
          {cols >= 60 && <Text dimColor>{'  ' + counts('shell', S, t) + '  ' + counts('agents', A, t)}</Text>}
          <Text> </Text>
          <Button key="details" label="Details" onPress={() => $.ui.open({ id: PANE, title: TITLE })} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    // Surfaces that draw Svg (desktop, editor, mobile) get pixel-art cards;
    // the terminal keeps one line of text per run.
    const Svg = e.surface !== 'terminal' && 'Svg' in table ? table.Svg : undefined
    const [s, a, tick] = await Promise.all([read($, shells), read($, agents), read($, now)])
    const t = Math.max(tick, await $.clock.now())
    const cols = Math.max(20, e.props.bodyColumns)
    const rows = Math.max(6, (e.viewport?.rows ?? 30) - 3)
    // Agents first, newest last; split the rows between the two lists.
    const perItem = Svg ? 2 : 1
    const agentRows = Math.max(2, Math.min(a.length, Math.floor(rows / 2 / perItem)))
    const shellRows = Math.max(2, Math.floor((rows - agentRows * perItem - 4) / perItem))

    const card = (key: string, svg: string, alt: string, title: string, sub: string, color: string | undefined, right: string) =>
      Svg ? (
        <Box key={key} flexDirection="row" gap={1} alignItems="center">
          <Svg source={svg} alt={alt} width={28} height={28} />
          <Box flexDirection="column" flexGrow={1}>
            <Text bold>{cut(title, Math.max(20, cols - 14))}</Text>
            <Text dimColor>{cut(sub, Math.max(20, cols - 14))}</Text>
          </Box>
          <Text color={color}>{right}</Text>
        </Box>
      ) : null

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Button key="clear" label="Clear finished" onPress={() => clearFinished($)} />
          <Text> </Text>
          <Button key="close" label="Close" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        <Text bold>{`Agents  ${counts('', a, t).trim()}`}</Text>
        {a.length === 0 && <Text dimColor>  No subagents yet.</Text>}
        {a.slice(-agentRows).map(r =>
          Svg
            ? card(
                `agent-${r.id}`,
                agentSvg(r.model, r.type, r.status),
                `${r.type} subagent, ${r.status}`,
                `${r.parentAgentId ? '↳ ' : ''}${r.description}`,
                agentSub(r),
                statusColor(r.status),
                `${icon(r.status, t)} ${elapsed(r, t)}`,
              )
            : <Text color={statusColor(r.status)}>{cut(agentLine(r, t), cols)}</Text>,
        )}
        <Text bold>{`Shell  ${counts('', s, t).trim()}`}</Text>
        {s.length === 0 && <Text dimColor>  No shell commands yet.</Text>}
        {s.slice(-shellRows).map(r =>
          Svg
            ? card(
                `shell-${r.id}`,
                shellSvg(r.status),
                `shell command, ${r.status}`,
                cut(`$ ${firstLine(r.command)}`, Math.max(20, cols - 20)),
                shellSub(r, a),
                statusColor(r.status),
                `${icon(r.status, t)} ${elapsed(r, t)}`,
              )
            : <Text color={statusColor(r.status)}>{cut(shellLine(r, t, a), cols)}</Text>,
        )}
      </Box>
    )
  })
}

// ---- state helpers ----------------------------------------------------------

async function quietly(fn: () => Promise<unknown>): Promise<void> {
  // The mod never breaks a tool call, a spawn or a turn over its own state.
  try {
    await fn()
  } catch {
    // ignored on purpose
  }
}

async function tick($: Engine) {
  const t = await $.clock.now()
  const [s, a] = await Promise.all([read($, shells), read($, agents)])
  if (s.some(r => isLive(r, t)) || a.some(r => isLive(r, t))) {
    await update($, now, () => t)
  }
}

function isLive(r: ShellRun | AgentRun, t: number): boolean {
  if (r.status === 'running' || r.status === 'starting') return true
  return r.status === 'background' && t - r.startedAt < BG_LIMIT_MS
}

async function clearFinished($: Engine) {
  const t = await $.clock.now()
  await update($, shells, list => list.filter(r => isLive(r, t)))
  await update($, agents, list => list.filter(r => isLive(r, t)))
}

async function endAgent($: Engine, match: (r: AgentRun) => boolean, status: AgentStatus, note?: string) {
  const t = await $.clock.now()
  await update($, agents, list => list.map(r => (match(r) ? { ...r, status, note, endedAt: t, current: undefined } : r)))
}

async function settleShell($: Engine, match: (r: ShellRun) => boolean, status: ShellStatus, t: number) {
  await update($, shells, list => list.map(r => (match(r) ? { ...r, status, endedAt: t } : r)))
}

// Applies `fn` to the run of a subagent loop. A loop not yet tied to its run
// (its first step came before the spawn resolved) is tied by `$.agent.list()`;
// one this mod never saw spawn (started before a reload) is added from there.
async function touchAgent($: Engine, agentId: string, fn: (r: AgentRun) => AgentRun) {
  const list = await read($, agents)
  if (!list.some(r => r.agentId === agentId)) {
    const info = (await $.agent.list()).find(one => one.id === agentId)
    if (!info) return
    const t = await $.clock.now()
    await update($, agents, current => {
      if (current.some(r => r.agentId === agentId)) return current
      const i = current.findIndex(
        r => !r.agentId && r.description === info.description && r.type === info.type,
      )
      if (i >= 0) {
        return current.map((r, j) => (j === i ? { ...r, agentId, status: r.status === 'starting' ? 'running' : r.status } : r))
      }
      const run: AgentRun = {
        id: `seen#${agentId}`,
        agentId,
        parentAgentId: info.parentId,
        type: info.type,
        description: info.description,
        model: '',
        isBackground: true,
        status: 'running',
        startedAt: t,
        steps: 0,
        tools: 0,
        tokens: 0,
      }
      return [...current, run].slice(-KEEP)
    })
  }
  await update($, agents, current => current.map(r => (r.agentId === agentId ? fn(r) : r)))
}

// A background task's notification names its task and how it ended.
async function settleTasks($: Engine, text: string, t: number) {
  const found = /<task-id>\s*([^<\s]+)\s*<\/task-id>[\s\S]*?<status>\s*([a-z_]+)\s*<\/status>/gi
  for (const m of text.matchAll(found)) {
    const taskId = m[1] ?? ''
    const word = m[2] ?? ''
    const status: ShellStatus = /complet|success|done/i.test(word) ? 'done' : /kill|stop|cancel/i.test(word) ? 'stopped' : 'failed'
    await settleShell($, r => r.taskId === taskId && r.status === 'background', status, t)
  }
}

// ---- text -------------------------------------------------------------------

function counts(label: string, list: ReadonlyArray<ShellRun | AgentRun>, t: number): string {
  if (list.length === 0) return label ? `${label} –` : ''
  const live = list.filter(r => isLive(r, t)).length
  const failed = list.filter(r => r.status === 'failed').length
  const done = list.length - live - failed
  const parts = [live && `${live} running`, done && `${done} done`, failed && `${failed} failed`].filter(Boolean)
  return `${label} ${parts.join(' · ')}`
}

function agentLine(r: AgentRun, t: number): string {
  const nested = r.parentAgentId ? '↳ ' : ''
  const model = r.model ? ` · ${shortModel(r.model)}` : ''
  const bg = r.isBackground ? ' · bg' : ''
  const tokens = r.tokens > 0 ? ` · ${short(r.tokens)} tok` : ''
  const doing = r.current && (r.status === 'running' || r.status === 'starting') ? ` · ${r.current}` : ''
  const note = r.status === 'failed' && r.note ? ` · ${r.note}` : ''
  return `${icon(r.status, t)} ${nested}${r.type} "${r.description}"${model}${bg} · ${elapsed(r, t)} · ${r.steps} steps · ${r.tools} tools${tokens}${doing}${note}`
}

function agentSub(r: AgentRun): string {
  const parts = [
    r.type,
    r.model && shortModel(r.model),
    r.isBackground && 'bg',
    `${r.steps} steps`,
    `${r.tools} tools`,
    r.tokens > 0 && `${short(r.tokens)} tok`,
    (r.status === 'running' || r.status === 'starting') && r.current,
    r.status === 'failed' && r.note,
  ]
  return parts.filter(Boolean).join(' · ')
}

function shellSub(r: ShellRun, list: readonly AgentRun[]): string {
  const parts = [
    r.description,
    r.status === 'background' && 'background',
    (r.status === 'denied' || r.status === 'stopped') && r.status,
    r.agentId && `by ${list.find(a => a.agentId === r.agentId)?.type ?? 'subagent'}`,
  ]
  return parts.filter(Boolean).join(' · ') || r.tool
}

function shellLine(r: ShellRun, t: number, list: readonly AgentRun[]): string {
  const by = r.agentId ? ` · by ${list.find(a => a.agentId === r.agentId)?.type ?? 'subagent'}` : ''
  const what = r.description ? ` — ${r.description}` : ''
  const tag = r.status === 'background' ? ' · bg' : r.status === 'denied' ? ' · denied' : r.status === 'stopped' ? ' · stopped' : ''
  return `${icon(r.status, t)} $ ${firstLine(r.command)}${what} · ${elapsed(r, t)}${tag}${by}`
}

function spinner(t: number): string {
  return SPINNER[Math.floor(t / 1000) % SPINNER.length] ?? '·'
}

function icon(status: ShellStatus | AgentStatus, t: number): string {
  switch (status) {
    case 'running':
    case 'starting':
      return spinner(t)
    case 'background':
      return '◌'
    case 'done':
      return '✓'
    case 'failed':
      return '✗'
    default:
      return '–'
  }
}

function statusColor(status: ShellStatus | AgentStatus): string | undefined {
  if (status === 'failed') return 'red'
  if (status === 'running' || status === 'starting') return 'cyan'
  if (status === 'background') return 'yellow'
  if (status === 'denied' || status === 'stopped') return 'gray'
  return undefined
}

// What a subagent is doing now, kept short: a shell command by its own
// description when it gave one, else its first line, cut to LABEL characters.
const LABEL = 48

function toolLabel(tool: string, args: Record<string, unknown>): string {
  const pick = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : '')
  if (SHELL_TOOLS.has(tool)) {
    return cut(pick('description') || `$ ${firstLine(pick('command'))}`, LABEL)
  }
  const path = pick('file_path') || pick('path') || pick('notebook_path')
  if (path) return cut(`${tool} ${path.split('/').pop()}`, LABEL)
  const what = pick('pattern') || pick('query') || pick('url') || pick('description')
  return cut(what ? `${tool} ${firstLine(what)}` : tool, LABEL)
}

function elapsed(r: { startedAt: number; endedAt?: number }, t: number): string {
  const ms = Math.max(0, (r.endedAt ?? t) - r.startedAt)
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

function shortModel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

function firstLine(s: string): string {
  const line = s.trim().split('\n')[0] ?? ''
  return s.trim().includes('\n') ? `${line} …` : line
}

function cut(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, Math.max(1, n - 1))}…`
}

function short(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`
  return String(n)
}
