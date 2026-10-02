export type LaneKey = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'blocked' | 'done'
export type Ticket = { id: string; title: string; status: string; kind: string; assignee: string; worker: string }
export type Lane = { key: LaneKey; title: string; total: number; tickets: Ticket[] }
export type Weather = { level: number; label: string; glyph: string; percent: number | null }
export type Role = 'planner' | 'scout' | 'cook' | 'heavy' | 'inspector' | 'analyst' | 'steward' | 'agent'
export type AgentState = 'working' | 'done' | 'failed'

// The five lanes of the task board, and a card in one of them: a work item, or a ticket when no
// dish is being worked.
export type Phase = 'todo' | 'cooking' | 'review' | 'rework' | 'done'
export type WorkCard = { id: string; title: string; phase: Phase; tag: string | null; alert: boolean }
export type WorkLane = { key: Phase; title: string; total: number; cards: WorkCard[] }
// The header: which repo and branch, the ticket's title and one line of detail under it.
export type Project = { mode: 'dish' | 'tickets'; repo: string; branch: string | null; title: string; detail: string }
// One thing an agent said to another, read from a report, verdict or brief on disk.
export type Message = { id: string; at: number; from: string; to: string; item: string; text: string; file: string | null }
export type Learnings = { total: number; lines: string[] }
// The box that opens over the board when a card, an agent or a message is clicked.
export type Detail = { kind: 'card' | 'agent' | 'message'; id: string; title: string; lines: string[] }

// An agent as the board draws it. `card` is the id of the card it stands on, or null (it stands with the crew).
export type Agent = {
  id: string
  name: string
  role: string
  model: string | null
  state: AgentState
  dish: string | null
  item: string | null
  ticket: string | null
  card: string | null
  activity: string | null
  tokens: number
  startedAt: number | null
  endedAt: number | null
}
export type Fleet = { agents: Record<string, Agent>; order: string[] }
// What one artifact on disk says. `findings` is a verdict's finding count, or a plan check's
// blocking count (null when it lists none); `file` is where it sits inside the dish folder.
export type Note = {
  at: number
  dish: string
  item: string
  role: string
  kind: string
  gist: string
  findings: number | null
  summary: string
  attempt: number
  file: string | null
}
export type Snapshot = {
  project: Project
  lanes: WorkLane[]
  agents: Agent[]
  weather: Weather | null
  messages: Message[]
  learnings: Learnings
  detail: Detail | null
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    brigade: {
      lanes: Lane[]
      fleet: Fleet
      weather: Weather | null
      selected: string | null
      notes: Note[]
      dishes: Record<string, string>
      project: Project
      work: WorkLane[]
      messages: Message[]
      learnings: Learnings
      detail: Detail | null
    }
  }
}
