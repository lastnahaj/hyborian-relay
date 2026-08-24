# Hyborian Relay

Hyborian Relay is a Linux service for Conan Exiles Enhanced communities. It relays verified Global
chat between Discord and Conan, tracks current players and play sessions, records supported death
events, publishes server activity, and exposes operational health without turning Discord into a
general-purpose administration console.

Current version: **1.0.0 (Beta)**

Release status: **Beta**. Run the diagnostics and verify the documented Pippi chat and death-event
formats against the community's live server before relying on event publication.

## Features

- Discord chat to Conan through a confirmed Enhanced Pippi `server` command or an explicitly
  selected Conan broadcast command
- Verified Pippi Global chat to Discord with private-channel and mention protection
- Player presence, joins, leaves, current sessions, and server online/offline tracking
- Strict player, creature, non-player-character, environmental, self-inflicted, and unknown death
  classifications
- SQLite persistence with WAL mode, migrations, and restart recovery
- Discord `/players` and `/status` commands plus an optional persistent status message
- Bounded chat rate limits, echo suppression, reconnects, rotating-log support, structured logs,
  diagnostics, and HTTP health endpoints
- systemd and non-root Docker deployments

Hyborian Relay does not provide arbitrary RCON, kick, ban, restart, economy, rank, role, account
linking, clan administration, or a web administration panel.

## Architecture

```text
Discord Gateway                         Conan / Pippi log
      |                                       |
safe message filter                    rotating log follower
      |                                       |
bounded RCON queue                 chat and death parsers
      |                                       |
Conan RCON <---- player polling          Discord publisher
      |                  |                    |
Enhanced server      reconciliation ------ SQLite
```

One process owns the database and lock file. Discord, RCON, log following, persistence, tracking,
and health reporting can degrade independently, so a temporary outage in one external service does
not discard unrelated state.

## Requirements and supported platform

- Linux with a Conan Exiles Enhanced dedicated server
- Node.js 22 and npm
- A Discord application and bot
- Private TCP access to Conan RCON, normally port 25575
- Read access to `ConanSandbox/Saved/Logs/ConanSandbox.log` when game-to-Discord chat or death
  tracking is enabled
- Enhanced Pippi when its server-chat transport or `PippiChat` log events are used

The primary deployment is systemd. Docker and Docker Compose are supported as a secondary Linux
deployment. Hyborian Relay does not include Windows service support.

## Enhanced Pippi and chat transport detection

Enhanced Pippi supplies chat and administration features, but Hyborian Relay does not assume that an
older command remains present. With `GAME_CHAT_TRANSPORT=automatic`, the service reads RCON `help`
output and selects `pippi-server` only when a clear `server <message>`-style command is listed. It
never emits a visible probe message and never silently switches to broadcast.

If capability detection cannot prove support, Discord-to-Conan chat is reported unavailable.
Operators who have verified their server can select `pippi-server` explicitly. `broadcast` must also
be selected explicitly because its presentation differs from ordinary chat. `disabled` turns off
that direction.

## RCON setup and security

Enable Conan RCON with a strong password and confirm the server listens on its configured TCP port.
When Hyborian Relay runs on the Conan host, use:

```env
CONAN_RCON_HOST=127.0.0.1
CONAN_RCON_PORT=25575
```

RCON grants administrative access. Never publish it to the public Internet. For a separate host or
container, use a private network, host firewall rules, and a route limited to the relay host. The
RCON password belongs only in `.env`; it is redacted from structured logs.

## Create the Discord application

1. Open the Discord Developer Portal and create an application named **Hyborian Relay**.
2. Open **Bot**, create the bot user, and copy its token into a private password manager. Put it in
   `DISCORD_BOT_TOKEN` only after creating `.env`.
3. Under **Privileged Gateway Intents**, enable **Message Content Intent**. Do not enable unrelated
   privileged intents.
