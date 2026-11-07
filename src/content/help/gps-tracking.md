---
title: GPS tracking
group: Fleet
summary: Connect the tracking account the fleet already reports to, assign devices, and read positions honestly.
permission: gps.view
---

> **In short** — this reads from a tracking account you already have. It never
> sends anything to a tracker, never touches a vehicle's recorded mileage, and
> never creates a cost. Positions refresh only while somebody has this screen
> open: nothing is collected overnight.

![The tracking page before any provider has been connected](/help/gps-01-no-provider-connected.jpg)

Until a provider is linked, this page says so and offers nothing else. That is
the state most agencies open it in, and it is the honest one — there is no
sample fleet moving around a map.

## Three facts, kept separate

Telematics screens usually collapse everything into one green dot, which is how
a screen comes to say "online" while the integration is broken. Here they are
three badges and three vocabularies:

| What it answers | Reads |
|---|---|
| Is the tracker talking to the provider? | Tracker online · Tracker offline · Link not reported |
| How old is the newest position we hold? | Live · Delayed · Last known · Clock ahead · No position |
| Is {{productName}} reaching the provider? | Synchronising · Credential rejected · Provider unreachable · Rate limited · Not synchronising · Switched off |

**Link not reported** is not offline. A provider that does not report a
connection state for a device has told us nothing, and painting that red sends
somebody out to look for a van parked exactly where it should be.

A value nobody reported is shown as a dash. It is never shown as zero.

### How old "Live" is

**Live** means the position arrived inside the agency's live window, which is
ten minutes unless the agency's own setting says otherwise. Past that it reads
**Delayed**, and past the wider stale window — two hours by default — it reads
**Last known**, which is a statement about the past rather than a location.

**Clock ahead** means the provider timestamped a position in the future. That
is almost always a tracker whose clock is set wrong, and it is shown rather
than hidden so the device does not read as permanently live.

## Connect a tracking provider
<!-- permission: gps.connect -->

**Connect a provider** asks for a name for the connection, which Wialon server
the account lives on, and an access token created in Wialon under your own user
account.

Wialon runs separate installations — the main hosted ones and Wialon Local on
your own server — and a token issued on one is not valid on another. Picking
the wrong server produces "invalid credentials", which reads like a bad token
and is not one, so the server is asked for explicitly.

**Test connection** sends the candidate token once and reports what the
provider said, before anything is saved. Use it: the alternative is finding out
three days later.

Once saved, the token is stored encrypted and is never shown again — not to
you, not to anybody. There is no code path that could retrieve it. A token you
have lost is replaced rather than recovered.

## Assign a device to a vehicle
<!-- permission: gps.assign -->

The **Devices** tab lists the trackers in the provider account and the vehicle
each one is fitted to. **Assign** chooses the vehicle; positions reported by
that device are shown against that vehicle from then on.

A device the provider no longer lists cannot be newly assigned, and neither can
a vehicle that has been retired from the fleet.

**Release** ends the link. The assignment stays in the history, so positions
recorded earlier remain attributable to the vehicle that was actually carrying
the device.

## Read the live map
<!-- permission: gps.view -->

List and map are two views of one selection: clicking a dot highlights a row,
clicking a row pans to the dot. The list is the authoritative one — a vehicle
with no usable position appears there, labelled, and simply cannot appear on a
map.

Filter by position age and by whether the vehicle is on hire. Those filters and
the search go in the address bar; none of them carries anything about a
customer. This screen shows plates, devices and contract references, and never
a name.

## Refresh positions
<!-- permission: gps.sync -->

**Refresh** asks the provider for current positions. If a colleague's open tab
asked moments ago, that answer is reused and you are told so rather than the
agency making a second call for the same thing.

Nothing refreshes while the screen is closed. There is no background job on
this deployment, so a position's age is the age of the last time somebody
looked.

## Look at where a vehicle has been
<!-- permission: gps.view -->

The history panel draws the last 6 hours, 24 hours, 3 days or 7 days for one
vehicle, fetched from the provider on request. Requests are throttled on the
server, because each one is a real call against an account that is rate-limited
and billed by volume.

## Switch a connection off
<!-- permission: gps.connect -->

Switching a connection off stops all synchronising and keeps everything —
devices, assignments and the positions already recorded. The page says plainly
that what is on screen is the last thing recorded before it stopped.

## If it goes wrong

**The credential was rejected.** Either the token is wrong or it was issued on
a different Wialon installation from the one selected. Check the server first —
it is the commoner of the two and it produces the same message. Replace the
token from the connection panel; the old one cannot be read back to compare.

**Everything says Last known and nothing updates.** Look at the connection
badge rather than the vehicles. If synchronising is failing, every position on
the page is as old as the last success, and no amount of refreshing a vehicle
will fix it.

**A device reads Missing.** It was not in the provider account at the last full
synchronisation. It may have been removed there, or moved to another account.

**A vehicle is on the list with no position.** The device has never reported a
usable one. That is different from a stale position and is labelled
differently.

**The vehicle is clearly parked but reads Tracker offline.** That is the
provider's own statement about the link to the device, not about the car.
Ignition-off behaviour differs by tracker.

**A position is dated in the future.** The tracker's clock is wrong. Nothing in
{{productName}} corrects it, because silently moving a timestamp would make
every later question about that device unanswerable.

**Refreshing says it is already up to date.** Another open tab in the agency
asked seconds ago and that answer was reused. Nothing failed.

**The odometer did not update from the tracker.** It never does. Mileage comes
from the readings taken at hand-over and return, and nothing from a tracking
provider overwrites them.

## Where to go next

- [Vehicles](/help/vehicles) — the fleet records these devices are attached to.
- [Reports](/help/reports) — how much of the fleet is covered, as a snapshot.
- [Notifications](/help/notifications) — being told when a connection or a
  device goes quiet.
- [Help centre](/help) — every other page.
