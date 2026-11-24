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
// How long a background shell can run: its own timeout, else Bash's default
// of 30 minutes in the background (after up to 10 in the foreground when it
// was moved there), plus a minute of slack. Past that it is not live.
const BG_DEFAULT_MS = 30 * 60 * 1000
const FG_MAX_MS = 10 * 60 * 1000
const GRACE_MS = 60 * 1000
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
// Pane cards whose details (the full command, the agent's numbers) are open.
const expanded = atom({ plugin: 'savvy-progress', key: 'expanded' } as const, [] as string[])

export const register: Register = (on, options) => {
  const autoOpen = (options as { autoOpen?: unknown } | undefined)?.autoOpen === 'never' ? 'never' : 'agents'
  const summarize = (options as { summarize?: unknown } | undefined)?.summarize === 'off' ? 'off' : 'model'
  let openedForBatch = -1
  let spawns = 0

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'savvy-progress',
      description: 'Shell and subagent progress: open (default), close, clear, hide, show',
    })
    let ticks = 0
    $.clock.every(1000, () => {
      ticks += 1
      if (ticks % 15 === 0) void quietly(() => reconcileAgents($))
      void quietly(() => tick($))
      if (summarize === 'model') void quietly(() => summarizeShells($))
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

  // When a turn ends, Claude Code lists the background work still in flight.
  // A background shell missing from that list has ended without the mod
  // hearing of it (Claude Code was closed or crashed, its notice went to a
  // subagent): mark it stopped so it does not run on forever in the pane.
  on('classic.Stop', async ($, e, next) => {
    await quietly(() => reconcile($, e.background_tasks))
    await quietly(() => reconcileAgents($))
    return next(e)
  }).catch(($, e, next) => next(e))
  on('classic.SubagentStop', async ($, e, next) => {
    await quietly(() => reconcile($, e.background_tasks))
    return next(e)
  }).catch(($, e, next) => next(e))

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
        description: typeof args.description === 'string' && args.description.trim() ? args.description.trim() : undefined,
        agentId: e.agentId,
        status: 'running',
        isBackground: args.run_in_background === true,
        limitMs:
          (args.run_in_background === true
            ? typeof args.timeout === 'number' ? args.timeout : BG_DEFAULT_MS
            : FG_MAX_MS + BG_DEFAULT_MS) + GRACE_MS,
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
    const [s, a, tick, open] = await Promise.all([read($, shells), read($, agents), read($, now), read($, expanded)])
    const t = Math.max(tick, await $.clock.now())
    const cols = Math.max(20, e.props.bodyColumns)
    const rows = Math.max(6, (e.viewport?.rows ?? 30) - 3)
    // Agents first, newest last; split the rows between the two lists.
    const perItem = 1
    const agentRows = Math.max(2, Math.min(a.length, Math.floor(rows / 2 / perItem)))
    const shellRows = Math.max(2, Math.floor((rows - agentRows * perItem - 4) / perItem))
    const toggle = (key: string) =>
      update($, expanded, keys => (keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key].slice(-KEEP)))

    // A card is one line: icon, short title, status and time, and an arrow
    // that opens its details underneath.
    const card = (key: string, svg: string, alt: string, title: string, details: string, color: string | undefined, right: string) => {
      if (!Svg) return null
      const isOpen = open.includes(key)
      return (
        <Box key={key} flexDirection="column">
          <Box flexDirection="row" gap={1} alignItems="center">
            <Svg source={svg} alt={alt} width={28} height={28} />
            <Box flexDirection="column" flexGrow={1}>
              <Text bold>{cut(title, Math.max(20, cols - 20))}</Text>
            </Box>
            <Text color={color}>{right}</Text>
            <Button key={`toggle-${key}`} label={isOpen ? '▴' : '▾'} onPress={() => toggle(key)} />
          </Box>
          {isOpen && (
            <Box paddingLeft={5}>
              <Text dimColor>{details}</Text>
            </Box>
          )}
        </Box>
      )
    }

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
                shellTitle(r),
                shellDetails(r, a),
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
  // A background shell past its own timeout cannot still run.
  if (s.some(r => r.status === 'background' && !isLive(r, t))) {
    await update($, shells, l =>
      l.map(r =>
        r.status === 'background' && !isLive(r, t)
          ? { ...r, status: 'stopped', note: 'past its timeout', endedAt: r.startedAt + (r.limitMs ?? 0) || t }
          : r,
      ),
    )
  }
  if (s.some(r => isLive(r, t)) || a.some(r => isLive(r, t))) {
    await update($, now, () => t)
  }
}