4. Copy the application identifier from **General Information** into `DISCORD_APPLICATION_ID`.
5. Open **OAuth2 > URL Generator**. Select the `bot` and `applications.commands` scopes.
6. Select only **View Channels**, **Send Messages**, **Read Message History**, **Embed Links**, and
   **Use Application Commands**. Do not grant Administrator.
7. Open the generated invitation, choose the intended Discord server, and authorize the bot.
8. Enable Discord Developer Mode, then copy the server identifier into `DISCORD_GUILD_ID`.

The bot uses only the Guilds, Guild Messages, and Message Content gateway intents. It does not
manage webhooks, so Manage Webhooks is not required.

## Discord channel layout

A simple community can use:

```text
#conan-chat
#conan-events
```

Copy those channel identifiers into `DISCORD_CHAT_CHANNEL_ID` and `DISCORD_EVENT_CHANNEL_ID`. Leave
`DISCORD_DEATH_CHANNEL_ID` empty and deaths will use the event channel.

A separated layout can use:

```text
#conan-chat
#conan-events
#conan-deaths
```

Set the third identifier in `DISCORD_DEATH_CHANNEL_ID`. The relay ignores messages from other guilds
and channels, all bot authors, webhook authors, system messages, and empty messages.

## Optional game-chat webhook

Bot rendering is the default and needs no webhook. To render Conan speakers with individual display
names, create a webhook for the chat channel, set `DISCORD_GAME_CHAT_RENDERING=webhook`, and put its
secret URL in `DISCORD_GAME_CHAT_WEBHOOK_URL`. The service never logs that URL. Webhook messages are
ignored on the Discord-to-Conan path to prevent loops.

## Conan log path and permissions

Set `CONAN_LOG_PATH` to the live server log. A common layout is:

```env
CONAN_LOG_PATH=/srv/conan/ConanSandbox/Saved/Logs/ConanSandbox.log
```

The service account needs directory traversal and file read access. Use the Conan service's actual
group rather than making the log world-readable. If that group is `conanserver`, the approach is:

```bash
sudo usermod -aG conanserver hyborianrelay
sudo chmod g+rx /srv/conan /srv/conan/ConanSandbox /srv/conan/ConanSandbox/Saved
sudo chmod g+rx /srv/conan/ConanSandbox/Saved/Logs
sudo chmod g+r /srv/conan/ConanSandbox/Saved/Logs/ConanSandbox.log
```

Replace `conanserver` with the real service group. Do not use `chmod 777`. Log rotation tooling must
preserve group readability on newly created logs.

## Chat privacy and supported log events

The Version 1 chat parser recognizes Pippi log entries shaped like:

```text
[2026.08.21-18.10.01:120][Pippi]PippiChat: Vaelric said in channel [Global]: Anyone running the Wine Cellar?
```

Only a source that explicitly identifies its channel can be trusted. Global is allowed by default.
Local, Clan, Whisper, Private, and unknown channels are blocked. If the server emits a different
format, the event is ignored instead of guessed. `ALLOW_UNKNOWN_GAME_CHAT_CHANNEL=true` is an
explicit privacy override and should be used only after inspecting the server's real logs.

Discord allowed-mention controls prevent Conan messages from pinging everyone, roles, or users.
Markdown is escaped by default. Chat content is not logged at info level.

## Death tracking

Death information comes from strict Pippi or Conan game-event lines in the configured log. The
supported structured phrases explicitly identify a player killer, creature, non-player character,
environmental cause, self-inflicted death, or a death with unknown details. For instance:

```text
[2026.08.21-19.01.02:100][Pippi]PippiEvent: Serapha was killed by player Kaedren.
[2026.08.21-19.02.03:200][Pippi]PippiEvent: Torven was killed by creature Rocknose.
[2026.08.21-19.04.05:400][Pippi]PippiEvent: Mirelda died from falling.
```

