# Kayak game: accounts, leaderboard, live races

🚧 Prototype 2026-10-24 (branch `game/live`, not merged). Owner's decisions, 2026-10-24:

- **Sign in for races.** Anyone can paddle the practice time trial; Division 9, Reading Thames, the Time Trial Loop, the leaderboard and live races need a paddlesnitch account.
- **Live races without new infrastructure.** Browsers race each other directly over WebRTC. They find each other through a few calls to our own API (the existing Lambda), which keeps the handshake in S3 for a minute. No new AWS service, nothing that costs more than fractions of a cent per race, no third party.
- **Join by link.** One player creates a race and shares a link (or its four-letter code); friends open it and join.

## Why this shape

The game is static files on S3 behind CloudFront, served from the same origin as the app. So the game page can call `/api/trpc` with the visitor's sign-in cookie, exactly as the site does, and needs nothing new to know who's playing.

A live race needs two things: a way for browsers to find each other (*signalling*), and a way to send positions many times a second.

- **Positions** go browser to browser over a WebRTC data channel: no server in the path, no cost, and the lowest latency there is. Each boat sends its state ~15 times a second on an unreliable, unordered channel (like UDP: a late position is useless, so it isn't resent), and race events (the starter's calls, finishing) on a reliable one.
- **Signalling** is a handful of small messages per pair of players: an offer and an answer, each carrying the connection candidates. That's a few requests per player per race, so a store-and-poll mailbox in S3 behind the existing tRPC API does it. A WebSocket service (API Gateway, IoT Core) would be the "proper" tool for constant traffic, but we don't have constant traffic: once the peers are connected, the server is out of the loop.

### What it can't do (stated up front)

- **No TURN relay.** Connections use Google's free STUN server to find each player's public address. That works for most home and office networks, but some networks (several mobile carriers, strict corporate NATs) need a TURN relay, which costs money to run. On those, the connection fails, and the lobby says so. If it matters later: a small TURN server (coturn on the cheapest instance, ~$4/month) or a TURN service.
- **Up to six players**, all connected to each other (a mesh). Fine for a club race; a bigger field would want one player relaying for the rest.
- **Trust.** Each browser reports its own position and finish time. The leaderboard checks a time is physically possible for the course, but a determined cheat could still post a fake time. Good enough for a club game; a server-side replay check would be the next step.

## Design

### Accounts

`games/kayak/account.js` asks `GET /api/trpc/me` once. Signed out, the race buttons say "Sign in to race" and go to `/signin?next=/games/kayak/`; practice still works. Locally, `next dev` proxies `/games/*` to the static server (`pnpm games`, :8000), so the game and the API share an origin, as in production.

### Leaderboard

- Stored per course at `games/kayak/leaderboard/<course>.json`: each player's best (time as shown, hull, when), sorted, the top 100 kept.
- `games.submit` (signed in) records a finished race: kept if it's your best on that course and plausible (no faster than about 18 km/h over the course's shown distance).
- `games.leaderboard` (public) returns the top 20 and your own best and rank.
- Names are shown as first name and initial ("Baldur G."), from the account's name.
- Shown in the menu (the best few per course) and on the finish screen (where you'd rank).

### Live races

**The mailbox** (`packages/core/src/game-live.ts`, S3 under `games/live/<code>/`):

- `meta.json`: course, host, created time. A race code is four letters from an alphabet without look-alikes; a race is gone after 3 hours (and S3 expires the prefix after a day).
- `players/<userId>.json`: who has joined (name, when). One object per player, so joins never overwrite each other (S3 has no atomic append).
- `inbox/<userId>/<time>-<random>.json`: a signalling message for that player. The recipient lists its inbox, reads and deletes what's there. Same one-object-per-message reason.

**The API** (`packages/api/src/routers/games.ts`): `live.create`, `live.join`, `live.room` (who's in), `live.send` (a message to another player in the room), `live.inbox` (take your messages). All signed in, and only for players in the room.

**Connecting** (`games/kayak/net.js`): when you join, you send an offer to each player already there; they answer. Each offer and answer carries all its connection candidates (no trickle ICE), so a pair connects with two messages. While in the lobby, each browser polls its inbox once a second. After the race starts, polling stops.

**Racing**:

- The other players are racers in `race.js` like the computer rivals, but their boats are driven by the network, not by `think()`.
- Their positions are shown about 100 ms behind, interpolated between the last two states received, so they move smoothly despite jitter.
- Collisions and washes are worked out locally from where everyone is.
- The host's game runs the starter. It sees everyone's boats, so it can tell a jumped start, and it sends its calls ("Are you ready?", the horn, "Hold it!"); the others follow them.
- Everyone's own clock starts at the horn. Each player sends their finish time when they cross the line. A player who drops out stays where they were, marked as gone.

### Not in the prototype

- Computer rivals in live races.
- Time-trial (interval) starts in live races: they use a mass start.
- Spectators, rematch, chat.
- A lobby of open races.

## Testing

- **Unit:** the leaderboard and the mailbox (router contract tests against the local store), and `net.js`'s pure parts (message encoding, interpolation).
- **Two browsers:** Playwright opens two signed-in pages, creates a race in one, joins from the other, starts it, and checks each sees the other's boat move. WebRTC between two pages on one machine needs no STUN.
