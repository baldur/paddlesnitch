import type { TrialMetadata } from './types'

// A trial as sent to a browser. The submit token lets anyone who holds it enter
// a members-only or invite-only trial, and the invite list is other people's
// account ids, so both go only to the trial's managers. The endpoints used to
// return the stored metadata whole, to anyone who could view the trial
// (security audit 2026-09).
export function trialForViewer(trial: TrialMetadata, canManage: boolean): TrialMetadata {
  if (canManage) return trial
  const { submitToken: _t, invitedUserIds: _i, ...rest } = trial
  return rest as TrialMetadata
}