Available detail depends on the Enhanced server and Pippi log format. Hyborian Relay never guesses a
killer or cause. An untyped killer remains unknown unless exactly one stored player identity proves
the name. Semantic fingerprints suppress duplicate lines within
`DEATH_EVENT_DUPLICATE_WINDOW_SECONDS`, and a database uniqueness constraint prevents duplicate
storage of the same source event.

Deaths are stored even when `PUBLISH_DEATH_EVENTS=false`. A separate death channel is optional. With
`CONAN_LOG_START_POSITION=end`, historical lines already present at startup are neither stored nor
replayed to Discord. Until a supported live event is observed, `/status` distinguishes "parser
available, no live sample observed" from a recognized format. A death-like event from a supported
source with an unfamiliar structure changes death tracking to degraded instead of guessing. Debug
logging then includes a sanitized, 320-character parser excerpt for diagnosis; review that privacy
tradeoff before leaving debug logging enabled.

## Install from a release checkout

Clone the public repository and select the Version 1 release:

```bash
git clone https://github.com/lastnahaj/hyborian-relay.git
cd hyborian-relay
git checkout v1.0.0
```

From the repository root:

```bash
node --version
npm ci
npm run build
cp .env.example .env
chmod 600 .env
```

Node must report major version 22. Edit `.env`, then run diagnostics before starting the service:

```bash
npm run doctor
```

The doctor performs configuration, runtime, data-directory, Discord, channel-permission, RCON,
`listplayers`, capability, log, database, webhook, and health-bind checks without sending visible
test chat.

Doctor exit codes are stable:

| Code | Meaning                                        |
| ---: | ---------------------------------------------- |
|    0 | Required checks passed                         |
|    1 | Configuration or runtime failure               |
|    2 | Discord failure                                |
|    3 | RCON failure                                   |
|    4 | Filesystem or Conan log failure                |
|    5 | Database failure                               |
|    6 | Unsafe or unsupported game-event configuration |
|    7 | Multiple required components failed            |

## Configuration reference

Blank secrets in `.env.example` are intentional. Boolean values accept only `true` or `false`.
Intervals and capacities must be positive integers within the validator's safe range.

### Application

