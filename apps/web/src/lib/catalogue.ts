// Trials and courses, typed for the app (see @paddlesnitch/core/catalogue for
// why these list folders instead of everything under trials/).
import { listTrialRecords, listCourseRecords } from '@paddlesnitch/core/catalogue'
import type { TrialMetadata, CourseMetadata } from '@/lib/types'

export { listUserEntryResultKeys, listUserFailedUploadKeys, trialMetaKey, courseMetaKey } from '@paddlesnitch/core/catalogue'

export const listTrials = () => listTrialRecords<TrialMetadata>()
export const listCourses = () => listCourseRecords<CourseMetadata>()
