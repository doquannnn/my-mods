export type ShellStatus = 'running' | 'done' | 'failed' | 'denied' | 'background' | 'stopped'

export type ShellRun = {
  /** The tool call's id. */
  id: string
  /** `Bash` or `PowerShell`. */
  tool: string
  command: string
  description?: string
  /** A short summary for a command that came without a description. */
  summary?: string
  /** Whether the model summary was asked for: pending, then done or failed. */
  summaryState?: 'pending' | 'done' | 'failed'
  /** The subagent that ran it; absent for the main conversation. */
  agentId?: string
  status: ShellStatus
  isBackground: boolean
  /** Background task id, when the command went to the background. */
  taskId?: string
  startedAt: number
  endedAt?: number
}

export type AgentStatus = 'starting' | 'running' | 'done' | 'failed'

export type AgentRun = {
  /** Unique per spawn. */
  id: string
  /** The Agent tool call that started it, when one did. */
  toolUseId?: string
  /** The loop id the engine gives the subagent. */
  agentId?: string
  parentAgentId?: string
  type: string
  description: string
  model: string
  isBackground: boolean
  status: AgentStatus
  note?: string
  startedAt: number
  endedAt?: number
  /** Model requests made by the subagent. */
  steps: number
  /** Tool calls made by the subagent. */
  tools: number
  /** Tokens counted from its finished turns (input, output and cache). */
  tokens: number
  /** What it is doing right now (its latest tool call). */
  current?: string
}

declare module 'claude-code' {
  interface PluginState {
    'savvy-progress': {
      shells: Shaped<ShellRun[]>
      agents: Shaped<AgentRun[]>
      now: number
      batchStart: number
      isHidden: boolean
      /** Keys of the pane cards whose details are open. */
      expanded: string[]
    }
  }
}
