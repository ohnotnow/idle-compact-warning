import { expect, mock, test } from 'claude-code/testing'
import type { MountTarget } from 'claude-code/testing'
import type { On, RenderElement, SessionUsage } from 'claude-code'

const MINUTE = 60_000

const world = (on: On, tokens: number, variables: Record<string, string> = {}) => {
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/Users/someone', ...variables })
  const fetched: string[] = []
  const notified: string[] = []
  const files: Record<string, string> = {}
  on('fs.read', (_$, e) => {
    if (!(e.path in files)) throw new Error('ENOENT')
    return { value: files[e.path]! }
  })
  on('fs.write', (_$, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'abcdef12-3456' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window: 1_000_000 }, rateLimits: [] } as SessionUsage }))
  on('session.cwd', () => ({ value: '/Users/someone/code/blether' }))
  on('http.fetch', (_$, e) => {
    fetched.push(e.url)
    return { value: { status: 200, ok: true, headers: {}, text: '' } }
  })
  on('ui.notify', (_$, e) => {
    notified.push(e.text)
    return { value: { isSent: true, channel: 'terminal_bell' } }
  })
  // Stands in for the engine's own band, drawn when the mod has nothing to show.
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as RenderElement)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  return { clock, fetched, notified, files }
}

const endTurn = { answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const

test('a large session left idle gets one notification at 45 minutes', async ($, on) => {
  const { clock, fetched } = world(on, 250_000)
  await $.turn.complete(endTurn)

  await clock.advance(44 * MINUTE)
  expect(fetched).toEqual([])

  await clock.advance(1 * MINUTE)
  expect(fetched.length).toBe(1)
  expect(fetched[0]).toContain('http://localhost:8001/notify?title=Claude%20Code&message=blether%20has%20been%20idle')

  await clock.advance(60 * MINUTE)
  expect(fetched.length).toBe(1)
})

test('a new turn before the time is up cancels the warning', async ($, on) => {
  const { clock, fetched } = world(on, 250_000)
  await $.turn.complete(endTurn)
  await clock.advance(30 * MINUTE)

  await $.turn.start({ text: 'carry on', turnId: 't2' })
  await clock.advance(30 * MINUTE)
  expect(fetched).toEqual([])
})

test('a small session is never warned about', async ($, on) => {
  const { clock, fetched } = world(on, 150_000)
  await $.turn.complete(endTurn)
  await clock.advance(60 * MINUTE)
  expect(fetched).toEqual([])
})

test('a subagent finishing does not start the timer', async ($, on) => {
  const { clock, fetched } = world(on, 250_000)
  await $.turn.complete({ ...endTurn, agentId: 'a1' })
  await clock.advance(60 * MINUTE)
  expect(fetched).toEqual([])
})

test('the URL and minutes come from the settings', { options: { notifyUrl: 'http://elsewhere:9000/n', minutes: 10 } }, async ($, on) => {
  const { clock, fetched } = world(on, 250_000)
  await $.turn.complete(endTurn)
  await clock.advance(10 * MINUTE)
  expect(fetched[0]).toContain('http://elsewhere:9000/n?')
})

test('CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS lowers the size that counts as large', async ($, on) => {
  const { clock, fetched } = world(on, 150_000, { CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS: '100000' })
  await $.turn.complete(endTurn)
  await clock.advance(45 * MINUTE)
  expect(fetched.length).toBe(1)
})

test('a CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS that is not a number falls back to 200K', async ($, on) => {
  const { clock, fetched } = world(on, 150_000, { CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS: 'lots' })
  await $.turn.complete(endTurn)
  await clock.advance(60 * MINUTE)
  expect(fetched).toEqual([])
})

test('the debug log records the timer starting, being cancelled and firing', async ($, on) => {
  const { clock, files } = world(on, 250_000)

  await $.turn.complete(endTurn)
  await clock.advance(10 * MINUTE)
  await $.turn.start({ text: '', turnId: 't2' })
  await $.turn.complete({ ...endTurn, turnId: 't2' })
  await clock.advance(45 * MINUTE)

  const lines = files['/Users/someone/.claude/idle-compact-warning.log']!.trim().split('\n')
  expect(lines.map(line => line.split(': ').slice(1).join(': '))).toEqual([
    'turn.complete (answer) at 250000 tokens, threshold 200000: timer started for 45 minutes',
    'turn.start main loop, prompt empty',
    'timer cancelled by turn.start',
    'turn.complete (answer) at 250000 tokens, threshold 200000: timer started for 45 minutes',
    'timer reached 45 minutes',
    'terminal notified (terminal_bell)',
    'notify sent',
  ])
  expect(lines[0]).toContain(' abcdef12 blether: ')
})

test('the warning also goes to the terminal through the person\'s notification channel', async ($, on) => {
  const { clock, notified } = world(on, 250_000)
  await $.turn.complete(endTurn)
  await clock.advance(45 * MINUTE)
  expect(notified).toEqual(['blether has been idle 45 minutes and will compact soon.'])
})

const band = (surface: 'terminal' | 'desktop') => ({
  plugin: 'idle-compact-warning',
  surface,
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 },
}) as unknown as MountTarget<typeof surface, 'AbovePrompt'>

const bandText = async (uis: { find: (query: { type: 'Text'; text: RegExp }) => Promise<unknown> }[]) =>
  Promise.all(uis.map(ui => ui.find({ type: 'Text', text: /idle/ })))

test('the band above the prompt shows the warning until the next turn', async ($, on) => {
  const { clock } = world(on, 250_000)
  await $.turn.complete(endTurn)
  const uis = [await $.ui.mount(band('terminal')), await $.ui.mount(band('desktop'))]
  expect(await bandText(uis)).toEqual([undefined, undefined])

  await clock.advance(45 * MINUTE)
  for (const found of await bandText(uis)) expect(found).toBeDefined()

  await $.turn.start({ text: 'back again', turnId: 't2' })
  expect(await bandText(uis)).toEqual([undefined, undefined])
})

test('Dismiss takes the warning off the band', async ($, on) => {
  const { clock } = world(on, 250_000)
  await $.turn.complete(endTurn)
  await clock.advance(45 * MINUTE)
  const uis = [await $.ui.mount(band('terminal')), await $.ui.mount(band('desktop'))]

  await uis[0]!.press({ key: 'dismiss' })
  expect(await bandText(uis)).toEqual([undefined, undefined])
})
