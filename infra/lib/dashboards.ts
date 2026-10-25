// The CloudWatch dashboards and their URL outputs (docs/features/observability.md).
// Kept out of att-stack.ts so dashboard work doesn't collide with the rest of
// the stack. Constructs are created on the stack itself with their original
// ids, so moving them here changed nothing in the deployed template.
import * as cdk from 'aws-cdk-lib'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as lambda from 'aws-cdk-lib/aws-lambda'

export function addDashboards(stack: cdk.Stack, { serverFn, distribution }: {
  serverFn: lambda.IFunction
  distribution: cloudfront.IDistribution
}) {
  // ---------------------------------------------------------------------------
  // CloudWatch dashboard — product events (EMF) + server health
  // ---------------------------------------------------------------------------
  // The product-event metrics are created automatically from the EMF log lines
  // emitMetric() writes (src/lib/metrics.ts). They populate once events fire;
  // referencing them here before any data exists is fine.
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

  const dashboard = new cloudwatch.Dashboard(stack, 'AppDashboard', {
    dashboardName: 'paddlesnitch-app',
    defaultInterval: cdk.Duration.days(30),
  })

  dashboard.addWidgets(
    new cloudwatch.GraphWidget({
      title: 'Product events / day',
      left: eventNames.map(e => eventMetric(e, cdk.Duration.days(1))),
      width: 24,
      height: 8,
    }),
  )

  dashboard.addWidgets(
    new cloudwatch.SingleValueWidget({
      title: 'Events — selected time range (totals)',
      metrics: eventNames.map(e => eventMetric(e, cdk.Duration.days(1))),
      width: 24,
      height: 4,
      setPeriodToTimeRange: true,
    }),
  )

  // Finer-grained, behaviour-oriented views over the same EMF data. Pageviews
  // arrive in batches (client capture flushes ~15s / on tab-hide), so an hourly
  // series makes recent/sparse traffic visible where the daily one hides it.
  dashboard.addWidgets(
    new cloudwatch.GraphWidget({
      title: 'Pageviews & key events / hour',
      left: ['pageview', 'signup', 'login', 'upload'].map(e => eventMetric(e, cdk.Duration.hours(1))),
      width: 24,
      height: 6,
    }),
  )

  // Logs Insights over the server Lambda's log group (where emitMetric writes
  // the EMF lines). Referenced by NAME so we don't create/adopt a LogGroup
  // resource (which could clash with the one Lambda auto-creates on first run).
  const serverLogGroup = `/aws/lambda/${serverFn.functionName}`
  dashboard.addWidgets(
    new cloudwatch.LogQueryWidget({
      title: 'Pageviews by path (what people look at)',
      logGroupNames: [serverLogGroup],
      view: cloudwatch.LogQueryVisualizationType.TABLE,
      queryLines: [
        'filter Event = "pageview"',
        'stats count(*) as views by path',
        'sort views desc',
        'limit 30',
      ],
      width: 12,
      height: 8,
    }),
    new cloudwatch.LogQueryWidget({
      title: 'Events by type + distinct sessions',
      logGroupNames: [serverLogGroup],
      view: cloudwatch.LogQueryVisualizationType.TABLE,
      queryLines: [
        'filter ispresent(Event)',
        'stats count(*) as events, count_distinct(sid) as sessions by Event',
        'sort events desc',
      ],
      width: 12,
      height: 8,
    }),
  )

  // Marketing campaigns (?campaign=<id> landings): visits → button clicks →
  // sign-ups, one row per campaign + step. `pageview` rows are visits that
  // arrived on a campaign link, `campaign_cta` the main button, and
  // `campaign_signup` saved applications (server-side; `repeat` = "true"
  // is someone updating theirs). Visitors = distinct browser tabs; the
  // server-side sign-up has none.
  dashboard.addWidgets(
    new cloudwatch.LogQueryWidget({
      title: 'Campaigns: visits → button clicks → sign-ups',
      logGroupNames: [serverLogGroup],
      view: cloudwatch.LogQueryVisualizationType.TABLE,
      queryLines: [
        'filter ispresent(campaign)',
        'stats count(*) as events, count_distinct(sid) as visitors by campaign, Event, repeat',
        'sort campaign asc, events desc',
      ],
      width: 24,
      height: 6,
    }),
  )

  dashboard.addWidgets(
    new cloudwatch.GraphWidget({
      title: 'Server Lambda — invocations & errors / hour',
      left: [serverFn.metricInvocations({ statistic: 'Sum', period: cdk.Duration.hours(1) })],
      right: [serverFn.metricErrors({ statistic: 'Sum', period: cdk.Duration.hours(1) })],
      width: 12,
      height: 6,
    }),
    new cloudwatch.GraphWidget({
      title: 'Server Lambda — duration p95 (ms)',
      left: [serverFn.metricDuration({ statistic: 'p95', period: cdk.Duration.hours(1) })],
      width: 12,
      height: 6,
    }),
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
  // Performance dashboard: the scheduled check's page timings (the same pages
  // every run, so a line is a trend) next to what real visitors got from the
  // server Lambda, and CloudFront's error rate.
  // ---------------------------------------------------------------------------
  const perfDashboard = new cloudwatch.Dashboard(stack, 'PerfDashboard', {
    dashboardName: 'paddlesnitch-performance',
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
  new cdk.CfnOutput(stack, 'PerfDashboardUrl', {
    value: `https://${stack.region}.console.aws.amazon.com/cloudwatch/home?region=${stack.region}#dashboards/dashboard/paddlesnitch-performance`,
    description: 'CloudWatch dashboard for page speed',
  })

  new cdk.CfnOutput(stack, 'DashboardUrl', {
    value: `https://${stack.region}.console.aws.amazon.com/cloudwatch/home?region=${stack.region}#dashboards/dashboard/paddlesnitch-app`,
    description: 'CloudWatch dashboard for product events + server health',
  })
  new cdk.CfnOutput(stack, 'FirmwareDashboardUrl', {
    value: `https://${stack.region}.console.aws.amazon.com/cloudwatch/home?region=${stack.region}#dashboards/dashboard/paddlesnitch-firmware`,
    description: 'CloudWatch dashboard for firmware rollout (offers, boots, failures)',
  })
}