| Variable    | Default      | Required | Purpose and accepted values                                     |
| ----------- | ------------ | -------- | --------------------------------------------------------------- |
| `NODE_ENV`  | `production` | No       | `development`, `test`, or `production`                          |
| `LOG_LEVEL` | `info`       | No       | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent` |

### Discord

| Variable                         | Default | Required                    | Purpose and security                                        |
| -------------------------------- | ------- | --------------------------- | ----------------------------------------------------------- |
| `DISCORD_BOT_TOKEN`              | empty   | Yes                         | Bot secret; store only in mode-600 `.env`                   |
| `DISCORD_APPLICATION_ID`         | empty   | Yes                         | 17-20 digit bot application identifier                      |
| `DISCORD_GUILD_ID`               | empty   | Yes                         | Only this guild is accepted                                 |
| `DISCORD_CHAT_CHANNEL_ID`        | empty   | Yes                         | Two-way chat channel                                        |
| `DISCORD_EVENT_CHANNEL_ID`       | empty   | Yes                         | Joins, leaves, server events, and death fallback            |
| `DISCORD_DEATH_CHANNEL_ID`       | empty   | No                          | Dedicated death channel; empty uses the event channel       |
| `DISCORD_PENDING_EVENT_LIMIT`    | `500`   | No                          | Maximum short-lived events retained during a Discord outage |
| `DISCORD_STATUS_MESSAGE_ENABLED` | `false` | No                          | Maintain one edited status message                          |
| `DISCORD_STATUS_CHANNEL_ID`      | empty   | When status message enabled | Channel containing the persistent status message            |
| `DISCORD_GAME_CHAT_RENDERING`    | `bot`   | No                          | `bot` or `webhook`                                          |
| `DISCORD_GAME_CHAT_WEBHOOK_URL`  | empty   | In webhook mode             | Secret webhook URL; never logged                            |
| `ESCAPE_GAME_CHAT_MARKDOWN`      | `true`  | No                          | Escape Conan-originated names and messages                  |

### Conan RCON and outbound chat

| Variable                            | Default     | Required | Purpose and accepted values                             |
| ----------------------------------- | ----------- | -------- | ------------------------------------------------------- |
| `CONAN_RCON_HOST`                   | `127.0.0.1` | Yes      | Private RCON host; never expose publicly                |
| `CONAN_RCON_PORT`                   | `25575`     | Yes      | RCON TCP port, 1-65535                                  |
| `CONAN_RCON_PASSWORD`               | empty       | Yes      | RCON secret; never logged                               |
| `RCON_COMMAND_TIMEOUT_MILLISECONDS` | `5000`      | No       | Authentication and command timeout                      |
| `RCON_COMMAND_QUEUE_LIMIT`          | `100`       | No       | Maximum pending serialized commands                     |
| `GAME_CHAT_TRANSPORT`               | `automatic` | No       | `automatic`, `pippi-server`, `broadcast`, or `disabled` |
| `GAME_CHAT_DISCORD_PREFIX`          | `[Discord]` | No       | Prefix placed before Discord speakers in Conan          |
| `GAME_CHAT_MAXIMUM_CHARACTERS`      | `400`       | No       | Per-part Unicode character limit, 80-2000               |

### Conan logs and chat relay

| Variable                             | Default  | Required                           | Purpose and accepted values                                                                             |
| ------------------------------------ | -------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `CONAN_LOG_PATH`                     | empty    | For game-to-Discord chat or deaths | Live UTF-8 Conan log path                                                                               |
| `CONAN_LOG_START_POSITION`           | `end`    | No                                 | `end` avoids history replay; `beginning` reads existing content                                         |
| `GAME_CHAT_ALLOWED_CHANNELS`         | `global` | No                                 | Comma-separated `global`, `local`, `clan`, `whisper`, `unknown`; expanding this can expose private chat |
| `ALLOW_UNKNOWN_GAME_CHAT_CHANNEL`    | `false`  | No                                 | Explicit override required before unknown channels can publish                                          |
| `CHAT_RELAY_ENABLED`                 | `true`   | No                                 | Master chat-relay switch                                                                                |
| `DISCORD_TO_GAME_CHAT_ENABLED`       | `true`   | No                                 | Enable Discord-to-Conan direction                                                                       |
| `GAME_TO_DISCORD_CHAT_ENABLED`       | `true`   | No                                 | Enable verified Conan-to-Discord direction                                                              |
| `CHAT_USER_MESSAGE_LIMIT`            | `5`      | No                                 | Messages per user window                                                                                |
| `CHAT_USER_MESSAGE_WINDOW_SECONDS`   | `10`     | No                                 | Per-user rate window                                                                                    |
| `CHAT_GLOBAL_MESSAGE_LIMIT`          | `30`     | No                                 | Messages across all users per global window                                                             |
| `CHAT_GLOBAL_MESSAGE_WINDOW_SECONDS` | `10`     | No                                 | Global rate window                                                                                      |
| `CHAT_ECHO_MEMORY_SECONDS`           | `60`     | No                                 | Lifetime of outbound SHA-256 echo fingerprints                                                          |
| `CHAT_ECHO_MAXIMUM_ENTRIES`          | `1000`   | No                                 | Bounded echo-fingerprint capacity                                                                       |

### Players, sessions, and server state

| Variable                            | Default | Required | Purpose                                            |
| ----------------------------------- | ------- | -------- | -------------------------------------------------- |
| `TRACK_PLAYERS`                     | `true`  | No       | Poll and reconcile `listplayers`                   |
| `TRACK_PLAYER_SESSIONS`             | `true`  | No       | Persist sessions; requires player tracking         |
| `PUBLISH_JOIN_LEAVE_EVENTS`         | `true`  | No       | Publish confirmed ordinary joins and leaves        |
| `PLAYER_POLL_INTERVAL_SECONDS`      | `30`    | No       | Background player-poll interval                    |
| `PLAYER_MISSING_POLLS_BEFORE_LEAVE` | `2`     | No       | Successful missing snapshots required before leave |
| `SERVER_FAILURES_BEFORE_OFFLINE`    | `3`     | No       | Consecutive RCON failures before offline state     |
| `SERVER_MAXIMUM_PLAYERS`            | empty   | No       | Optional positive capacity shown in Discord        |

### Deaths, storage, and health

| Variable                               | Default                    | Required | Purpose and security                                       |
| -------------------------------------- | -------------------------- | -------- | ---------------------------------------------------------- |
| `TRACK_PLAYER_DEATHS`                  | `true`                     | No       | Parse and persist supported deaths                         |
| `PUBLISH_DEATH_EVENTS`                 | `true`                     | No       | Publish stored deaths to Discord                           |
| `DEATH_EVENT_DUPLICATE_WINDOW_SECONDS` | `10`                       | No       | Semantic duplicate window                                  |
| `DATABASE_PATH`                        | `./data/hyborian-relay.db` | No       | SQLite path; directory must be private and writable        |
| `HEALTH_SERVER_ENABLED`                | `true`                     | No       | Enable health HTTP server                                  |
| `HEALTH_SERVER_HOST`                   | `127.0.0.1`                | No       | Bind host; keep private unless protected by infrastructure |
| `HEALTH_SERVER_PORT`                   | `8787`                     | No       | Bind port, 1-65535                                         |

## Run manually

Development execution uses TypeScript directly:

```bash
npm run dev
```

Production execution uses compiled JavaScript:

```bash
npm run build
npm start
```

Structured JSON records go to stdout and stderr for collection by journald or container logging.
Stop with SIGINT or SIGTERM. Shutdown stops incoming chat and polling, closes the log follower,
rejects queued work safely, disconnects external clients, closes health and SQLite, and releases the
instance lock.

## Install with systemd

The installer creates the dedicated account when necessary. To create it manually:

```bash
sudo useradd \
  --system \
  --home-dir /opt/hyborian-relay \
  --shell /usr/sbin/nologin \
  hyborianrelay
