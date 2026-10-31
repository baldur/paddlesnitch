// The CloudWatch dashboards and their URL outputs (docs/features/observability.md).
// Kept out of att-stack.ts so dashboard work doesn't collide with the rest of
// the stack. Constructs are created on the stack itself with their original
// ids, so the move out of att-stack.ts changed nothing in the template.
//
// Three dashboards, the free allowance (each one after that is $3/month):
//   paddlesnitch-health    — open this first: alarms, errors, key actions, use, web
//   paddlesnitch-api       — the server in depth: procedures, actions, speed, email
//   paddlesnitch-firmware  — the trackers
// Platform (web / android / ios / tracker) is a column in the Logs Insights
// tables, not a dashboard of its own.
import * as cdk from 'aws-cdk-lib'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as lambda from 'aws-cdk-lib/aws-lambda'

export function addDashboards(stack: cdk.Stack, { serverFn, distribution, alarms }: {
  serverFn: lambda.IFunction
  distribution: cloudfront.IDistribution
  alarms: cloudwatch.IAlarm[]
}) {
  // ---------------------------------------------------------------------------
  // Shared metrics and the server log group
  // ---------------------------------------------------------------------------
  // Product events are EMF lines from emitMetric() (src/lib/metrics.ts); the
  // API-call and action lines come from @paddlesnitch/core/observe. They all
  // populate once something happens; referencing them earlier is fine.
  const EVENT_NAMESPACE = 'Paddlesnitch/App'
  const eventNames = ['pageview', 'signup', 'login', 'upload', 'trial_create', 'course_create']
  const eventMetric = (event: string, period: cdk.Duration) =>
    new cloudwatch.Metric({
      namespace: EVENT_NAMESPACE,
      metricName: 'Count',
      dimensionsMap: { Event: event },
      statistic: 'Sum',
      period,
      label: event,
    })
  const sum = (namespace: string, metricName: string, period: cdk.Duration, label: string, dimensionsMap?: Record<string, string>) =>
    new cloudwatch.Metric({ namespace, metricName, dimensionsMap, statistic: 'Sum', period, label })
  const actionNames = ['sign_in', 'upload', 'analyse', 'device_sync', 'strava_import']

  // Logs Insights over the server Lambda's log group (where every EMF line is
  // written). Referenced by NAME so we don't create/adopt a LogGroup resource
  // (which could clash with the one Lambda auto-creates on first run).
  const serverLogGroup = `/aws/lambda/${serverFn.functionName}`
  const table = (title: string, queryLines: string[], width: number, height = 6) =>
    new cloudwatch.LogQueryWidget({ title, logGroupNames: [serverLogGroup], view: cloudwatch.LogQueryVisualizationType.TABLE, queryLines, width, height })
  const consoleUrl = (name: string) =>
    `https://${stack.region}.console.aws.amazon.com/cloudwatch/home?region=${stack.region}#dashboards/dashboard/${name}`

  // ---------------------------------------------------------------------------
  // paddlesnitch-health: is anything broken right now, and are people using it?
  // ---------------------------------------------------------------------------
  const dashboard = new cloudwatch.Dashboard(stack, 'AppDashboard', {
    dashboardName: 'paddlesnitch-health',
    defaultInterval: cdk.Duration.days(7),
  })

  dashboard.addWidgets(
    new cloudwatch.AlarmStatusWidget({ title: 'Alarms', alarms, width: 16, height: 6 }),
    new cloudwatch.TextWidget({
      width: 8, height: 6,
      markdown: [
        '### Deep dives',
        `- [API, actions, speed, email](${consoleUrl('paddlesnitch-api')})`,
        `- [Trackers and firmware](${consoleUrl('paddlesnitch-firmware')})`,
        '',
        '### App store crash consoles',
        '- [Google Play: Android vitals](https://play.google.com/console)',
        '- [App Store Connect: crashes](https://appstoreconnect.apple.com)',
        '',
        'Spec: docs/features/observability.md',
      ].join('\n'),
    }),
  )

  // Zero tolerance: every number here should read 0.
  dashboard.addWidgets(
    new cloudwatch.SingleValueWidget({
      title: 'Errors in the selected range (all should be 0)',
      metrics: [
        sum('Paddlesnitch/Api', 'ServerErrors', cdk.Duration.days(1), 'API server errors'),
        sum('Paddlesnitch/Actions', 'Failures', cdk.Duration.days(1), 'failed actions'),
        sum('Paddlesnitch/Alerts', 'ServerErrorLines', cdk.Duration.days(1), 'errors logged'),
        serverFn.metricErrors({ statistic: 'Sum', period: cdk.Duration.days(1), label: 'server crashes' }),
        eventMetric('crash_report', cdk.Duration.days(1)).with({ label: 'app crashes' }),
        eventMetric('client_error', cdk.Duration.days(1)).with({ label: 'browser errors' }),
      ],
      width: 24, height: 4,
      setPeriodToTimeRange: true,
    }),
  )

  dashboard.addWidgets(
    new cloudwatch.GraphWidget({
      title: 'API calls (left) and server errors (right) / hour',
      left: [sum('Paddlesnitch/Api', 'Calls', cdk.Duration.hours(1), 'calls')],
      right: [sum('Paddlesnitch/Api', 'ServerErrors', cdk.Duration.hours(1), 'server errors')],
      width: 12, height: 6,
    }),
    table('API by platform', [
      'filter kind = "api_call"',
      'stats count(*) as calls, sum(ServerErrors) as serverErrors, pct(ms, 95) as p95ms by platform',
      'sort calls desc',
    ], 12),
  )

  dashboard.addWidgets(
    new cloudwatch.GraphWidget({
      title: 'Key actions / day (left), failures (right)',
      left: actionNames.map(a => sum('Paddlesnitch/Actions', 'Attempts', cdk.Duration.days(1), a, { Action: a })),
      right: [sum('Paddlesnitch/Actions', 'Failures', cdk.Duration.days(1), 'failures')],
      width: 12, height: 6,
    }),
    table('Key actions by outcome and platform', [
      'filter kind = "action"',
      'stats count(*) as n by Action, outcome, platform',
      'sort Action asc, n desc',
    ], 12),
  )

  dashboard.addWidgets(
    table('Sessions by platform (distinct)', [
      'filter Event = "pageview" or Event = "app_open"',
      'stats count_distinct(sid) as sessions, count(*) as events by platform',
      'sort sessions desc',
    ], 8),
    new cloudwatch.GraphWidget({
      title: 'Product events / day',
      left: eventNames.map(e => eventMetric(e, cdk.Duration.days(1))),
      width: 16, height: 6,
    }),
  )

  // The apps: crashes by signature, and which versions people are on.
  dashboard.addWidgets(
    table('App crashes by signature', [
      'filter Event = "crash_report"',
      'stats count(*) as crashes, latest(@timestamp) as last by platform, crashedVersion, signature',
      'sort crashes desc',
      'limit 20',
    ], 12),
    table('App versions in use (app opens)', [
      'filter Event = "app_open"',
      'stats count(*) as opens by platform, appVersion',
      'sort opens desc',
      'limit 20',
    ], 12),
  )

  dashboard.addWidgets(
    new cloudwatch.SingleValueWidget({
      title: 'Trackers in the selected range',
      metrics: [
        sum('Paddlesnitch/Firmware', 'DeviceSeen', cdk.Duration.days(1), 'heartbeats'),
        sum('Paddlesnitch/Firmware', 'DeviceCrash', cdk.Duration.days(1), 'crashes'),
      ],
      width: 8, height: 6,
      setPeriodToTimeRange: true,
    }),
    table('Browser errors from our own scripts', [
      'filter Event = "client_error"',
      'stats count(*) as n, latest(@timestamp) as last by message, path',
      'sort n desc',
      'limit 20',
    ], 16),
  )

  // ---- the web site (what used to be paddlesnitch-app) --------------------
  dashboard.addWidgets(
    new cloudwatch.SingleValueWidget({
      title: 'Events — selected time range (totals)',
      metrics: eventNames.map(e => eventMetric(e, cdk.Duration.days(1))),
      width: 24,
      height: 4,
      setPeriodToTimeRange: true,
    }),
  )

  // Pageviews arrive in batches (client capture flushes ~15s / on tab-hide),
  // so an hourly series makes recent/sparse traffic visible where the daily
  // one hides it.
  dashboard.addWidgets(
    new cloudwatch.GraphWidget({
      title: 'Pageviews & key events / hour',
      left: ['pageview', 'signup', 'login', 'upload'].map(e => eventMetric(e, cdk.Duration.hours(1))),
      width: 24,
      height: 6,
    }),
  )

  dashboard.addWidgets(
    table('Pageviews by path (what people look at)', [
      'filter Event = "pageview"',
      'stats count(*) as views by path',
      'sort views desc',
      'limit 30',
    ], 12, 8),
    table('Events by type + distinct sessions', [
      'filter ispresent(Event)',
      'stats count(*) as events, count_distinct(sid) as sessions by Event',
      'sort events desc',
    ], 12, 8),
  )

  // Marketing campaigns (?campaign=<id> landings): visits → button clicks →
  // sign-ups, one row per campaign + step. `pageview` rows are visits that
  // arrived on a campaign link, `campaign_cta` the main button, and
  // `campaign_signup` saved applications (server-side; `repeat` = "true"
  // is someone updating theirs). Visitors = distinct browser tabs; the
  // server-side sign-up has none.
  dashboard.addWidgets(
    table('Campaigns: visits → button clicks → sign-ups', [
      'filter ispresent(campaign)',
      'stats count(*) as events, count_distinct(sid) as visitors by campaign, Event, repeat',
      'sort campaign asc, events desc',
    ], 24),
  )

  // The games (games/shared/analytics.js): what's played, for how long, how it
  // ends, and which paddlers people make. Never who: sid is a random tab id.
  // Props arrive as strings; secs, knocked and the rest are whole numbers or
  // decimals as text.
  dashboard.addWidgets(
    table('Game plays by mode and course (median secs)', [
      'filter Event = "game_play"',
      'stats count(*) as plays, count_distinct(sid) as tabs, pct(secs, 50) as median_secs by mode, course, `end`',
      'sort plays desc',
      'limit 30',
    ], 12, 8),
    table('Game outings by rowers knocked in', [
      'filter Event = "game_play" and mode = "outing"',
      'stats count(*) as outings by knocked',
      'sort outings desc',
    ], 4, 8),
    table('Game paddlers by body, hair and hat', [
      'filter Event = "game_kit"',
      'stats count(*) as kits, count_distinct(sid) as tabs by body, hair, hat',
      'sort kits desc',
      'limit 30',
    ], 8, 8),
  )
  dashboard.addWidgets(
    table('Game time per tab, how it\'s played (where it ran)', [
      'filter Event = "game_session"',
      'stats sum(secs) as tab_secs, sum(plays) as tab_plays by sid, input, gpu, `from`',
      'stats count(*) as tabs, pct(tab_secs, 50) as median_secs, avg(tab_plays) as avg_plays by input, gpu, `from`',
      'sort tabs desc',
    ], 24),
  )

  // ---------------------------------------------------------------------------
  // Firmware rollout dashboard (docs/features/device-ota-and-auth.md 2.2)
  // ---------------------------------------------------------------------------
  // Separate namespace and separate dashboard from the product one, because
  // these answer a different question: not "what are people doing" but "did
  // the fleet take the update, and did it boot".
  //
  // Dimensions are Version and Model only. NEVER deviceId - unbounded
  // cardinality, and it would turn a metrics bill into a per-device tracking
  // system. Per-device detail lives in the firmware-events records (expiring
  // after 90 days) behind the admin route.
  const firmwareMetric = (name: string, period: cdk.Duration) =>
    new cloudwatch.Metric({
      namespace: 'Paddlesnitch/Firmware',
      metricName: name,
      statistic: 'Sum',
      period,
      label: name,
    })

  const firmwareDashboard = new cloudwatch.Dashboard(stack, 'FirmwareDashboard', {
    dashboardName: 'paddlesnitch-firmware',
    defaultInterval: cdk.Duration.days(30),
  })

  firmwareDashboard.addWidgets(
    // The GAP between these two lines is the rollout's real completion state:
    // an offer issued is a device that was handed an image, a boot confirmed
    // is one that actually came back up on it.
    new cloudwatch.GraphWidget({
      title: 'Offers issued vs boots confirmed / day',
      left: [
        firmwareMetric('FirmwareOfferIssued', cdk.Duration.days(1)),
        firmwareMetric('FirmwareBootConfirmed', cdk.Duration.days(1)),
      ],
      width: 24,
      height: 8,
    }),
  )

  firmwareDashboard.addWidgets(
    // Any non-zero value here is the signal to promote the previous version
    // back. It is charted on its own so it cannot hide under a busy line.
    new cloudwatch.GraphWidget({
      title: 'Boot failures + rollbacks / day  (non-zero = unpromote)',
      left: [firmwareMetric('FirmwareBootFailed', cdk.Duration.days(1))],
      width: 12,
      height: 6,
    }),
    // Trackers report a crash on the start after it (POST /api/devices/health),
    // by version. A crash that starts with a release is the release.
    new cloudwatch.GraphWidget({
      title: 'Tracker crashes / day, by version',
      // A search, because the metric carries Version + Model dimensions: one
      // line per version that crashed.
      left: [new cloudwatch.MathExpression({
        expression: `SEARCH('{Paddlesnitch/Firmware,Version,Model} MetricName="DeviceCrash"', 'Sum', 86400)`,
        usingMetrics: {},
        label: 'crashes',
        period: cdk.Duration.days(1),
      })],
      width: 12,
      height: 6,
    }),
    new cloudwatch.SingleValueWidget({
      title: 'Selected range - totals',
      metrics: [
        firmwareMetric('FirmwareOfferIssued', cdk.Duration.days(1)),
        firmwareMetric('FirmwareBootConfirmed', cdk.Duration.days(1)),
        firmwareMetric('FirmwareBootFailed', cdk.Duration.days(1)),
        firmwareMetric('FirmwareCheckNotModified', cdk.Duration.days(1)),
        firmwareMetric('DeviceCrash', cdk.Duration.days(1)),
      ],
      width: 12,
      height: 6,
      setPeriodToTimeRange: true,
    }),
  )

  // "How many devices are on each version" is a distinct-count, which a metric
  // cannot answer (deviceId is deliberately not a dimension) - so it comes
  // from the EMF log lines instead, where the per-device detail does live.
  // ---- the fleet: how many devices, on what, seen when --------------------
  //
  // All three come from the DeviceSeen heartbeat (one line per device per
  // minute at most), and all three are LOGS INSIGHTS queries rather than
  // metrics. That is the whole point: `deviceId` rides in the log line as a
  // property, so count_distinct can answer "how many devices" without ever
  // minting a metric per device. Put deviceId in a metric dimension and the
  // bill grows with the fleet and the telemetry becomes per-device tracking.
  //
  // Deliberately NOT built on the firmware-check metrics: a device that is up
  // to date AND has uploads never calls /api/devices/firmware at all (the OTA
  // design is signal-not-poll), so a fleet count built on those would miss
  // precisely the healthiest devices.
  firmwareDashboard.addWidgets(
    new cloudwatch.SingleValueWidget({
      title: 'Devices seen — selected range',
      metrics: [firmwareMetric('DeviceSeen', cdk.Duration.days(1))],
      width: 6,
      height: 6,
      setPeriodToTimeRange: true,
    }),
    new cloudwatch.LogQueryWidget({
      title: 'How many devices, on which version (distinct, last 7 days)',
      logGroupNames: [serverLogGroup],
      view: cloudwatch.LogQueryVisualizationType.TABLE,
      queryLines: [
        'filter ispresent(DeviceSeen)',
        'stats count_distinct(deviceId) as devices by Version, Model',
        'sort devices desc',
        'limit 30',
      ],
      width: 9,
      height: 6,
    }),
    new cloudwatch.LogQueryWidget({
      // The per-device roll call. `latest(@timestamp)` is the answer to "when
      // was this one last active", and sorting by it puts the silent ones at
      // the bottom where they are noticeable.
      title: 'Every device: version + when it was last active',
      logGroupNames: [serverLogGroup],
      view: cloudwatch.LogQueryVisualizationType.TABLE,
      queryLines: [
        'filter ispresent(DeviceSeen)',
        'stats latest(Version) as version, latest(Model) as model,'
          + ' latest(@timestamp) as lastActive, count(*) as beats by deviceId',
        'sort lastActive desc',
        'limit 100',
      ],
      width: 9,
      height: 6,
    }),
  )

  firmwareDashboard.addWidgets(
    new cloudwatch.LogQueryWidget({
      title: 'Firmware checks by version + model (last 7 days)',
      logGroupNames: [serverLogGroup],
      view: cloudwatch.LogQueryVisualizationType.TABLE,
      queryLines: [
        'filter ispresent(FirmwareCheckNotModified) or ispresent(FirmwareOfferIssued)',
        'stats count(*) as checks by Version, Model',
        'sort checks desc',
        'limit 30',
      ],
      width: 12,
      height: 8,
    }),
    new cloudwatch.LogQueryWidget({
      title: 'Admin reads of device firmware history (audit)',
      logGroupNames: [serverLogGroup],
      view: cloudwatch.LogQueryVisualizationType.TABLE,
      queryLines: [
        'filter audit = "admin.firmware_events.read"',
        'fields at, actorEmail, deviceId',
        'sort at desc',
        'limit 50',
      ],
      width: 12,
      height: 8,
    }),
  )

  // ---------------------------------------------------------------------------
  // paddlesnitch-api: the server in depth. What failed, for whom, how fast, plus
  // the scheduled check's page timings (the same pages every run, so a line is
  // a trend), CloudFront's error rate, and email. (It replaced
  // paddlesnitch-performance; the construct id stays PerfDashboard.)
  // ---------------------------------------------------------------------------
  const perfDashboard = new cloudwatch.Dashboard(stack, 'PerfDashboard', {
    dashboardName: 'paddlesnitch-api',
    defaultInterval: cdk.Duration.days(14),
  })
  // Kept in step with PAGES in apps/web/scripts/perf.ts (perf-setup.test.ts).
  const perfPages = ['Home', 'Trials', 'Courses', 'Help', 'Guide', 'Sign in', 'Privacy', 'A trial', 'A course']
  // Signed in as the performance check's test account (scripts/perf-account.ts).
  const perfSignedIn = ['Paddles', 'Paddles (data)', 'Devices (data)', 'A paddle', 'A paddle (data)', 'Boat motion (data)']
  const ttfb = (page: string) => new cloudwatch.Metric({
    namespace: 'Paddlesnitch/Perf', metricName: 'TTFB', dimensionsMap: { Page: page },
    statistic: 'Average', period: cdk.Duration.hours(1), label: page,
  })
  const serverDuration = (stat: string) => serverFn.metricDuration({ statistic: stat, period: cdk.Duration.minutes(15), label: `server ${stat}` })
  perfDashboard.addWidgets(
    new cloudwatch.GraphWidget({
      title: 'Page time to first byte, from the performance check (ms)',
      left: perfPages.map(ttfb),
      width: 24, height: 8,
      leftYAxis: { min: 0 },
    }),
  )
  perfDashboard.addWidgets(
    new cloudwatch.GraphWidget({
      title: 'Signed-in pages and their data, from the performance check (ms)',
      left: perfSignedIn.map(ttfb),
      width: 24, height: 8,
      leftYAxis: { min: 0 },
    }),
  )
  perfDashboard.addWidgets(
    new cloudwatch.SingleValueWidget({
      title: 'Latest check, per page (ms)',
      metrics: [...perfPages, ...perfSignedIn].map(ttfb),
      width: 24, height: 4,
    }),
  )
  perfDashboard.addWidgets(
    new cloudwatch.GraphWidget({
      title: 'Server time per request, real visitors (ms)',
      left: ['p50', 'p95', 'p99'].map(serverDuration),
      width: 12, height: 6,
      leftYAxis: { min: 0 },
    }),
    new cloudwatch.LogQueryWidget({
      title: 'Cold starts per hour and how long they took (ms)',
      logGroupNames: [`/aws/lambda/${serverFn.functionName}`],
      view: cloudwatch.LogQueryVisualizationType.LINE,
      queryLines: [
        'filter @type = "REPORT"',
        'stats count(@initDuration) as coldStarts, avg(@initDuration) as initMs by bin(1h)',
      ],
      width: 12, height: 6,
    }),
  )
  // CloudFront publishes its metrics in us-east-1, whatever the stack's region.
  const cf = (metricName: string, statistic: string) => new cloudwatch.Metric({
    namespace: 'AWS/CloudFront', metricName, region: 'us-east-1',
    dimensionsMap: { DistributionId: distribution.distributionId, Region: 'Global' },
    statistic, period: cdk.Duration.hours(1), label: metricName,
  })
  perfDashboard.addWidgets(
    new cloudwatch.GraphWidget({
      title: 'CloudFront error rates (%)',
      left: [cf('4xxErrorRate', 'Average'), cf('5xxErrorRate', 'Average')],
      width: 12, height: 6,
    }),
    new cloudwatch.GraphWidget({
      title: 'CloudFront requests per hour',
      left: [cf('Requests', 'Sum')],
      width: 12, height: 6,
    }),
  )
  perfDashboard.addWidgets(
    table('Failed API calls by procedure and code (server errors and caller mistakes)', [
      'filter kind = "api_call" and ispresent(code)',
      'stats count(*) as n, sum(ServerErrors) as serverErrors, latest(@timestamp) as last by path, code, platform',
      'sort serverErrors desc, n desc',
      'limit 30',
    ], 12, 8),
    table('Slowest procedures', [
      'filter kind = "api_call"',
      'stats count(*) as calls, pct(ms, 50) as p50ms, pct(ms, 95) as p95ms, max(ms) as maxMs by path',
      'sort p95ms desc',
      'limit 20',
    ], 12, 8),
  )
  perfDashboard.addWidgets(
    table('Key actions that did not work: reason, platform, version', [
      'filter kind = "action" and outcome != "ok"',
      'stats count(*) as n, latest(@timestamp) as last by Action, outcome, reason, platform, appVersion',
      'sort n desc',
      'limit 30',
    ], 12, 8),
    // The same grouping the zero-tolerance clean-up used: every line the
    // server logged at ERROR, by its first 140 characters.
    table('Errors logged, grouped', [
      'filter @message like /\\tERROR\\t|Task timed out/',
      'parse @message /\\tERROR\\t(?<msg>.{0,140})/',
      'stats count(*) as n, latest(@timestamp) as last by coalesce(msg, substr(@message, 0, 140)) as message',
      'sort n desc',
      'limit 20',
    ], 12, 8),
  )
  perfDashboard.addWidgets(
    new cloudwatch.GraphWidget({
      title: 'Server Lambda — invocations & errors / hour',
      left: [serverFn.metricInvocations({ statistic: 'Sum', period: cdk.Duration.hours(1) })],
      right: [serverFn.metricErrors({ statistic: 'Sum', period: cdk.Duration.hours(1) })],
      width: 12,
      height: 6,
    }),
    // Account-level SES numbers (no dimensions), and our own sign-ins.
    new cloudwatch.GraphWidget({
      title: 'Email / day: sent, delivered, bounced, complained, rejected',
      left: ['Send', 'Delivery', 'Bounce', 'Complaint', 'Reject'].map(m => sum('AWS/SES', m, cdk.Duration.days(1), m)),
      width: 12,
      height: 6,
    }),
  )

  new cdk.CfnOutput(stack, 'PerfDashboardUrl', {
    value: consoleUrl('paddlesnitch-api'),
    description: 'CloudWatch dashboard for the server in depth: API, actions, speed, email',
  })

  new cdk.CfnOutput(stack, 'DashboardUrl', {
    value: consoleUrl('paddlesnitch-health'),
    description: 'CloudWatch dashboard to open first: alarms, errors, key actions, use, web',
  })
  new cdk.CfnOutput(stack, 'FirmwareDashboardUrl', {
    value: consoleUrl('paddlesnitch-firmware'),
    description: 'CloudWatch dashboard for firmware rollout (offers, boots, failures)',
  })
}
