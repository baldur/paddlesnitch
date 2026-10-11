# Buddies and a truer comparison

Status: 🚧 building (2026-10-11). Owner's request: overlay two paddles on one
map to study the line each took, and do it with friends' paddles too.

## Decisions (owner, 2026-10-11)

1. **Mutual buddies:** one asks, the other accepts; either can remove the
   other at any time. No one-way following.
2. **Buddies see all your paddles by default,** with a per-paddle hide and an
   account-level off switch.
3. **No privacy zone:** most outings start at a club, so the whole track is
   shown.
4. **The word is "buddies"** ("crew" already means the people in your boat).

## What a buddy sees, and never sees

Sees: the map, the numbers, stroke rate, boat motion, boat class and seat.
Never: your diary notes, and never the AI summary (it's written from your
notes and coach profile, so it can repeat private text): they get the plain
summary, rebuilt from the numbers, as share links do (#202). Never your
userId in a URL they can't already see, never your email.

A paddle a viewer may not see is **404**, never 403: its existence isn't
revealed. One rule decides it: `canViewPaddle` (permissions), used by every
route that reads someone else's paddle.

## Phases

| phase | what | merges alone |
|---|---|---|
| 1 | Compare, own paddles: both lines on one map, aligned replay, where the lines differ and who gained where | yes |
| 2 | Buddies model: requests, accept/decline/remove, invite link, rate limit, `canViewPaddle`, export + erasure | yes (no UI) |
| 3 | Buddies pages: list, requests, invite link, ADD AS BUDDY on profiles, menu badge | yes |
| 4 | A buddy's paddles: list + read-only paddle; "buddies can see my paddles" + per-paddle hide | yes |
| 5 | Compare and race a section with buddies' paddles | yes |

## Storage (one object per item)

- `buddies/{userId}/{buddyId}.json` `{ since }`, written on both sides on
  accept, removed on both sides on remove.
- `buddy-requests/{toUserId}/{fromUserId}.json` `{ at }`: a pending request
  (a request back the other way accepts it).
- `users/{userId}/buddy-invite.json` `{ token }`: the invite link
  `/buddies?invite={token}` (rotate or revoke).
- `users/{userId}/buddy-sharing.json` `{ paddles: boolean }` (default true)
  and `hiddenFromBuddies?: true` on a paddle.

Account erasure removes all of it (both sides of every friendship, every
request to or from the user); Download my data includes it.
