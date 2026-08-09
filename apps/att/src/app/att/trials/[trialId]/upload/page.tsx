'use client'
import { useState, useRef, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import LoadingState from '@/components/LoadingState'
import CourseMapClient from '@/components/map/CourseMapClient'
import StravaButton from '@/components/strava/StravaButton'
import PoweredByStrava from '@/components/strava/PoweredByStrava'
import ViewOnStrava from '@/components/strava/ViewOnStrava'
import { BOAT_CLASSES, BOAT_CLASS_INFO, expectedSeats, validateCrew } from '@/lib/types'
import type { AuthUser, BoatClass, CrewMember, StravaActivitySummary, CourseMetadata, LatLng } from '@/lib/types'

// What the upload route returns alongside a "did not cross the lines" failure:
// the parsed track + the course geometry, enough to draw a diagnostic map. For
// gate courses it also carries the gate analysis so we can highlight the gate
// that blocked the match.
type GateAnalysis = { blocking: { gateNumber: number } | null }
type UploadDiagnostic = { track: LatLng[]; course: CourseMetadata; gateAnalysis?: GateAnalysis }

// Local helpers used only by the Strava picker.
function formatDistance(metres: number): string {
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} km`
  return `${Math.round(metres)} m`
}
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  } catch {
    return iso.slice(0, 10)
  }
}

// These three editors MUST live at module scope. If you nest them inside
// UploadPage, React sees a new component type on every parent re-render
// and unmounts/remounts the subtree — input focus is lost after every
// keystroke. Pass state down as props instead.

const inputClass = 'bg-bg border border-border px-3 py-2 text-fg text-sm focus:outline-none focus:border-primary transition-colors w-full'

// Kayaks use "Front" / "Back"; rowing uses "Bow" / "Stroke". Middle seats
// in either sport are just the seat number. Cox (rowing only) shows as
// "Cox". Reported in #56 — the form used to call K2 seats "Bow"/"Stroke",
// which is rowing terminology that doesn't apply to kayaks.
function seatLabel(seat: number | 'C', total: number, sport: 'kayak' | 'rowing'): string {
  if (seat === 'C') return 'Cox'
  if (sport === 'kayak') {
    if (seat === 1) return 'Front (1)'
    if (seat === total) return `Back (${seat})`
    return `Seat ${seat}`
  }
  if (seat === 1) return 'Bow (1)'
  if (seat === total) return `Stroke (${seat})`
  return `Seat ${seat}`
}

function CrewEditor({
  boatClass,
  crew,
  updateCrewName,
}: {
  boatClass: BoatClass | ''
  crew: CrewMember[]
  updateCrewName: (seat: number | 'C', name: string) => void
}) {
  if (!boatClass) return null
  const info = BOAT_CLASS_INFO[boatClass]
  const total = info.crewSize
  if (total === 1 && !info.hasCox) return null
  const helperText = info.sport === 'kayak'
    ? `One row per paddler. Seat 1 is the front, ${total} is the back.`
    : `One row per seat. Seat 1 is bow, ${total} is stroke${info.hasCox ? ', C is cox' : ''}.`
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs text-muted tracking-widest">CREW</label>
      <p className="text-xs text-muted -mt-1">
        {helperText}
      </p>
      <div className="flex flex-col gap-1.5">
        {crew.map(m => (
          <div key={String(m.seat)} className="flex items-center gap-2">
            <span className="text-xs text-muted tracking-widest w-20 shrink-0 tabular">
              {seatLabel(m.seat, total, info.sport)}
            </span>
            <input
              type="text"
              required
              placeholder={m.seat === 'C' ? 'Cox name' : 'Crew member name'}
              value={m.name}
              onChange={e => updateCrewName(m.seat, e.target.value)}
              className={inputClass + ' flex-1'}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function BoatClassPicker({
  boatClass,
  setBoatClass,
}: {
  boatClass: BoatClass | ''
  setBoatClass: (v: BoatClass | '') => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs text-muted tracking-widest">BOAT CLASS</label>
      <select
        required
        value={boatClass}
        onChange={e => setBoatClass(e.target.value as BoatClass | '')}
        className={inputClass}
      >
        <option value="">— Select —</option>
        <optgroup label="Kayak">
          {BOAT_CLASSES.filter(c => BOAT_CLASS_INFO[c].sport === 'kayak').map(c => (
            <option key={c} value={c}>
              {c} · {BOAT_CLASS_INFO[c].crewSize} paddler{BOAT_CLASS_INFO[c].crewSize > 1 ? 's' : ''}
            </option>
          ))}
        </optgroup>
        <optgroup label="Rowing">
          {BOAT_CLASSES.filter(c => BOAT_CLASS_INFO[c].sport === 'rowing').map(c => {
            const info = BOAT_CLASS_INFO[c]
            const seats = info.crewSize === 1
              ? '1 sculler'
              : `${info.crewSize} rower${info.crewSize > 1 ? 's' : ''}${info.hasCox ? ' + cox' : ''}`
            return <option key={c} value={c}>{c} · {seats}</option>
          })}
        </optgroup>
      </select>
    </div>
  )
}

export default function UploadPage({
  params,
}: {
  params: Promise<{ trialId: string }>
}) {
  const { trialId } = use(params)
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [authUser, setAuthUser] = useState<AuthUser | null | undefined>(undefined)
  // Shareable submit-link token from the URL (?invite=). Read once via lazy
  // init (null during SSR) so a link-holder can submit + round-trip through
  // signup even on a gated trial — without a setState-in-effect.
  const [inviteToken] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('invite'))
  // Phase 3: whether this viewer may submit (participation gate). undefined =
  // still checking. When canSubmit is false we render a join / invite CTA
  // instead of the form, so a `members` trial doesn't show a form that 404s.
  const [submitGate, setSubmitGate] = useState<
    { canSubmit: boolean; reason?: string; group?: { id: string; name: string } } | undefined
  >(undefined)
  const [status, setStatus] = useState<'idle' | 'uploading' | 'error'>('idle')
  const [error, setError] = useState('')
  // Set when processing fails because the track didn't cross the lines — drives
  // the diagnostic map so the user can see their track against the course.
  const [diagnostic, setDiagnostic] = useState<UploadDiagnostic | null>(null)
  const [inputMode, setInputMode] = useState<'file' | 'url' | 'strava'>('file')
  const [activityUrl, setActivityUrl] = useState('')
  // Strava picker state. `connected` is undefined until status/me come back so
  // we can keep the loading skeleton off-screen until we know which UI to show.
  const [stravaConnected, setStravaConnected] = useState<boolean | undefined>(undefined)
  const [stravaActivities, setStravaActivities] = useState<StravaActivitySummary[] | undefined>(undefined)
  const [stravaActivityId, setStravaActivityId] = useState<number | null>(null)
  const [stravaError, setStravaError] = useState('')
  const [boatClass, setBoatClass] = useState<BoatClass | ''>('')
  // Crew is keyed by the boat class. When the class changes we re-initialise
  // crew so seat indexes always match the selected boat.
  const [crew, setCrew] = useState<CrewMember[]>([])
  // Race date defaults to today (local timezone). Stored as YYYY-MM-DD.

  useEffect(() => {
    fetch('/att/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then(setAuthUser)
      .catch(() => setAuthUser(null))
  }, [])

  // `?invite=<token>` query suffix, reused on the can-submit + submit requests.
  const inviteQuery = inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : ''

  // Once we know the viewer is signed in, ask the server whether they may
  // submit (and if not, why) so we can show the right CTA. A valid invite token
  // makes the server answer canSubmit even on a members/invitational trial.
  useEffect(() => {
    if (!authUser) return
    fetch(`/att/api/trials/${trialId}/can-submit${inviteQuery}`)
      .then(r => (r.ok ? r.json() : { canSubmit: false }))
      .then(setSubmitGate)
      .catch(() => setSubmitGate({ canSubmit: false }))
  }, [authUser, trialId, inviteQuery])

  // Strava picker: lazy-load status + activities the first time the tab opens.
  // We don't fetch on mount — most uploads are still file/URL and there's no
  // point spending the API quota on users who never click the tab.
  useEffect(() => {
    if (inputMode !== 'strava') return
    if (stravaConnected === undefined) {
      fetch('/att/api/strava/status')
        .then(r => (r.ok ? r.json() : { connected: false }))
        .then(s => setStravaConnected(!!s.connected))
        .catch(() => setStravaConnected(false))
    }
  }, [inputMode, stravaConnected])

  useEffect(() => {
    if (inputMode !== 'strava' || !stravaConnected || stravaActivities !== undefined) return
    fetch('/att/api/strava/activities')
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.error ?? 'Could not load activities')
        }
        return r.json()
      })
      .then((d: { activities: StravaActivitySummary[] }) => setStravaActivities(d.activities))
      .catch((err: Error) => setStravaError(err.message))
  }, [inputMode, stravaConnected, stravaActivities])

  // Reset / re-template the crew list whenever the boat class changes.
  // Seat 1 (bow) is pre-filled with the signed-in user's display name so the
  // common case of "I'm the bow rower" is one click.
  useEffect(() => {
    if (!boatClass) { setCrew([]); return }
    const seats = expectedSeats(boatClass)
    const me = authUser?.displayName ?? ''
    setCrew(seats.map(seat => ({
      seat,
      name: seat === 1 ? me : '',
    })))
  }, [boatClass, authUser?.displayName])

  function updateCrewName(seat: number | 'C', name: string) {
    setCrew(prev => prev.map(m => m.seat === seat ? { ...m, name } : m))
  }

  function preflight(): string | null {
    if (!boatClass) return 'Select a boat class before submitting.'
    const crewError = validateCrew(boatClass, crew)
    if (crewError) return crewError
    return null
  }

  // Shared handling for an upload/import response. On success we navigate to the
  // leaderboard. On the "did not cross the lines" failure the route returns a
  // diagnostic (parsed track + course geometry) which we stash to draw a map.
  async function handleUploadResponse(res: Response, fallback: string) {
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      router.push(`/att/trials/${trialId}`)
      return
    }
    setError(typeof data.error === 'string' ? data.error : fallback)
    const diag = data.diagnostic
    setDiagnostic(
      diag && Array.isArray(diag.track) && diag.course
        ? { track: diag.track, course: diag.course, gateAnalysis: diag.gateAnalysis }
        : null,
    )
    setStatus('error')
  }

  const handleFileSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) return
    const err = preflight()
    if (err) { setError(err); setStatus('error'); return }

    setStatus('uploading')
    setError('')
    setDiagnostic(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('boatClass', boatClass)
    formData.append('crew', JSON.stringify(crew))

    try {
      const res = await fetch(`/att/api/trials/${trialId}/upload${inviteQuery}`, {
        method: 'POST',
        body: formData,
      })
      await handleUploadResponse(res, 'Upload failed')
    } catch {
      setError('Upload failed')
      setStatus('error')
    }
  }

  const handleStravaSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!stravaActivityId) return
    const err = preflight()
    if (err) { setError(err); setStatus('error'); return }

    setStatus('uploading')
    setError('')
    setDiagnostic(null)

    try {
      const res = await fetch(`/att/api/trials/${trialId}/upload${inviteQuery}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stravaActivityId, boatClass, crew }),
      })
      await handleUploadResponse(res, 'Import failed')
    } catch {
      setError('Import failed')
      setStatus('error')
    }
  }

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activityUrl.trim()) return
    const err = preflight()
    if (err) { setError(err); setStatus('error'); return }

    setStatus('uploading')
    setError('')
    setDiagnostic(null)

    try {
      const res = await fetch(`/att/api/trials/${trialId}/upload${inviteQuery}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: activityUrl.trim(), boatClass, crew }),
      })
      await handleUploadResponse(res, 'Upload failed')
    } catch {
      setError('Upload failed')
      setStatus('error')
    }
  }

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={
          <>
            <a
              href={`/att/trials/${trialId}`}
              className="tt-nav-link text-sm"
            >
              ← LEADERBOARD
            </a>
            <span className="text-muted">/</span>
            <span className="text-fg text-sm">UPLOAD TRACE</span>
          </>
        }
      />

      <div className="flex-1 px-4 py-8 max-w-xl mx-auto w-full">
        {authUser === null ? (
          <div className="flex flex-col gap-4 text-center">
            <h1 className="text-lg font-bold text-fg tracking-widest">
              SIGN IN TO SUBMIT
            </h1>
            <p className="text-sm text-muted">
              You need an account to submit a trace and appear on the leaderboard.
            </p>
            <a
              href={`/att/auth?next=${encodeURIComponent(`/att/trials/${trialId}/upload${inviteQuery}`)}`}
              className="px-6 py-2.5 bg-primary text-white font-bold text-sm tracking-widest hover:bg-primary transition-colors"
            >
              SIGN IN / SIGN UP
            </a>
          </div>
        ) : submitGate === undefined ? (
          <LoadingState label="Checking…" className="py-16" />
        ) : submitGate.canSubmit === false ? (
          // Signed in but not allowed to submit — explain why and point at the
          // group to join (self-serve join lands in phase 4).
          <div className="flex flex-col gap-4 text-center">
            <h1 className="text-lg font-bold text-fg tracking-widest">
              {submitGate.reason === 'members' ? 'MEMBERS ONLY' : 'INVITATION ONLY'}
            </h1>
            {submitGate.reason === 'members' && submitGate.group ? (
              <>
                <p className="text-sm text-muted">
                  Only members of <span className="text-fg font-bold">{submitGate.group.name}</span> can
                  submit to this trial. Ask an admin of the group to add you, then come back and upload.
                </p>
                <a
                  href={`/att/groups/${submitGate.group.id}`}
                  className="px-6 py-2.5 bg-primary text-white font-bold text-sm tracking-widest hover:bg-primary transition-colors"
                >
                  VIEW GROUP →
                </a>
              </>
            ) : (
              <p className="text-sm text-muted">
                This trial is invitation-only. Ask the organiser for an invite, then come back and upload.
              </p>
            )}
            <a href={`/att/trials/${trialId}`} className="tt-link text-xs tracking-widest">
              ← BACK TO LEADERBOARD
            </a>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <h1 className="text-lg font-bold text-fg tracking-widest">
              SUBMIT YOUR ENTRY
            </h1>
            <p className="text-sm text-muted -mt-4">
              Upload your full session — warmup and cooldown included. The system
              automatically finds the segment between the start and finish lines
              and extracts your time.
            </p>

            {/* Mode toggle */}
            <div className="flex border-b border-border">
              <button
                type="button"
                onClick={() => setInputMode('file')}
                className={`px-4 py-2 text-sm tracking-widest transition-colors ${
                  inputMode === 'file'
                    ? 'border-b-2 border-primary text-primary -mb-px'
                    : 'text-muted hover:text-fg'
                }`}
              >
                UPLOAD FILE
              </button>
              <button
                type="button"
                onClick={() => setInputMode('url')}
                className={`px-4 py-2 text-sm tracking-widest transition-colors ${
                  inputMode === 'url'
                    ? 'border-b-2 border-primary text-primary -mb-px'
                    : 'text-muted hover:text-fg'
                }`}
              >
                PASTE URL
              </button>
              <button
                type="button"
                onClick={() => setInputMode('strava')}
                className={`px-4 py-2 text-sm tracking-widest transition-colors ${
                  inputMode === 'strava'
                    ? 'border-b-2 border-[#fc4c02] text-[#fc4c02] -mb-px'
                    : 'text-muted hover:text-fg'
                }`}
              >
                FROM STRAVA
              </button>
            </div>

            {inputMode === 'file' && (
              <form onSubmit={handleFileSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-xs text-muted tracking-widest">
                    GPS FILE (.gpx, .fit, .tcx, .csv, or .zip)
                  </label>
                  <input
                    ref={fileRef}
                    type="file"
                    required
                    accept=".gpx,.fit,.tcx,.csv,.zip"
                    className="bg-bg border border-border px-3 py-2 text-fg text-sm file:bg-surface-2 file:text-fg file:border-0 file:px-3 file:py-1 file:mr-3 file:text-xs file:cursor-pointer hover:border-primary transition-colors cursor-pointer w-full"
                  />
                  <p className="text-xs text-muted">
                    Export your full activity from Garmin Connect, Strava, a SpeedCoach, or any GPS device. GPX, FIT, TCX, and CSV are all supported — including a Garmin Connect .zip export (we unpack the activity inside). For paddlers, the FIT export usually carries stroke rate; GPX often doesn&apos;t. Heart rate is discarded; stroke rate is kept.
                  </p>
                </div>

                <BoatClassPicker boatClass={boatClass} setBoatClass={setBoatClass} />
                <CrewEditor boatClass={boatClass} crew={crew} updateCrewName={updateCrewName} />

                {status === 'error' && (
                  <div className="border border-red bg-red/10 px-3 py-3 text-red text-xs">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={status === 'uploading'}
                  className="px-6 py-2.5 bg-primary text-white font-bold text-sm tracking-widest hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {status === 'uploading' ? 'PROCESSING…' : 'SUBMIT TRACE'}
                </button>
              </form>
            )}

            {inputMode === 'url' && (
              <form onSubmit={handleUrlSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-xs text-muted tracking-widest">
                    ACTIVITY URL
                  </label>
                  <input
                    type="url"
                    required
                    placeholder="https://www.strava.com/activities/..."
                    value={activityUrl}
                    onChange={e => setActivityUrl(e.target.value)}
                    className={inputClass}
                  />
                  <p className="text-xs text-muted">
                    Paste a public Strava activity URL or a direct .gpx link. Your full session is fine — no need to trim it. Heart rate is discarded; stroke rate is kept.
                  </p>
                </div>

                <BoatClassPicker boatClass={boatClass} setBoatClass={setBoatClass} />
                <CrewEditor boatClass={boatClass} crew={crew} updateCrewName={updateCrewName} />

                {status === 'error' && (
                  <div className="border border-red bg-red/10 px-3 py-3 text-red text-xs">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={status === 'uploading'}
                  className="px-6 py-2.5 bg-primary text-white font-bold text-sm tracking-widest hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {status === 'uploading' ? 'FETCHING…' : 'SUBMIT URL'}
                </button>
              </form>
            )}

            {inputMode === 'strava' && (
              <form onSubmit={handleStravaSubmit} className="flex flex-col gap-4">
                {stravaConnected === undefined && (
                  <p className="text-xs text-muted">Checking Strava connection…</p>
                )}

                {stravaConnected === false && (
                  <div className="flex flex-col gap-3 border border-border p-4">
                    <p className="text-sm text-fg">
                      Connect Strava once and you can import any recent water-sport activity straight into a time trial.
                    </p>
                    <StravaButton href="/att/api/strava/connect" className="self-start" />
                    <p className="text-xs text-muted">
                      You&apos;ll be redirected to Strava to approve. Manage the connection any time from your{' '}
                      <a href="/att/account" className="tt-link">account page</a>.
                    </p>
                  </div>
                )}

                {stravaConnected && (
                  <div className="flex flex-col gap-2">
                    <label className="text-xs text-muted tracking-widest">
                      RECENT STRAVA ACTIVITIES
                    </label>
                    {stravaError && (
                      <div className="border border-red bg-red/10 px-3 py-2 text-red text-xs">
                        {stravaError}
                      </div>
                    )}
                    {stravaActivities === undefined && !stravaError && (
                      <p className="text-xs text-muted">Loading…</p>
                    )}
                    {stravaActivities !== undefined && stravaActivities.length === 0 && (
                      <p className="text-xs text-muted">
                        No recent kayak, canoe, rowing, or SUP activities found on your Strava.
                      </p>
                    )}
                    {stravaActivities !== undefined && stravaActivities.length > 0 && (
                      <ul className="flex flex-col border border-border max-h-72 overflow-y-auto">
                        {stravaActivities.map(a => {
                          const checked = stravaActivityId === a.id
                          return (
                            <li
                              key={a.id}
                              className={`border-b border-surface-2 last:border-b-0 ${checked ? 'bg-surface-2' : 'hover:bg-surface'}`}
                            >
                              <label className="flex items-center gap-3 px-3 py-2 cursor-pointer">
                                <input
                                  type="radio"
                                  name="stravaActivity"
                                  checked={checked}
                                  onChange={() => setStravaActivityId(a.id)}
                                  className="accent-[#fc4c02]"
                                />
                                <span className="flex-1 min-w-0">
                                  <span className="block text-sm text-fg truncate">{a.name}</span>
                                  <span className="block text-xs text-muted tabular">
                                    {a.sportType} · {formatDate(a.startDate)} · {formatDistance(a.distanceMetres)}
                                  </span>
                                </span>
                              </label>
                              {/* Attribution link back to the source activity (outside
                                  the selecting label so it doesn't toggle the radio). */}
                              <div className="px-3 pb-2 -mt-1">
                                <ViewOnStrava activityId={a.id} className="tt-link text-xs" />
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                    {stravaActivities !== undefined && stravaActivities.length > 0 && (
                      <PoweredByStrava className="mt-2 self-start" />
                    )}
                  </div>
                )}

                <BoatClassPicker boatClass={boatClass} setBoatClass={setBoatClass} />
                <CrewEditor boatClass={boatClass} crew={crew} updateCrewName={updateCrewName} />

                {status === 'error' && (
                  <div className="border border-red bg-red/10 px-3 py-3 text-red text-xs">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={status === 'uploading' || !stravaConnected || !stravaActivityId}
                  className="px-6 py-2.5 bg-primary text-white font-bold text-sm tracking-widest hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {status === 'uploading' ? 'IMPORTING…' : 'IMPORT FROM STRAVA'}
                </button>
              </form>
            )}

            {diagnostic && (
              <div className="flex flex-col gap-2">
                <label className="text-xs text-muted tracking-widest">
                  WHAT WE RECORDED
                </label>
                <p className="text-xs text-muted">
                  {diagnostic.gateAnalysis?.blocking
                    ? <>Your track is blue. The gate that blocked the match is highlighted in red — check it crosses that gate in the right direction and order.</>
                    : <>Your track is blue; the start line is green and the finish line red. If your track doesn&apos;t pass cleanly through both lines, your GPS may not have been recording there, or the course lines may need adjusting.</>}
                </p>
                <CourseMapClient
                  course={diagnostic.course}
                  track={diagnostic.track}
                  highlightGateIndex={diagnostic.gateAnalysis?.blocking ? diagnostic.gateAnalysis.blocking.gateNumber - 1 : undefined}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
