import type { Engine, Register, Timer } from 'claude-code'

// Claude Code compacts a conversation left idle for about 54 minutes once it
// reaches this many tokens; smaller ones are left alone. The variable is
// Claude Code's own override of that minimum.
const DEFAULT_IDLE_COMPACT_TOKENS = 200_000

async function idleCompactTokens($: Engine) {
  const minimum = Number(await $.env.get('CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS'))
  return minimum > 0 ? minimum : DEFAULT_IDLE_COMPACT_TOKENS
}

async function notify($: Engine, notifyUrl: string, minutes: number) {
  const project = (await $.session.cwd()).split('/').pop()
  const message = `${project} has been idle ${minutes} minutes and will compact soon.`
  const url = `${notifyUrl}?title=${encodeURIComponent('Claude Code')}&message=${encodeURIComponent(message)}`
  const response = await $.http.fetch(url).catch(() => undefined)
  if (!response?.ok) $.ui.toast(`${$.plugin.name}: the notify server at ${notifyUrl} did not answer.`)
}

export const register: Register = (on, options) => {
  const notifyUrl = String(options.notifyUrl)
  const minutes = Number(options.minutes)
  let timer: Timer | undefined

  const clear = () => {
    timer?.cancel()
    timer = undefined
  }

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) clear()
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result

    clear()
    const { context } = await $.session.usage()
    if ((context.tokens ?? 0) >= (await idleCompactTokens($))) {
      timer = $.clock.after(minutes * 60_000, () => {
        timer = undefined
        void notify($, notifyUrl, minutes)
      })
    }
    return result
  })
}