```

After `npm ci`, `npm run check`, and `npm run build`:

```bash
sudo ./scripts/install-systemd.sh
sudoedit /opt/hyborian-relay/.env
sudo chmod 600 /opt/hyborian-relay/.env
sudo systemctl enable --now hyborian-relay
```

The installer preserves an existing `.env` and `data` directory. It restricts writes to the data
directory and installs the hardened unit without running the service as root.

Operate it with:

```bash
sudo systemctl status hyborian-relay
sudo systemctl restart hyborian-relay
sudo journalctl -u hyborian-relay -f
sudo ./scripts/validate-installation.sh
```

If the Conan log lives outside `/opt/hyborian-relay`, grant the service account group access as
described earlier. `ProtectSystem=strict` remains enabled; access is granted through normal Unix
permissions rather than weakening the complete filesystem sandbox.

## Docker and Docker Compose

Build and run the image without secrets in its layers:

```bash
docker build -t hyborian-relay:1.0.0 .
docker compose config
docker compose up -d
```

Compose mounts `./data` persistently, mounts the Conan log directory read-only, and publishes only
the health endpoint on loopback. It does not publish RCON. The container runs as the non-root Node
user.

The supplied Compose file uses `host.docker.internal` with Linux's host-gateway mapping for a Conan
server on the same host. If Conan is in another container, attach both services to a private Docker
network and set `CONAN_RCON_HOST` to the Conan service name. If Conan is on another machine, use its
private address and restrict port 25575 to the Docker host. Adjust the host log mount to the actual
installation path.

## Health endpoints

The default loopback endpoints are:

- `GET /health/live` returns 200 while the process can serve requests.
- `GET /health/ready` returns 200 only when required configured components are ready, otherwise 503.
- `GET /health` returns sanitized version, component states, online count, and uptime with 200
  or 503.

Tokens, passwords, webhook URLs, environment contents, authorization headers, chat content, and raw
log lines are never returned.

## Discord commands

`/players` displays a live or explicitly stale snapshot:

```text
Players Online — 4 / 40