function isLive(r: ShellRun | AgentRun, t: number): boolean {
  if (r.status === 'running' || r.status === 'starting') return true
  if (r.status !== 'background') return false
  const limit = 'limitMs' in r && r.limitMs ? r.limitMs : FG_MAX_MS + BG_DEFAULT_MS + GRACE_MS
  return t - r.startedAt < limit
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

// Settles every background shell the in-flight list no longer holds. An
// absent list (an older Claude Code) settles nothing.
async function reconcile(
  $: Engine,
  tasks: ReadonlyArray<{ id: string; type: string; command?: string }> | undefined,
) {
  if (!Array.isArray(tasks)) return
  const ids = new Set(tasks.map(task => task.id))
  const commands = tasks.flatMap(task => (task.command ? [task.command.replace(/\.\.\. \[\+\d+ chars\]$/, '')] : []))
  const alive = (r: ShellRun) =>
    (r.taskId !== undefined && ids.has(r.taskId)) || commands.some(c => c.length > 0 && r.command.startsWith(c))
  const list = await read($, shells)
  if (!list.some(r => r.status === 'background' && !alive(r))) return
  const t = await $.clock.now()
  await update($, shells, l =>
    l.map(r => (r.status === 'background' && !alive(r) ? { ...r, status: 'stopped', endedAt: t, note: 'no longer running' } : r)),
  )
}

// Asks Claude Code where each subagent still marked running stands: one it
// no longer lists, or lists as ended, was settled without the mod hearing
// (Claude Code closed under it). Its own status word decides done or failed.
async function reconcileAgents($: Engine) {
  const list = await read($, agents)
  const open = list.filter(r => r.status === 'running' || r.status === 'starting')
  if (open.length === 0) return
  const known = new Map((await $.agent.list()).map(info => [info.id, info.status]))
  const verdict = (r: AgentRun): { status: AgentStatus; note?: string } | undefined => {
    if (!r.agentId) return undefined
    const status = known.get(r.agentId)
    if (status === undefined) return { status: 'failed', note: 'no longer running' }
    if (status === 'completed') return { status: 'done' }
    if (status === 'failed') return { status: 'failed', note: 'failed' }
    if (status === 'killed') return { status: 'failed', note: 'stopped' }
    return undefined
  }
  const ends = new Map(open.flatMap(r => {
    const v = verdict(r)
    return v ? [[r.id, v] as const] : []
  }))
  if (ends.size === 0) return
  const t = await $.clock.now()
  await update($, agents, l =>
    l.map(r => {
      const v = ends.get(r.id)
      return v && (r.status === 'running' || r.status === 'starting') ? { ...r, ...v, endedAt: t, current: undefined } : r
    }),
  )
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

function shellTitle(r: ShellRun): string {
  return r.description || r.summary || quickSummary(r.command)
}

// A summary read off the command itself, shown at once and until the model's
// arrives: the programs it runs, and the folder it goes to.
//   cd "/a/Personal Assistant" && git ls-files | grep -v x | head -300
//   -> "git ls-files, grep, head in Personal Assistant"
export function quickSummary(command: string): string {
  const parts = command
    .replace(/\\\n/g, ' ')
    .split(/&&|\|\||;|\||\n/)
    .map(p => p.trim())
    .filter(Boolean)
  let folder = ''
  const programs: string[] = []
  for (const part of parts) {
    const words = part.split(/\s+/).filter(w => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) && w !== 'sudo' && w !== 'time' && w !== 'env')
    while (words.length && /^(do|then|else|elif|\{|\()$/.test(words[0] ?? '')) words.shift()
    if (/^(for|while|until|if|case|done|fi|esac|\}|\))$/.test(words[0] ?? '')) continue
    if (/^python3?$/.test(words[0] ?? '') && words[1] === '-m' && words[2]) words.splice(1, 2, words[2])
    const head = (words[0] ?? '').replace(/^["'(]+|["')]+$/g, '')
    if (!head) continue
    if (head === 'cd' || head === 'pushd') {
      const target = part.replace(/^\s*(cd|pushd)\s+/, '').replace(/^["']|["']$/g, '')
      folder = target.split('/').filter(Boolean).pop() ?? ''
      continue
    }
    const name = head.split('/').pop() ?? head
    const sub = words[1] && /^[a-z][a-z-]+$/.test(words[1]) && /^(git|npm|pnpm|yarn|bun|cargo|go|docker|kubectl|pip|uv|gh|claude|flutter|dart|make|python3?|node)$/.test(name) && !/^-/.test(words[1]) && !/[./]/.test(words[1]) ? ` ${words[1]}` : ''
    const script = sub === ' run' && words[2] && !/^-/.test(words[2]) ? ` ${words[2]}` : ''
    const label = name + sub + script
    if (!programs.includes(label)) programs.push(label)
  }
  if (programs.length === 0) return folder ? `Go to ${folder}` : `$ ${firstLine(command)}`
  const shown = programs.length > 4 ? `${programs.slice(0, 4).join(', ')} …` : programs.join(', ')
  return folder ? `${shown} in ${folder}` : shown
}

// Asks a small model for a few words on each command that came without a
// description, a couple at a time, outside any tool call. The answer
// replaces the quick summary; a failure keeps the quick one.
const SUMMARY_PROMPT =
  'Say what this shell command does in 3 to 7 plain English words, active voice, like ' +
  '"Inspect project folder and tools" or "Run the unit tests". No quotes, no paths, no flags, ' +
  'no ending punctuation. Answer with the words only.\n\nCommand:\n'
let asking = 0

async function summarizeShells($: Engine) {
  if (asking >= 2) return
  const list = await read($, shells)
  const next = list.find(r => !r.description && !r.summaryState)
  if (!next) return
  asking += 1
  try {
    await update($, shells, l => l.map(r => (r.id === next.id ? { ...r, summaryState: 'pending' } : r)))
    const command = next.command.length > 1500 ? `${next.command.slice(0, 1500)} …` : next.command
    const answer = await $.model.complete(
      // The lowest effort: a few words need no thinking. Dropped where the
      // model takes no effort setting; given up after 15s.
      { model: 'haiku', prompt: SUMMARY_PROMPT + command, maxTokens: 30, effort: 'low', timeoutMs: 15_000 },
    )
    const words = answer.isAnswered ? firstLine(answer.text).replace(/^["'`]+|["'`.]+$/g, '').trim() : ''
    const summary = words && words.length <= 80 ? words : undefined
    await update($, shells, l =>
      l.map(r => (r.id === next.id ? { ...r, summary, summaryState: summary ? 'done' : 'failed' } : r)),
    )
  } catch {
    await update($, shells, l => l.map(r => (r.id === next.id ? { ...r, summaryState: 'failed' } : r)))
  } finally {
    asking -= 1
  }
}

// The full command, then what else is known of the run.
function shellDetails(r: ShellRun, list: readonly AgentRun[]): string {
  const meta = [
    r.status === 'background' && 'background',
    (r.status === 'denied' || r.status === 'stopped') && (r.note ? `${r.status}: ${r.note}` : r.status),
    r.agentId && `by ${list.find(a => a.agentId === r.agentId)?.type ?? 'subagent'}`,
  ].filter(Boolean)
  const command = r.command.length > 2000 ? `${r.command.slice(0, 2000)}…` : r.command
  return `$ ${command}${meta.length ? `\n${meta.join(' · ')}` : ''}`
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
