// What the band above the prompt shows: the warning, or null for none.
export type Warning = string | null

declare module 'claude-code' {
  interface PluginState {
    'idle-compact-warning': { warning: Warning }
  }
}
