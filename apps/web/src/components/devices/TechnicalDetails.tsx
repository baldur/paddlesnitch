import type { DeviceDataReport } from '@paddlesnitch/timing/device'
import type { CadenceReport } from '@paddlesnitch/timing/cadence'
import type { AttitudeReport } from '@paddlesnitch/timing/attitude'

// The engineering detail of one tracker recording (rows, GPS fix, capture,
// satellites, motion sensors, columns, first rows), collapsed under TECHNICAL
// DETAILS: the paddler-facing pages lead with plain figures.
export default function TechnicalDetails({ report, cadence, attitude }: {
  report: DeviceDataReport; cadence: CadenceReport | null; attitude: AttitudeReport | null
}) {
  const sampleRateHz = report.timeSpanS && report.timeSpanS > 0 ? report.rows / report.timeSpanS : null
  return (
    <details className="border border-border bg-surface px-3 py-2">
      <summary className="cursor-pointer text-[10px] text-muted tracking-widest uppercase">Technical details</summary>
      <div className="flex flex-col gap-3 mt-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Rows" value={String(report.rows)} />
          <Stat label="With GPS fix" value={`${report.fixedRows} / ${report.rows}`} />
          <Stat label="Rows captured" value={`${(report.capture.capturedFraction * 100).toFixed(1)}%`} />
          <Stat label="Dropped rows" value={report.capture.gaps === 0 ? 'none' : `${report.capture.missingRows} in ${report.capture.gaps} gap${report.capture.gaps === 1 ? '' : 's'}`} />
          <Stat label="Sample rate" value={sampleRateHz == null ? '—' : `${sampleRateHz.toFixed(1)} Hz`} />
          <Stat label="Satellites" value={report.gnss.satsFirst == null ? '—' : `${report.gnss.satsFirst} → ${report.gnss.satsLast}`} />
          <Stat label="HDOP" value={report.gnss.hdopFirst == null ? '—' : `${report.gnss.hdopFirst} → ${report.gnss.hdopLast}`} />
          <Stat label="Motion sensors" value={`${report.hasImu ? 'accel' : '—'}${report.hasGyro ? ' + gyro' : ''}`} />
        </div>
        {report.gnss.altitudeSpreadM != null && report.gnss.altitudeSpreadM > 10 && (
          <p className="text-muted">Altitude wandered {report.gnss.altitudeSpreadM} m. GPS altitude is noise at this scale, so nothing uses it.</p>
        )}
        <p className="text-muted leading-relaxed">Stroke rate: {report.strokeRate.reason}{cadence && !cadence.available ? ` Motion data: ${cadence.reason}` : ''}</p>
        {report.strokeRate.evidence && <p className="text-muted leading-relaxed">{report.strokeRate.evidence}</p>}
        {attitude?.available && (
          <p className="text-muted">Roll range {attitude.rollP5Deg}° … {attitude.rollP95Deg}°{attitude.symmetry ? `; one side to ${attitude.symmetry.sideADeg}°, the other to ${attitude.symmetry.sideBDeg}°` : ''}.</p>
        )}
        {report.motion && report.motion.gyroPeakMax != null && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Rotation, median" value={`${report.motion.gyroPeakMedian ?? '—'} dps`} />
            <Stat label="Paddling ceiling (p99)" value={report.motion.gyroPeakP99Moving == null ? '—' : `${report.motion.gyroPeakP99Moving} dps`} />
            <Stat label="Handling peak" value={report.motion.gyroPeakMaxStationary == null ? '—' : `${report.motion.gyroPeakMaxStationary} dps`} />
            <Stat label="Peak acceleration" value={report.motion.accelPeakMax == null ? '—' : `${report.motion.accelPeakMax} g`} />
          </div>
        )}
        {report.deadColumns.length > 0 && (
          <p className="text-muted leading-relaxed">
            Empty in this recording: {report.deadColumns.map(c => `${c.name} (${c.kind === 'zero' ? 'always 0' : 'always empty'})`).join(', ')}.
            This is often normal, for example battery reads 0 with no battery fitted.
          </p>
        )}
        <div>
          <div className="text-[10px] text-muted tracking-widest uppercase mb-1">Columns ({report.columns.length})</div>
          <div className="flex flex-wrap gap-1">
            {report.columns.map(c => {
              const dead = report.deadColumns.find(d => d.name === c)
              return (
                <span
                  key={c}
                  title={dead ? `Present in every row but ${dead.kind === 'zero' ? 'always 0' : 'always empty'}` : undefined}
                  className={`border px-2 py-0.5 tabular text-[11px] ${dead ? 'border-red/40 bg-surface text-red' : 'border-border bg-surface'}`}
                >{c}</span>
              )
            })}
          </div>
        </div>
        {report.sampleRows.length > 0 && (
          <div className="overflow-x-auto">
            <div className="text-[10px] text-muted tracking-widest uppercase mb-1">First rows</div>
            <table className="text-[11px] tabular border border-border">
              <thead><tr>{report.columns.map(c => <th key={c} className="border-b border-border px-2 py-1 text-left text-muted font-normal whitespace-nowrap">{c}</th>)}</tr></thead>
              <tbody>
                {report.sampleRows.map((row, i) => (
                  <tr key={i}>{report.columns.map(c => <td key={c} className="px-2 py-1 whitespace-nowrap text-fg">{row[c] || <span className="text-muted">·</span>}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  )
}

export function Stat({ label, value }: { label: string; value: string }) {
  return <div className="border border-border bg-surface px-2 py-1"><div className="text-[9px] text-muted tracking-widest uppercase">{label}</div><div className="text-fg tabular">{value}</div></div>
}

