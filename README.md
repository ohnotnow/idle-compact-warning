# idle-compact-warning

A Claude Code mod that warns you before Claude Code compacts an idle conversation.

## What it does

Claude Code compacts a conversation of 200K tokens or more that has been left idle for about 54 minutes. Sometimes you would rather come back first, carry on with the full context, or ask Claude to write up handover notes while it still has all the detail.

This mod starts a timer each time Claude finishes a turn in a conversation that big. If nothing new happens for 45 minutes, it calls a notification URL of your choosing, with a message naming the project folder:

```
http://localhost:8001/notify?title=Claude%20Code&message=my-project%20has%20been%20idle%2045%20minutes%20and%20will%20compact%20soon.
```

At the same time it:

- shows the same message in a band above the prompt, with a Dismiss button. Your next prompt clears it too.
- sends it through Claude Code's own notification setting (`/config`, Notifications). That is written to the terminal, so it reaches you over SSH and inside tmux, where the notify URL may not. Choose `terminal_bell` if you want a plain bell that makes your terminal highlight the tab.

Any new turn cancels the timer. If the notification server does not answer, the mod shows a toast in Claude Code as well.

## Prerequisites

- Claude Code v2.1.290 or later.
- Optionally, something listening at the notify URL. Any HTTP endpoint that accepts a GET with `title` and `message` query parameters will do.  See [this notification API server for example](https://github.com/ohnotnow/macos-notification-api-go). Without one, you still get the band and the terminal notification, plus a toast saying the server did not answer.

## Getting started

Install it from inside Claude Code:

```
/plugin install idle-compact-warning --marketplace ohnotnow/idle-compact-warning
```

Answer `y` to add the marketplace, then pick a scope.

## Configuration

Both settings are in Claude Code's config menu:

| Setting | Default | What it is |
|---------|---------|------------|
| Notify URL | `http://localhost:8001/notify` | The endpoint to call. |
| Warn after (minutes) | `45` | How long a large conversation sits idle before the warning. Keep it under 54, or the warning arrives after the compaction. |

## Turning idle compaction off instead

If you would rather idle compaction never happened, set `"idleCompaction": false` in Claude Code's `settings.json`. `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` changes its 200K-token minimum, and the mod follows it.

## Contributing

Fork or clone the repository, make your change in `hooks/register.tsx`, and run the tests:

```
claude plugin test .
```

`claude plugin validate .` checks the manifest and hooks module. To try a local copy in a real session, add the folder as a marketplace:

```
claude plugin marketplace add /path/to/idle-compact-warning
claude plugin install idle-compact-warning@idle-compact-warning
```

After editing, `/reload-plugins` picks up the change.

## Licence

MIT. See [LICENSE](LICENSE).
