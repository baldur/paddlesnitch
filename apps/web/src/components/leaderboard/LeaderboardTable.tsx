'use client'
import { fmtDay } from '@paddlesnitch/core/format'
import React, { useState } from 'react'
import Link from 'next/link'
import { formatTime } from '@/lib/geo'
import { paceFor500m, speedKmh, speedMs } from '@/lib/format'
import { BOAT_CLASSES, BOAT_CLASS_INFO } from '@/lib/types'
import type { LeaderboardEntry, BoatClass, CrewMember } from '@/lib/types'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { Badge, EmptyState } from '@paddlesnitch/ui/Card'
import { eyebrowClass } from '@paddlesnitch/ui/Layout'
import { selectClass } from '@paddlesnitch/ui/Form'

// Compass point for a wind direction in degrees (meteorological "from"). #106.
function compass(deg: number): string {
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return points[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
}

// Sort crew so bow comes first, stroke last, cox last of all.
function seatSort(a: CrewMember, b: CrewMember): number {
  if (a.seat === 'C') return 1
  if (b.seat === 'C') return -1
  return (a.seat as number) - (b.seat as number)
}

// Short prefix used on each crew member in the expanded view.
// Sport matters: rowing uses Bow / Stroke, kayak uses Front / Back. hasCox
// is needed because the rowing convention puts cox last but it isn't a
// numbered seat. Reported in #56.
function seatBadge(
  seat: number | 'C',
  total: number,
  hasCox: boolean,
  sport: 'kayak' | 'rowing',
): string {
  if (seat === 'C') return 'C'
  const seatCount = hasCox ? total - 1 : total
  if (sport === 'kayak') {
    if (seat === 1) return 'F'         // Front
    if (seat === seatCount) return 'Bk' // Back (avoid colliding with rowing 'B')
    return String(seat)
  }
  if (seat === 1) return 'B'           // Bow
  if (seat === seatCount) return 'S'   // Stroke
  return String(seat)
}

export default function LeaderboardTable({
  entries,
  uploadHref,
  profileLinks,
  marks,
}: {
  entries: LeaderboardEntry[]
  // If set, the empty state shows an upload CTA. Only pass for open trials.
  uploadHref?: string
  // userId -> canonical profile path segment (handle or id), present ONLY for
  // paddlers whose profile is public. A name links to its profile when present,
  // otherwise renders as plain text (no dead links to private profiles).
  profileLinks?: Record<string, string>
  // entryId -> 'COURSE RECORD' | 'PB' (lib/course-records.ts resultMarks).
  marks?: Record<string, string>
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [classFilter, setClassFilter] = useState<BoatClass | 'all'>('all')

  if (entries.length === 0) {
    return (
      <EmptyState
        title="No entries yet"
        body={uploadHref ? 'Be the first to submit your entry.' : undefined}
        action={uploadHref ? (
          <a href={uploadHref} className={buttonClass('primary')}>Submit your entry</a>
        ) : undefined}
      />
    )
  }

  // Only show class filter options for classes that actually appear in the data,
  // so the dropdown doesn't lie about what's available.
  const presentClasses = Array.from(new Set(entries.map(e => e.boatClass)))
    .sort((a, b) => BOAT_CLASSES.indexOf(a) - BOAT_CLASSES.indexOf(b))

  const filtered = classFilter === 'all'
    ? entries
    : entries.filter(e => e.boatClass === classFilter)

  // A record mark on every class's fastest row stops meaning anything, so
  // only the fastest record holder in view gets it (the data still marks one
  // per class: lib/course-records.ts). Switch the class filter to see another
  // class's record.
  const recordHolder = filtered
    .filter(e => marks?.[e.entryId] === 'COURSE RECORD')
    .reduce<LeaderboardEntry | null>((b, e) => (!b || e.totalElapsedSeconds < b.totalElapsedSeconds ? e : b), null)
  const recordLabel = classFilter === 'all' && presentClasses.length > 1 && recordHolder
    ? `${recordHolder.boatClass} course record`
    : 'Course record'

  return (
    <div className="flex flex-col gap-4">
      {presentClasses.length > 1 && (
        <div className="flex items-center gap-3">
          <label htmlFor="leaderboard-class" className="text-sm text-muted whitespace-nowrap">Boat class</label>
          <select
            id="leaderboard-class"
            value={classFilter}
            onChange={e => setClassFilter(e.target.value as BoatClass | 'all')}
            className={`${selectClass} w-auto`}
          >
            <option value="all">All ({entries.length})</option>
            {presentClasses.map(c => {
              const count = entries.filter(e => e.boatClass === c).length
              return <option key={c} value={c}>{c} ({count})</option>
            })}
          </select>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className={`border-b border-border ${eyebrowClass}`}>
              <th className="text-left py-2 pr-2 sm:pr-4 font-normal w-8">#</th>
              <th className="text-left py-2 pr-2 sm:pr-4 font-normal">Athlete</th>
              <th className="text-left py-2 pr-2 sm:pr-4 font-normal">Class</th>
              <th className="text-right py-2 pr-2 sm:pr-4 font-normal">Time</th>
              <th className="text-right py-2 font-normal hidden sm:table-cell">Date</th>
              <th className="w-5" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry, i) => {
              const hasSplits = entry.splits.length > 0
              // The row expands when there's ANYTHING to show — not just splits.
              // Short (<500 m) entries have no splits but can still carry crew,
              // conditions (#106), or a runCount note.
              const hasDetail =
                hasSplits ||
                (entry.crew?.length ?? 0) > 1 ||
                !!entry.conditions ||
                entry.avgStrokeRate != null ||
                (entry.runCount ?? 0) > 1
              const isOpen = expanded === entry.entryId
              return (
                <React.Fragment key={entry.entryId}>
                  <tr
                    onClick={() => hasDetail && setExpanded(isOpen ? null : entry.entryId)}
                    className={`border-b border-border transition-colors ${hasDetail ? 'cursor-pointer hover:bg-surface' : ''}`}
                  >
                    <td className="py-3 pr-2 sm:pr-4 text-muted tabular">{i + 1}</td>
                    <td className="py-3 pr-2 sm:pr-4 text-fg font-medium">
                      {profileLinks?.[entry.userId] ? (
                        <Link
                          href={`/profile/${profileLinks[entry.userId]}`}
                          onClick={(e: React.MouseEvent) => e.stopPropagation()}
                          className="hover:text-primary-text hover:underline transition-colors"
                        >
                          {entry.displayName}
                        </Link>
                      ) : (
                        entry.displayName
                      )}
                      {recordHolder?.entryId === entry.entryId ? (
                        <span className="ml-2 align-middle"><Badge tone="split">{recordLabel}</Badge></span>
                      ) : marks?.[entry.entryId] === 'PB' ? (
                        <span className="ml-2 align-middle"><Badge>PB</Badge></span>
                      ) : null}
                    </td>
                    <td className="py-3 pr-2 sm:pr-4 text-muted tabular text-sm">{entry.boatClass}</td>
                    <td className="py-3 pr-2 sm:pr-4 text-right tabular font-bold text-primary-text text-base">
                      {formatTime(entry.totalElapsedSeconds)}
                    </td>
                    <td className="py-3 pr-2 sm:pr-4 text-right text-muted text-sm hidden sm:table-cell">
                      {fmtDay(entry.raceDate ?? entry.submittedAt)}
                    </td>
                    <td className="py-3 text-muted text-sm text-right">
                      {hasDetail ? (isOpen ? '▲' : '▼') : ''}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr key={`${entry.entryId}-splits`} className="border-b border-border bg-surface">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="mb-3 text-sm">
                          <Link href={`/att/entries/${entry.entryId}`} className="tt-link">View entry</Link>
                        </div>
                        {entry.runCount && entry.runCount > 1 && (
                          <div className="mb-3 text-sm text-muted">
                            Best of {entry.runCount} runs in this upload — the fastest is shown.
                          </div>
                        )}
                        {entry.avgStrokeRate != null && (
                          <div className="mb-3 text-sm">
                            <span className={`${eyebrowClass} mr-2`}>Avg stroke rate</span>
                            <span className="tabular text-split">{entry.avgStrokeRate} spm</span>
                          </div>
                        )}
                        {entry.crew && entry.crew.length > 1 && (
                          <div className="mb-4">
                            <div className={`${eyebrowClass} mb-1.5`}>Crew</div>
                            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                              {[...entry.crew].sort(seatSort).map(m => (
                                <span key={String(m.seat)}>
                                  <span className="text-muted mr-1 tabular">{seatBadge(m.seat, entry.crew.length, !!entry.crew.find(c => c.seat === 'C'), BOAT_CLASS_INFO[entry.boatClass].sport)}</span>
                                  <span className="text-fg">{m.name}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {entry.conditions && (
                          <div className="mb-4">
                            <div className={`${eyebrowClass} mb-1.5`}>Conditions at finish</div>
                            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-fg tabular">
                              {entry.conditions.weather?.temperatureC != null && (
                                <span><span className="text-muted mr-1">temp</span>{entry.conditions.weather.temperatureC.toFixed(1)}°C</span>
                              )}
                              {entry.conditions.weather?.windSpeedKmh != null && (
                                <span>
                                  <span className="text-muted mr-1">wind</span>
                                  {entry.conditions.weather.windSpeedKmh.toFixed(0)} km/h
                                  {entry.conditions.weather.windDirectionDeg != null && ` ${compass(entry.conditions.weather.windDirectionDeg)}`}
                                </span>
                              )}
                              {entry.conditions.weather?.precipitationMm != null && (
                                <span><span className="text-muted mr-1">rain</span>{entry.conditions.weather.precipitationMm.toFixed(1)} mm</span>
                              )}
                              {entry.conditions.flow?.valueM3s != null && (
                                <span>
                                  <span className="text-muted mr-1">flow</span>
                                  {entry.conditions.flow.valueM3s.toFixed(1)} m³/s
                                  {entry.conditions.flow.stationLabel && (
                                    <span className="text-muted"> · {entry.conditions.flow.stationLabel}</span>
                                  )}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                        {entry.splits.length > 0 && (
                        // w-0 min-w-full: the splits scroll in their own box
                        // instead of widening the leaderboard past a phone.
                        <div className="w-0 min-w-full overflow-x-auto">
                        <table className="text-sm border-collapse">
                          <thead>
                            <tr className={eyebrowClass}>
                              <th className="text-left pr-6 py-1 font-normal">Mark</th>
                              <th className="text-right pr-6 py-1 font-normal">Elapsed</th>
                              <th className="text-right pr-6 py-1 font-normal">Split</th>
                              <th className="text-right pr-6 py-1 font-normal whitespace-nowrap">Pace /500</th>
                              <th className="text-right pr-6 py-1 font-normal">km/h</th>
                              <th className="text-right py-1 font-normal">m/s</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entry.splits.map((split, idx) => {
                              const prev = idx === 0 ? 0 : entry.splits[idx - 1].elapsedSeconds
                              // Pace and speed for this split are based on the time it took to cover
                              // THIS 500m segment, not the cumulative.
                              const segSecs = split.elapsedSeconds - prev
                              const segDist = idx === 0 ? split.distance : split.distance - entry.splits[idx - 1].distance
                              return (
                                <tr key={split.distance} className="border-b border-border">
                                  <td className="pr-6 py-1.5 text-muted tabular whitespace-nowrap">{split.distance} m</td>
                                  <td className="pr-6 py-1.5 text-right tabular text-fg">
                                    {formatTime(split.elapsedSeconds)}
                                  </td>
                                  <td className="pr-6 py-1.5 text-right tabular text-split">
                                    {formatTime(segSecs)}
                                  </td>
                                  <td className="pr-6 py-1.5 text-right tabular text-primary-text">
                                    {paceFor500m(segDist, segSecs)}
                                  </td>
                                  <td className="pr-6 py-1.5 text-right tabular text-primary-text">
                                    {speedKmh(segDist, segSecs)}
                                  </td>
                                  <td className="py-1.5 text-right tabular text-primary-text">
                                    {speedMs(segDist, segSecs)}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                        </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
