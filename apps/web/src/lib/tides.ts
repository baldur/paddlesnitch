// The fitted tide models (packages/waterways/data/tides.json, written by
// scripts/waterways/fit-tides.ts), typed once for the planner and print sheet.
import tidesJson from '@paddlesnitch/waterways/data/tides.json'
import type { TidesFile } from '@paddlesnitch/waterways/tide'

export const TIDES = tidesJson as unknown as TidesFile