Brannoc
Nyssara
Rhovan
Selvara
```

`/status` displays the application version, Conan and RCON states, player snapshot age, both chat
directions, player/session/death tracking, database health, and uptime. A persistent status message
can mirror this information without creating repeated messages.

## Player and session behavior

The first successful `listplayers` response is a silent baseline; everyone already online is not
announced as a new join. Stable Funcom identifiers take priority, followed by platform identifiers,
then a normalized character name only when no stable identifier exists. Equal display names never
merge separate stable identities.

A failed poll is not an empty server. Leaves require the configured number of successful snapshots
where a player is absent. Confirmed joins open sessions, confirmed ordinary leaves close them, and
each successful presence updates the last-confirmed UTC timestamp. On relay restart, open sessions
close at that timestamp with `relay_restart_recovery`, so downtime is not added to playtime.

## Outages and log rotation

When Conan is down at startup, Discord and SQLite stay available while RCON reconnects with capped
exponential backoff and jitter. After the failure threshold, one server-offline event replaces a
mass of false leave messages. When Conan returns, capability detection and the player baseline run
again without a relay restart.

During a Discord outage, RCON health, player tracking, death persistence, and SQLite continue. Only
a bounded set of events younger than five minutes can flush after reconnection; hours of stale
activity are not replayed.

The log follower reads appended ranges rather than loading the whole file. It buffers partial UTF-8
lines and detects truncation, rename, replacement, deletion, recreation, inode changes, and
rewritten tail bytes. A missing log at startup is allowed; an inaccessible path is reported.

## Updating

From the repository checkout:

```bash
git pull --ff-only
npm ci
npm run check
npm run build
sudo systemctl stop hyborian-relay
sudo ./scripts/install-systemd.sh
sudo -u hyborianrelay -- bash -c 'cd /opt/hyborian-relay && npm run doctor'
sudo systemctl start hyborian-relay
```

The installer replaces application code and production dependencies while preserving `.env` and the
database.

## Database backup and restore

The default systemd database is `/opt/hyborian-relay/data/hyborian-relay.db`. Stop the service so
the database, WAL, and shared-memory state are fully checkpointed before a simple copy:

```bash
sudo systemctl stop hyborian-relay
sudo cp /opt/hyborian-relay/data/hyborian-relay.db \
  /opt/hyborian-relay/data/hyborian-relay.db.backup
sudo systemctl start hyborian-relay
```

Restore only while stopped:

```bash
sudo systemctl stop hyborian-relay
sudo cp /opt/hyborian-relay/data/hyborian-relay.db.backup \
  /opt/hyborian-relay/data/hyborian-relay.db
