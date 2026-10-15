import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

// Claude Code compacts a conversation left idle for about 54 minutes once it
// reaches this many tokens; smaller ones are left alone. The variable is
// Claude Code's own override of that minimum.
const DEFAULT_IDLE_COMPACT_TOKENS = 200_000

async function idleCompactTokens($: EngineInterface) {
  const minimum = Number(await $.env.get('CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS'))
  return minimum > 0 ? minimum : DEFAULT_IDLE_COMPACT_TOKENS
}

// A shared debug log of what the mod saw and did, one line per event, the
// newest LOG_LINES kept. $.fs has no append, so writes are read-then-write,
// chained so one session's lines never overwrite each other.
const LOG_LINES = 2000
let logged = Promise.resolve()

function log($: EngineInterface, line: string) {
  logged = logged.then(async () => {
    const path = `${await $.env.get('HOME')}/.claude/idle-compact-warning.log`
    const stamp = new Date(await $.clock.now()).toISOString()
    const session = (await $.session.id()).slice(0, 8)
    const project = (await $.session.cwd()).split('/').pop()
    const old = await $.fs.read(path).catch(() => '')
    const lines = [...old.split('\n').filter(Boolean), `${stamp} ${session} ${project}: ${line}`]
    await $.fs.write(path, lines.slice(-LOG_LINES).join('\n') + '\n')
  }).catch(() => {})
  return logged
}

// The warning shown in the band above the prompt, null while there is none.
const warning = atom({ plugin: 'idle-compact-warning', key: 'warning' } as const, null)

async function notify($: EngineInterface, notifyUrl: string, minutes: number) {
  const project = (await $.session.cwd()).split('/').pop()
  const message = `${project} has been idle ${minutes} minutes and will compact soon.`
  await update($, warning, () => message)

  // The person's own notification channel writes to the terminal, so it
  // reaches them over ssh and tmux where the notify URL may not.
  const bell = await $.ui.notify(message, { title: 'Claude Code' }).catch(() => undefined)
  log($, `terminal ${bell?.isSent ? `notified (${bell.channel})` : `not notified (${bell?.reason ?? 'error'})`}`)

  const url = `${notifyUrl}?title=${encodeURIComponent('Claude Code')}&message=${encodeURIComponent(message)}`
  const response = await $.http.fetch(url).catch(() => undefined)
  log($, `notify ${response?.ok ? 'sent' : `failed (status ${response?.status ?? 'none'})`}`)
  if (!response?.ok) $.ui.toast(`${$.plugin.name}: the notify server at ${notifyUrl} did not answer.`)
}

export const register: Register = (on, options) => {
  const notifyUrl = String(options.notifyUrl)
  const minutes = Number(options.minutes)
  let timer: Timer | undefined

  // True when there was a timer to cancel.
  const clear = () => {
    const hadTimer = timer !== undefined
    timer?.cancel()
    timer = undefined
    return hadTimer
  }

  on('session.start', ($, e, next) => {
    log($, `loaded (warn after ${minutes} minutes)`)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      log($, `turn.start main loop, prompt ${e.text === '' ? 'empty' : `${e.text.length} chars`}`)
      if (clear()) log($, 'timer cancelled by turn.start')
      if (await read($, warning)) await update($, warning, () => null)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result

    if (clear()) log($, 'timer cancelled by turn.complete')
    const { context } = await $.session.usage()
    const tokens = context.tokens ?? 0
    const threshold = await idleCompactTokens($)
    if (tokens >= threshold) {
      timer = $.clock.after(minutes * 60_000, () => {
        timer = undefined
        log($, `timer reached ${minutes} minutes`)
        notify($, notifyUrl, minutes).catch(error => log($, `notify threw: ${error}`))
      })
    }
    log($, `turn.complete (${e.reason}) at ${tokens} tokens, threshold ${threshold}: ${timer ? `timer started for ${minutes} minutes` : 'no timer'}`)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const message = await read($, warning)
    if (message === null || e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text color="warning" weight="bold">⚠ {message} </Text>
        <Button key="dismiss" label="Dismiss" onPress={() => update($, warning, () => null)} />
      </Box>
    )
  })
}
