// Sources router — the "analyse one of my existing things" pickers: ATT trial
// entries (#159) and hardware-tracker uploads. All owner-scoped. File upload
// stays a REST endpoint (multipart), not here.
import { router, protectedProcedure } from '../trpc'
import { listUserTrialEntries } from '@paddlesnitch/analysis/trials'
import { listUserDeviceSessions } from '@paddlesnitch/analysis/device-sessions'

export const sourcesRouter = router({
  trials: protectedProcedure.query(({ ctx }) => listUserTrialEntries(ctx.user.id)),

  devices: protectedProcedure.query(({ ctx }) => listUserDeviceSessions(ctx.user.id)),
})