sudo chown hyborianrelay:hyborianrelay /opt/hyborian-relay/data/hyborian-relay.db
sudo chmod 600 /opt/hyborian-relay/data/hyborian-relay.db
sudo systemctl start hyborian-relay
```

Back up `.env` separately as a secret. Never commit either file.

## Troubleshooting

### Discord bot does not connect

Verify the bot token, Message Content intent, outbound network access, and application identifier.
Run `npm run doctor`; definitive token failure is fatal rather than retried forever.

### Discord messages do not reach Conan

Check the configured guild and channel, RCON host/port/password, rate limits, and
`GAME_CHAT_TRANSPORT`. In automatic mode, inspect doctor output to see whether `help` actually
confirmed Pippi server chat. Select broadcast only if that presentation is intended.

### Conan messages do not reach Discord

Check `CONAN_LOG_PATH`, Linux group permissions, the exact `PippiChat` format, channel
classification, unknown-channel safety, Discord channel permissions, and rendering mode.

### Player list is unavailable

Check RCON and run `listplayers` with a trusted private RCON client. A new Enhanced output layout
may not match the strict table parser. Hyborian Relay degrades tracking and preserves stale state
rather than inventing players.

### Deaths do not appear

Check `TRACK_PLAYER_DEATHS`, log access, the real structured death line, death/event channel
permissions, and `PUBLISH_DEATH_EVENTS`. Debug diagnostics can show that an unsupported line was
ignored without storing its raw content. A repeated event inside the duplicate window is expected to
produce one record and one notification.

### Duplicate messages

Confirm only one Hyborian Relay process owns the data directory. If Pippi already forwards Global
chat directly to Discord, either disable that Pippi output or set
`GAME_TO_DISCORD_CHAT_ENABLED=false` and let Pippi own the direction. Do not run two relays for the
same direction.

### Permission denied reading the Conan log

Add `hyborianrelay` to the actual Conan service group, grant directory execute and log read bits,
restart the service so supplementary groups refresh, then run doctor again. Do not make the server
tree world-writable.

### Database is locked

Stop duplicate relay processes and verify the data directory belongs to `hyborianrelay`. The lock
file normally prevents a second process; stale locks are reclaimed only when their recorded process
is no longer alive.

### Health endpoint is unavailable

Check `HEALTH_SERVER_ENABLED`, bind host, port conflicts, host firewall, and container port mapping.
The default binds to loopback intentionally.

## Security recommendations

- Keep `.env` mode 600 and the data directory mode 700.
- Keep RCON and health traffic private; never publish the RCON port from Docker.
- Grant the Discord bot only the documented permissions.
- Treat the Discord token, webhook URL, RCON password, database, backups, and Conan logs as
  sensitive.
- Run systemd and containers as non-root accounts.
- Review debug logging before enabling it for long periods; info logs intentionally avoid chat
  content.
- Run `npm audit --audit-level=high` before deployment and after dependency updates.

## Testing and development checks

```bash
npm test
npm run test:coverage
npm run format:check
npm run lint
npm run typecheck
npm run dead-code
npm run duplicate-code
npm run public-source-check
npm run build
npm run check
```

Coverage thresholds are 80% statements, lines, and functions, and 75% branches. RCON, chat, game
events, tracking, deaths, storage, Discord, configuration, and integration suites can also run
individually through their package scripts. Tests use local fakes and temporary files; passing them
does not claim verification against a live Conan or Discord server.

Pull requests use repository-owned path selection. Documentation-only changes run formatting and
public-source checks. RCON, chat, game-event, tracking, storage, Discord, configuration, Linux, and
Docker changes select their related suites. Foundational or unfamiliar changes run the full gate.
Every push to `main` runs the complete gate, dependency audit, ShellCheck, systemd verification,
Docker build, and Compose validation.

## Known limitations

- Enhanced/Pippi log layouts not represented by the strict parsers remain unsupported and are not
  guessed.
- Discord attachments are represented by filename only and are never downloaded or uploaded.
- Automatic outbound chat is unavailable unless RCON help clearly confirms Pippi server chat.
- The service tracks communication and activity; it is not a server administration panel.
- Automated tests do not replace final live verification with the community's own bot, RCON, and
  logs.

## Removal

Normal removal preserves `.env` and the database:

```bash
sudo ./scripts/uninstall-systemd.sh
```

Full removal requires the explicit purge option and an interactive `PURGE` confirmation:

```bash
sudo ./scripts/uninstall-systemd.sh --purge
```

The purge deletes `/opt/hyborian-relay`, including configuration and data, and cannot be recovered
unless a backup exists.

## Project status and affiliation

Hyborian Relay 1.0.0 is the first public beta release. It is an independent community project and is
not an official product of, affiliated with, or endorsed by Funcom, Discord, or Enhanced Pippi's
maintainers. Product and service names belong to their respective owners.
