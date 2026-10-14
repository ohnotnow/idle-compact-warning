import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionUsage } from 'claude-code'

const MINUTE = 60_000

const world = (on: On, tokens: number, variables: Record<string, string> = {}) => {
  const clock = mock.clock(on)
  mock.env(on, variables)
  const fetched: string[] = []
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window: 1_000_000 }, rateLimits: [] } as SessionUsage }))
  on('session.cwd', () => ({ value: '/Users/someone/code/blether' }))
  on('http.fetch', (_$, e) => {
    fetched.push(e.url)
    return { value: { status: 200, ok: true, headers: {}, text: '' } }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  return { clock, fetched }
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
