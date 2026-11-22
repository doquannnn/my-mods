// The shape of one skin, as hellosverre/claude-skins writes it (MIT).
export type Slot =
  | 'read' | 'write' | 'run' | 'search' | 'web' | 'mcp' | 'other' | 'user'
  | 'fg' | 'muted' | 'surface' | 'zebra' | 'ok' | 'err' | 'warn'

export type Palette = Readonly<Record<Slot, string>>

export type Skin = {
  readonly name: string
  readonly label: string
  readonly palette: Palette
  readonly spinner: readonly string[]
  readonly done: readonly string[]
  // Its own palette for a light background; a skin without one is dark only.
  readonly light?: Palette
  readonly ansi?: Palette
}
