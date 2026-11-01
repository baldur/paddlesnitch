'use client'
import { useState, useRef, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import LoadingState from '@/components/LoadingState'
import CourseMapClient from '@/components/map/CourseMapClient'
import { BOAT_CLASSES, BOAT_CLASS_INFO, expectedSeats, validateCrew } from '@/lib/types'
import type { AuthUser, BoatClass, CrewMember, CourseMetadata, LatLng } from '@/lib/types'
import { prepareTraceUpload, uploadErrorMessage, TOO_BIG_MESSAGE } from '@/lib/trace-upload'
import { fmtDay, fmtDayMonth } from '@paddlesnitch/core/format'
import { Page, PageHeader } from '@paddlesnitch/ui/Layout'
import { Button, buttonClass } from '@paddlesnitch/ui/Button'
import { Field, Segmented, inputClass, selectClass } from '@paddlesnitch/ui/Form'
import { Card, cardClass } from '@paddlesnitch/ui/Card'

// What the upload route returns alongside a "did not cross the lines" failure:
// the parsed track + the course geometry, enough to draw a diagnostic map. For
// gate courses it also carries the gate analysis so we can highlight the gate
// that blocked the match.
type GateAnalysis = { blocking: { gateNumber: number } | null }
type UploadDiagnostic = { track: LatLng[]; course: CourseMetadata; gateAnalysis?: GateAnalysis }

// Local helpers used by the tracker picker.
function formatDistance(metres: number): string {
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} km`
  return `${Math.round(metres)} m`
}
const formatDate = fmtDayMonth

// These three editors MUST live at module scope. If you nest them inside
// UploadPage, React sees a new component type on every parent re-render
// and unmounts/remounts the subtree — input focus is lost after every
// keystroke. Pass state down as props instead.

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
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm font-medium text-fg mb-1.5">Crew</legend>
      <p className="text-sm text-muted">{helperText}</p>
      <div className="flex flex-col gap-2 mt-1">
        {crew.map(m => (
          <div key={String(m.seat)} className="flex items-center gap-3">
            <label htmlFor={`crew-${m.seat}`} className="text-sm text-muted w-24 shrink-0">
              {seatLabel(m.seat, total, info.sport)}
            </label>
            <input
              id={`crew-${m.seat}`}
              type="text"
              required
              placeholder={m.seat === 'C' ? 'Cox name' : 'Crew member name'}
              value={m.name}
              onChange={e => updateCrewName(m.seat, e.target.value)}
              className={`${inputClass} flex-1`}
            />
          </div>
        ))}
      </div>
    </fieldset>
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
    <Field label="Boat class" htmlFor="boat-class">
      <select
        id="boat-class"
        required
        value={boatClass}
        onChange={e => setBoatClass(e.target.value as BoatClass | '')}
        className={selectClass}
      >
        <option value="">Choose your boat</option>
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
    </Field>
  )
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return <div role="alert" className="rounded-control border border-red/50 bg-red/10 px-3 py-3 text-red text-sm">{children}</div>
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
  const [inputMode, setInputMode] = useState<'file' | 'url' | 'tracker'>('file')
  // The signed-in user's tracker recordings, newest first: a tracker owner's
  // way into a trial (they had none: no file to upload).
  const [trackerRecordings, setTrackerRecordings] = useState<{ sessionId: string; deviceId: string; startedAt?: string; uploadedAt: string; distanceMetres?: number }[] | undefined>(undefined)
  const [trackerPick, setTrackerPick] = useState<{ deviceId: string; sessionId: string } | null>(null)
  const [activityUrl, setActivityUrl] = useState('')
  const [boatClass, setBoatClass] = useState<BoatClass | ''>('')
  // Crew is keyed by the boat class. When the class changes we re-initialise
  // crew so seat indexes always match the selected boat.
  const [crew, setCrew] = useState<CrewMember[]>([])
  // Which trial this is, so the page can name it (and its course).
  const [about, setAbout] = useState<{ trialName: string; date?: string; courseName?: string } | null>(null)
  // The picked file's name, shown in the drop zone.
  const [fileName, setFileName] = useState('')

  useEffect(() => {
    fetch(`/att/api/trials/${trialId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(async (t: { name?: string; date?: string; courseId?: string } | null) => {
        if (!t?.name) return
        const c = t.courseId
          ? await fetch(`/att/api/courses/${t.courseId}`).then(r => (r.ok ? r.json() : null)).catch(() => null)
          : null
        setAbout({ trialName: t.name, date: t.date, courseName: c?.name })
      })
      .catch(() => {})
  }, [trialId])

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

  // Reset / re-template the crew list whenever the boat class changes.
  // Seat 1 (bow) is pre-filled with the signed-in user's display name so the
  // common case of "I'm the bow rower" is one click. Done while rendering (React's
  // "adjust state when a prop changes" pattern) rather than in an effect.
  const crewKey = `${boatClass}\n${authUser?.displayName ?? ''}`
  const [crewTemplatedFor, setCrewTemplatedFor] = useState(crewKey)
  if (crewTemplatedFor !== crewKey) {
    setCrewTemplatedFor(crewKey)
    const me = authUser?.displayName ?? ''
    setCrew(boatClass ? expectedSeats(boatClass).map(seat => ({
      seat,
      name: seat === 1 ? me : '',
    })) : [])
  }

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
    setError(uploadErrorMessage(res.status, data, fallback))
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

    let upload: File
    try { upload = await prepareTraceUpload(file) }
    catch (err) { setError(err instanceof Error ? err.message : TOO_BIG_MESSAGE); setStatus('error'); return }

    const formData = new FormData()
    formData.append('file', upload)
    formData.append('boatClass', boatClass)
    formData.append('crew', JSON.stringify(crew))

    try {
      const res = await fetch(`/att/api/trials/${trialId}/upload${inviteQuery}`, {
        method: 'POST',
        body: formData,
      })
      await handleUploadResponse(res, 'Couldn’t upload your file. Please try again.')
    } catch {
      setError('Couldn’t upload your file. Please try again.')
      setStatus('error')
    }
  }

  useEffect(() => {
    if (!authUser) return
    fetch('/api/account/devices/sessions')
      .then(r => (r.ok ? r.json() : { sessions: [] }))
      .then((d: { sessions?: NonNullable<typeof trackerRecordings> }) => setTrackerRecordings(
        (d.sessions ?? []).sort((a, b) => (b.startedAt ?? b.uploadedAt).localeCompare(a.startedAt ?? a.uploadedAt))))
      .catch(() => setTrackerRecordings([]))
  }, [authUser])

  const handleTrackerSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!trackerPick) return
    const err = preflight()
    if (err) { setError(err); setStatus('error'); return }
    setStatus('uploading'); setError(''); setDiagnostic(null)
    try {
      const res = await fetch(`/att/api/trials/${trialId}/upload${inviteQuery}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: trackerPick.deviceId, deviceSessionId: trackerPick.sessionId, boatClass, crew }),
      })
      await handleUploadResponse(res, 'Couldn’t enter that recording. Please try again.')
    } catch {
      setError('Couldn’t enter that recording. Please try again.')
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
      await handleUploadResponse(res, 'Couldn’t upload your file. Please try again.')
    } catch {
      setError('Couldn’t upload your file. Please try again.')
      setStatus('error')
    }
  }

  const trialHref = `/att/trials/${trialId}`
  // "Spring Sprint on Elliðaár 1000 m · 12 Apr 2025": which trial you're entering.
  const aboutLine = about ? (
    <>
      <a href={trialHref} className="text-fg font-medium hover:text-primary-text">{about.trialName}</a>
      {about.courseName && <> on {about.courseName}</>}
      {about.date && <> · {fmtDay(about.date)}</>}
    </>
  ) : undefined
  const submitLabel = (busy: string, idle: string) => (status === 'uploading' ? busy : idle)

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={<a href={trialHref} className="tt-nav-link">← Leaderboard</a>}
      />

      <Page width="narrow">
        {authUser === null ? (
          <>
            <PageHeader title="Sign in to enter" description={aboutLine} />
            <Card className="flex flex-col gap-4">
              <p className="text-base text-muted">
                You need an account to submit your entry and appear on the leaderboard.
              </p>
              <a
                href={`/signin?next=${encodeURIComponent(`/att/trials/${trialId}/upload${inviteQuery}`)}`}
                className={buttonClass('primary', 'md', 'self-start')}
              >
                Sign in
              </a>
            </Card>
          </>
        ) : submitGate === undefined ? (
          <LoadingState label="Checking…" className="py-16" />
        ) : submitGate.canSubmit === false ? (
          // Signed in but not allowed to submit: explain why and point at the
          // group to join.
          <>
            <PageHeader
              title={submitGate.reason === 'members' ? 'Members only' : 'Invited only'}
              description={aboutLine}
            />
            <Card className="flex flex-col gap-4">
              {submitGate.reason === 'members' && submitGate.group ? (
                <>
                  <p className="text-base text-muted">
                    Only members of <span className="text-fg font-medium">{submitGate.group.name}</span> can
                    enter this trial. Ask one of its admins to add you, then come back.
                  </p>
                  <a href={`/att/groups/${submitGate.group.id}`} className={buttonClass('primary', 'md', 'self-start')}>
                    View group
                  </a>
                </>
              ) : (
                <p className="text-base text-muted">
                  This trial is for invited paddlers. Ask the organiser for an invite, then come back.
                </p>
              )}
            </Card>
            <a href={trialHref} className={buttonClass('quiet', 'md', 'self-start')}>Back to the leaderboard</a>
          </>
        ) : (
          <>
            <PageHeader
              title="Submit your entry"
              description={aboutLine ?? 'Upload your whole session, warm-up included.'}
            />
            {about && (
              <p className="text-sm text-muted -mt-4">
                Upload your whole session, warm-up included. We find the part between
                the start and finish lines and time it.
              </p>
            )}

            <Segmented
              label="Where your entry comes from"
              value={inputMode}
              onChange={setInputMode}
              options={[
                { value: 'file', label: 'File' },
                { value: 'url', label: 'Link' },
                ...(trackerRecordings && trackerRecordings.length > 0
                  ? [{ value: 'tracker' as const, label: 'Tracker' }]
                  : []),
              ]}
            />

            {inputMode === 'file' && (
              <form onSubmit={handleFileSubmit} className="flex flex-col gap-6">
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-fg" id="gps-file-label">GPS file</span>
                  {/* The real file input covers the whole zone, so a tap opens
                      the picker and a dropped file lands in it. */}
                  <div className={`${cardClass} border-dashed border-border-strong relative flex flex-col items-center justify-center gap-1 px-4 py-8 text-center hover:bg-surface-2 transition-colors`}>
                    <input
                      ref={fileRef}
                      type="file"
                      required
                      aria-labelledby="gps-file-label"
                      accept=".gpx,.fit,.tcx,.csv,.zip"
                      onChange={e => setFileName(e.target.files?.[0]?.name ?? '')}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    {fileName ? (
                      <>
                        <span className="text-base text-fg font-medium break-all">{fileName}</span>
                        <span className="text-sm text-muted">Tap to choose a different file</span>
                      </>
                    ) : (
                      <>
                        <span className="text-base text-fg font-medium">Choose a file or drop it here</span>
                        <span className="text-sm text-muted">.gpx, .fit, .tcx, .csv or a Garmin .zip</span>
                      </>
                    )}
                  </div>
                  <p className="text-sm text-muted">
                    FIT files usually include stroke rate; GPX often doesn&apos;t. Heart rate is never stored.
                  </p>
                </div>

                <BoatClassPicker boatClass={boatClass} setBoatClass={setBoatClass} />
                <CrewEditor boatClass={boatClass} crew={crew} updateCrewName={updateCrewName} />

                {status === 'error' && <ErrorBox>{error}</ErrorBox>}

                <Button type="submit" variant="primary" disabled={status === 'uploading'} className="self-start">
                  {submitLabel('Submitting…', 'Submit entry')}
                </Button>
              </form>
            )}

            {inputMode === 'url' && (
              <form onSubmit={handleUrlSubmit} className="flex flex-col gap-6">
                <Field
                  label="GPX link"
                  htmlFor="activity-url"
                  help="A direct link to a .gpx file. The whole session is fine."
                >
                  <input
                    id="activity-url"
                    type="url"
                    required
                    placeholder="https://example.com/session.gpx"
                    value={activityUrl}
                    onChange={e => setActivityUrl(e.target.value)}
                    className={inputClass}
                  />
                </Field>

                <BoatClassPicker boatClass={boatClass} setBoatClass={setBoatClass} />
                <CrewEditor boatClass={boatClass} crew={crew} updateCrewName={updateCrewName} />

                {status === 'error' && <ErrorBox>{error}</ErrorBox>}

                <Button type="submit" variant="primary" disabled={status === 'uploading'} className="self-start">
                  {submitLabel('Submitting…', 'Submit link')}
                </Button>
              </form>
            )}

            {inputMode === 'tracker' && trackerRecordings && (
              <form onSubmit={handleTrackerSubmit} className="flex flex-col gap-6">
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-fg">Your tracker recordings</span>
                  <ul className={`${cardClass} flex flex-col max-h-72 overflow-y-auto`}>
                    {trackerRecordings.map(r => {
                      const checked = trackerPick?.sessionId === r.sessionId
                      return (
                        <li key={r.sessionId} className={`border-b border-border last:border-b-0 ${checked ? 'bg-surface-2' : 'hover:bg-surface-2'}`}>
                          <label className="flex items-center gap-3 px-3 py-2 min-h-11 cursor-pointer">
                            <input type="radio" name="trackerRecording" checked={checked}
                              onChange={() => setTrackerPick({ deviceId: r.deviceId, sessionId: r.sessionId })} className="accent-primary" />
                            <span className="text-base text-fg tabular">
                              {formatDate(r.startedAt ?? r.uploadedAt)}{r.distanceMetres ? ` · ${formatDistance(r.distanceMetres)}` : ''}
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                  <p className="text-sm text-muted">Pick the recording with your run on the course. The whole session is fine: we find the run in it.</p>
                </div>

                <BoatClassPicker boatClass={boatClass} setBoatClass={setBoatClass} />
                <CrewEditor boatClass={boatClass} crew={crew} updateCrewName={updateCrewName} />

                {status === 'error' && <ErrorBox>{error}</ErrorBox>}

                <Button type="submit" variant="primary" disabled={status === 'uploading' || !trackerPick} className="self-start">
                  {submitLabel('Entering…', 'Enter this recording')}
                </Button>
              </form>
            )}

            {diagnostic && (
              <section className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold text-fg">What we recorded</h2>
                <p className="text-sm text-muted">
                  {diagnostic.gateAnalysis?.blocking
                    ? <>Your track is blue. The gate it missed is red: check your track crosses it, the right way and in order.</>
                    : <>Your track is blue, the start line green and the finish line red. If your track misses a line, your GPS may not have been recording there.</>}
                </p>
                <CourseMapClient
                  course={diagnostic.course}
                  track={diagnostic.track}
                  highlightGateIndex={diagnostic.gateAnalysis?.blocking ? diagnostic.gateAnalysis.blocking.gateNumber - 1 : undefined}
                />
              </section>
            )}
          </>
        )}
      </Page>
    </main>
  )
}
