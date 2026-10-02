export type LaneKey = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'blocked' | 'done'
export type Ticket = { id: string; title: string; status: string; kind: string; assignee: string; worker: string }
export type Lane = { key: LaneKey; title: string; total: number; tickets: Ticket[] }
export type Weather = { level: number; label: string; glyph: string; percent: number | null }
export type Role = 'planner' | 'scout' | 'cook' | 'heavy' | 'inspector' | 'analyst' | 'steward' | 'agent'
export type AgentState = 'working' | 'done' | 'failed'
export type Agent = {
  id: string
  name: string
  role: Role
  model: string
  dish: string | null
  item: string | null
  ticket: string | null
  lane: LaneKey | 'bench' | null
  state: AgentState
  tokens: number
  startedAt: number
  endedAt: number | null
}
export type Fleet = { agents: Record<string, Agent>; order: string[] }
export type Note = { at: number; dish: string; item: string; role: string; kind: string; gist: string }
export type Snapshot = { lanes: Lane[]; agents: Agent[]; weather: Weather | null; selected: string | null; now: number }
export type Memory = { id: string; name: string; lines: string[] | null }

declare module 'claude-code' {
  interface PluginState {
    brigade: {
      lanes: Lane[]
      fleet: Fleet
      weather: Weather | null
      selected: string | null
      notes: Note[]
      dishes: Record<string, string>
      memory: Memory | null
    }
  }
}
