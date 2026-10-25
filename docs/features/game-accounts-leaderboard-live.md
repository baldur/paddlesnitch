# Kayak game: accounts, leaderboard, live races

✅ Accounts and leaderboards shipped 2026-10-24 (#647). Live races moved from direct browser-to-browser connections to a relay, 2026-10-24 (branch `game/relay`).

Owner's decisions, 2026-10-24:

- **Sign in for races.** Anyone can paddle the practice time trial; Division 9, Reading Thames, the Time Trial Loop, the leaderboard and live races need a paddlesnitch account.
- **Join by link.** One player creates a race and shares a link (or its four-letter code); friends open it and join.
- **Every race goes through our own relay** (API Gateway WebSocket + one Lambda, state in S3, no database). Not direct phone-to-phone.

## Why a relay (and what we tried first)

The first version (#647) connected the browsers directly (WebRTC), with our API only introducing them. Its first real test failed: two phones on the same home Wi-Fi were introduced fine but never connected. One phone's network blocked the lookup of its public address (STUN), and the home network didn't let the two phones reach each other directly. A direct connection needs either a cooperative network or a TURN relay as backup; without one, some networks will always fail.

The owner chose to always relay rather than direct-plus-backup: one route, the same for everyone, simpler to build, test and debug, and it works on any network that loads web pages (each phone only makes an outgoing secure connection to us). Messages take one extra hop, which the game hides by drawing the other boats 0.2 s behind.

Options considered for the relay (2026-10-24): Cloudflare's TURN service (free tier, but a third party), Kinesis Video Streams' managed TURN, coturn on EC2 (~$7/month always on), Fargate (dearer and fiddlier than EC2), and API Gateway WebSocket + Lambda (chosen: AWS only, serverless, nothing when idle). S3 rather than DynamoDB for its state, to keep the site on one store.

### Cost and scale

API Gateway charges per message, about $1 per million; a phone sends 10 a second and each is delivered to every other player. About 3 cents for two people racing 10 minutes, about 25 cents for six; nothing when nobody is racing. Idle connections cost almost nothing. It suits tens to a few hundred players at once. Around 1,000 racing at once it costs ~$200/hour and needs an AWS quota raise; at that point a WebSocket program on our own server (costed per machine, not per message) is the move, and the game wouldn't change. The stage throttle (500 messages/s, burst 1,000: about 50 players racing at once) caps a runaway client's bill; the account budget alarm is the backstop.

### What it can't do (stated up front)

- **Up to six players** a race.
- **Trust.** Each browser reports its own position and finish time. The leaderboard checks a time is physically possible for the course, but a determined cheat could still post a fake time. Good enough for a club game; a server-side replay check would be the next step.
- **Connection drops** (a phone's screen locking, a tunnel): the game reconnects with a new ticket; boat states sent meanwhile are lost, race events wait and go when it's back.

## Design

### Accounts

`games/kayak/account.js` asks `GET /api/trpc/me` once (only when served under `/games/`; served on its own there's no API and nothing is gated). Signed out, the race buttons go to `/signin?next=/games/kayak/`; practice still works.

### Leaderboard

- Stored per course at `games/kayak/leaderboard/<course>.json`: each player's best (time as shown, boat, when), sorted, the top 100 kept. The boat is one of the nine in `games/kayak/boats.js` (`GAME_BOATS` in core, a test keeps them the same); times from before there were boats say `stable`, `club` or `racing`.
- Your paddler and boat (`games.kit.get`/`.set`, signed in): kept at `users/{id}/game-kit.json`, so the account's erasure removes it and the export includes it. Only colours and the known choices are accepted.
- `games.submit` (signed in) records a finished race: kept if it's your best on that course and plausible (no faster than about 18 km/h over the course's shown distance).
- `games.leaderboard` (public) returns the top 20 and your own best and rank.
- Names are shown as first name and initial ("Baldur G."), from the account's name.
- Shown in the menu (the best few per course) and on the finish screen (where you'd rank).

### Live races

**Making and joining** (`packages/core/src/games.ts`, tRPC `games.live.*`, S3 under `games/live/<code>/`):

- `meta.json`: course, host, created time. A race code is four letters from an alphabet without look-alikes; a race is gone after 3 hours (S3 expires `games/live/` after a day).
- `players/<userId>.json`: who has joined. One object per player, so joins never overwrite each other (S3 has no atomic append).
- `live.create` and `live.join` return the race, its players, and `relay: { url, ticket }`. `live.ticket` gives a fresh ticket to reconnect. A ticket (`games/live/tickets/<ticket>.json`: race, player, name, expiry) lets one connection in, once, within a minute; the relay reads it from S3, so the relay needs no sign-in code. `url` is the stack's `RELAY_URL`; unset (locally) the game uses `/live` on its own origin.

**The relay** (`infra/lambdas/game-relay/`: `relay.mjs` pure logic, `index.mjs` the Lambda over S3 and API Gateway's post-to-connection call; plain JS, the SDK comes with the runtime):

- `$connect?ticket=…`: checks and deletes the ticket, checks the race exists and has room (12 connections: six players, each perhaps with a just-dropped connection not yet tidied), writes `games/live/<code>/conns/<connectionId>.json` (player, name, when) and `games/live/conns/<connectionId>.json` (its race: a disconnect names only the connection).
- `$default`: `{ hello }` → tell everyone in the race who's connected (`{ players }`; a new connection can't be sent to while it's being accepted, so the newcomer asks once open). `{ ping }` keeps an idle connection open (API Gateway closes one silent for 10 minutes). `{ m, to? }` → `{ from, m }` to every other player in the race, or just to `to`. Messages over 2 KB, more than 30 a second from one connection, or not JSON are dropped.
- `$disconnect`: deletes the connection's objects and tells the others.
- Each warm Lambda keeps a race's connections in memory for 2 s, so most messages never touch S3. Sending to a connection that has gone fails with "gone"; the relay then deletes it.

**The game** (`games/kayak/live.js`): one WebSocket; the lobby shows who's connected and the round trip to each through the relay (an echo every 2 s, every 10 s once racing). Boat states (`net.js`, 10 a second) are dropped while disconnected; race events queue. A player who disappears from the relay's list is treated as having left.

**Racing**:

- The other players are racers in `race.js` like the computer rivals, but their boats are driven by the network, not by `think()`.
- Their positions are shown 0.2 s behind, interpolated between the states either side, so they move smoothly despite uneven arrival.
- Collisions and washes are worked out locally from where everyone is.
- The host's game runs the starter and sends its calls ("Are you ready?", the horn, "Hold it!"); the others follow them.
- Everyone's own clock starts at the horn. Each player sends their finish time when they cross the line.

### Not built

- Computer rivals in live races.
- Time-trial (interval) starts in live races: they use a mass start.
- Spectators, rematch, chat.
- A lobby of open races.

## Testing

- **Unit:** the leaderboard and race tickets (router contract tests against the local store), the relay's rules (`apps/web/src/tests/game-relay.test.ts`: tickets, forwarding, limits, gone connections, a cold Lambda finding the race from S3), and `net.js`'s pure parts.
- **Two browsers** (`games/tests/live.mjs`): two new accounts, one makes a race, the other joins from the link, both connect to the relay, the host starts it, each sees the other's boat move, and plain WebSockets time the relay's round trip on its own. Locally `pnpm games:site` runs the same relay code over files at `ws://localhost:8001/live`. Against production: `GAMES_SITE=https://paddlesnitch.com node games/tests/live.mjs` (makes two real test accounts; posts nothing to the leaderboards).
