import * as path from 'path';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cdk from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as route53targets from 'aws-cdk-lib/aws-route53-targets'
import * as ses from 'aws-cdk-lib/aws-ses'
import * as sesActions from 'aws-cdk-lib/aws-ses-actions'
import { Construct } from 'constructs'

export class AttStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // ---------------------------------------------------------------------------
    // GitHub Actions OIDC — allows CI to deploy without stored AWS keys
    // ---------------------------------------------------------------------------
    const githubProvider = new iam.OpenIdConnectProvider(this, 'GithubOidc', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    })

    const deployRole = new iam.Role(this, 'GithubDeployRole', {
      roleName: 'att-github-deploy',
      assumedBy: new iam.WebIdentityPrincipal(githubProvider.openIdConnectProviderArn, {
        StringLike: {
          // GitHub Actions → AWS OIDC deploy, trusting main of the paddlesnitch
          // repo. After the paddlesnitch-att → paddlesnitch rename, GitHub
          // switched this repo to IMMUTABLE OIDC subject claims: the token `sub`
          // is now `repo:<owner>@<ownerId>/<repo>@<repoId>:…` (numeric IDs that
          // survive future renames), NOT the plain `repo:owner/repo:…` form.
          // baldur=759, paddlesnitch=1254392477. We trust the immutable form
          // (what the runner actually presents) and keep the plain form too, so
          // this still works if GitHub ever reverts to plain subjects.
          //
          // MOVING TO THE `production` ENVIRONMENT (security audit 2026-09).
          // `ref:refs/heads/main` is presented by EVERY workflow that runs on
          // main -- including the Claude intake/fast-loop jobs, which run on
          // anonymous public issues with Bash and id-token: write. So a
          // prompt-injected issue could mint this role (AdministratorAccess).
          // A job only presents `environment:production` if it declares that
          // environment, and only deploy.yml / firmware-release.yml do.
          // Moved in two steps (the deploy that changes this trust runs under
          // the old one): both subjects were trusted first, then the workflows
          // declared the environment and ref:main was dropped. Do not add
          // ref:refs/heads/main back.
          'token.actions.githubusercontent.com:sub': [
            'repo:baldur@759/paddlesnitch@1254392477:environment:production',
            'repo:baldur/paddlesnitch:environment:production',
          ],
        },
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
      }),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'),
      ],
      maxSessionDuration: cdk.Duration.hours(1),
    })

    // ---------------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------------

    const dataBucket = new s3.Bucket(this, 'DataBucket', {
      bucketName: 'paddlesnitch-data-prod',
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      versioned: false,
      lifecycleRules: [{
        // Firmware rollout records (which device was offered which build, and
        // how it booted). Troubleshooting data, not an audit trail — and it
        // ties a physical device to a user account, so it expires rather than
        // accumulating forever. See docs/features/device-ota-and-auth.md 1.4.
        id: 'expire-firmware-events',
        prefix: 'firmware-events/',
        expiration: cdk.Duration.days(90),
      }, {
        // Rate-limit counters (packages/core/src/rate-limit.ts). Each is one
        // fixed window and is worthless the moment that window closes, but
        // nothing deletes them inline — the limiter does a read and at most one
        // write per request and adding a delete would cost more than the object.
        // One day is far longer than the one-hour windows in use.
        id: 'expire-rate-limit-counters',
        prefix: 'rate/',
        expiration: cdk.Duration.days(1),
      }],
    })

    const assetsBucket = new s3.Bucket(this, 'AssetsBucket', {
      bucketName: 'paddlesnitch-assets-prod',
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      // We keep old builds' content-hashed assets across deploys (prune:false on
      // DeployAssets) so in-flight HTML never 404/403s mid-deploy. This rule
      // sweeps the orphaned old hashes so they don't accumulate forever. Active
      // assets are re-uploaded every deploy (LastModified refreshed), so only
      // genuinely-unreferenced hashes age out — 90 days is far longer than any
      // cached HTML could still point at them.
      lifecycleRules: [{
        id: 'expire-orphaned-hashed-assets',
        prefix: '_assets/_next/static/',
        expiration: cdk.Duration.days(90),
      }, {
        // Sweep the RETIRED analysis-app asset prefix. The Analyse app is now part
        // of the single server function (its assets live under _assets/_next/ like
        // the rest), so nothing new lands here — this rule ages out the leftovers
        // from the old two-app deploy.
        id: 'expire-orphaned-analysis-hashed-assets',
        prefix: '_analyse-assets/analyse/_next/static/',
        expiration: cdk.Duration.days(90),
      }],
    })

    // ---------------------------------------------------------------------------
    // Cognito User Pool — identity store for all users
    // ---------------------------------------------------------------------------
    // NOTE on schema: Cognito does NOT allow modifying a user pool's Schema
    // after creation. Declaring `standardAttributes` here on the already-deployed
    // pool causes UPDATE_FAILED with "Invalid AttributeDataType input". `email`
    // and `name` are already standard Cognito attributes available by default —
    // the signUp call passes them in UserAttributes and Cognito stores them.
    // If we ever need to require/extend attributes, the only safe path is to
    // create a new pool.
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'paddlesnitch-users',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      // autoVerify explicitly disabled. The signUp handler immediately calls
      // AdminConfirmSignUp + AdminUpdateUserAttributes (email_verified=true),
      // so the user is confirmed and recovery-ready without Cognito sending
      // a spam-looking verification email from its default sender.
      // CDK defaults autoVerify to true when signInAliases.email is set, so
      // we must override explicitly.
      autoVerify: { email: false, phone: false },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      // Send all Cognito-originated emails (password reset code, OTP code,
      // any future verification) from noreply@paddlesnitch.com via SES.
      // DKIM, MAIL FROM (mail.paddlesnitch.com), and DMARC are all aligned —
      // recipients see legitimate transactional mail.
      email: cognito.UserPoolEmail.withSES({
        fromEmail: 'noreply@paddlesnitch.com',
        fromName: 'paddlesnitch.com',
        sesRegion: 'eu-west-1',
        sesVerifiedDomain: 'paddlesnitch.com',
        replyTo: 'privacy@paddlesnitch.com',
      }),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })

    // Custom Auth Lambda triggers for OTP / passwordless sign-in.
    // Source lives in infra/lambdas/cognito-auth/ — same .mjs files run
    // both here and in the dev lambda-emulator.
    const lambdaDir = path.join(__dirname, '../lambdas/cognito-auth')
    const defineAuth = new lambda.Function(this, 'DefineAuthChallenge', {
      functionName: 'att-cognito-define-auth-challenge',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'define-auth-challenge.handler',
      code: lambda.Code.fromAsset(lambdaDir),
      timeout: cdk.Duration.seconds(5),
    })
    const createAuth = new lambda.Function(this, 'CreateAuthChallenge', {
      functionName: 'att-cognito-create-auth-challenge',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'create-auth-challenge.handler',
      code: lambda.Code.fromAsset(lambdaDir),
      timeout: cdk.Duration.seconds(10),
      environment: {
        FROM_EMAIL: 'noreply@paddlesnitch.com',
      },
    })
    // SES SendEmail authorises against multiple resources at once. We need
    // to grant on all of them:
    //   - identity/*  — both the FROM (paddlesnitch.com) AND the recipient
    //     (every user's email) get checked in SANDBOX mode. The recipient
    //     check goes away in production, but the FROM check stays.
    //   - configuration-set/*  — Virtual Deliverability Manager auto-attaches
    //     the account's default config set to every send, and SES checks
    //     IAM against it. Without permission, sends fail even with the
    //     identity permission in place.
    createAuth.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: [
        `arn:aws:ses:eu-west-1:${this.account}:identity/*`,
        `arn:aws:ses:eu-west-1:${this.account}:configuration-set/*`,
      ],
    }))
    const verifyAuth = new lambda.Function(this, 'VerifyAuthChallenge', {
      functionName: 'att-cognito-verify-auth-challenge',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'verify-auth-challenge.handler',
      code: lambda.Code.fromAsset(lambdaDir),
      timeout: cdk.Duration.seconds(5),
    })

    // Attach Cognito triggers. addTrigger() also grants Cognito the
    // lambda:InvokeFunction permission on each.
    userPool.addTrigger(cognito.UserPoolOperation.DEFINE_AUTH_CHALLENGE, defineAuth)
    userPool.addTrigger(cognito.UserPoolOperation.CREATE_AUTH_CHALLENGE, createAuth)
    userPool.addTrigger(cognito.UserPoolOperation.VERIFY_AUTH_CHALLENGE_RESPONSE, verifyAuth)

    const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool,
      userPoolClientName: 'paddlesnitch-web',
      authFlows: {
        userPassword: true,
        adminUserPassword: true,
        custom: true,
      },
      generateSecret: false,
      idTokenValidity: cdk.Duration.hours(24),
      accessTokenValidity: cdk.Duration.hours(24),
      refreshTokenValidity: cdk.Duration.days(30),
      enableTokenRevocation: true,
      preventUserExistenceErrors: true,
    })

    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId })
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId })

    // ---------------------------------------------------------------------------
    // Compute — OpenNext v4 outputs to server-functions/default
    // ---------------------------------------------------------------------------

    const serverFn = new lambda.Function(this, 'ServerFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../apps/web/.open-next/server-functions/default')
      ),
      memorySize: 1024,
      timeout: cdk.Duration.seconds(30),
      environment: {
        DATA_BUCKET: dataBucket.bucketName,
        NODE_ENV: 'production',
        NEXT_PUBLIC_BASE_URL: 'https://paddlesnitch.com',
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
        COGNITO_REGION: this.region,
        // GitHub PAT used by the feedback widget to file issues. CFN can't
        // resolve SSM SecureString parameters at synth time, so we pass the
        // parameter NAME here and the route fetches+decrypts at runtime.
        // Must exist as an SSM SecureString at /att/github-issues-token.
        // Fine-grained scope: Issues: read/write on baldur/paddlesnitch.
        GITHUB_ISSUES_TOKEN_PARAM: '/att/github-issues-token',
        GITHUB_REPO: 'baldur/paddlesnitch',
        // Strava API credentials. Both halves live in SSM so deploys never
        // need GitHub-side variables or secrets — the Lambda fetches them at
        // runtime via fetchSsmParam() in src/lib/strava.ts. Client ID is a
        // plain String (it's public); the secret is a SecureString.
        STRAVA_CLIENT_ID_PARAM: '/att/strava-client-id',
        STRAVA_CLIENT_SECRET_PARAM: '/att/strava-client-secret',
        // Strava webhook verify token (shared secret echoed on the subscription
        // validation handshake). SSM SecureString, fetched at runtime. See
        // docs/features/strava-auto-import.md.
        STRAVA_WEBHOOK_VERIFY_TOKEN_PARAM: '/att/strava-webhook-verify-token',
        // The Analyse app is now part of this single server function, so its LLM
        // insight backend (packages/analysis/src/llm.ts) runs here. Bedrock region
        // + model; NODE_ENV=production hard-pins the Bedrock backend. To bump the
        // narration model, see docs/features/personable-insights.md (the grant
        // below already covers inference-profile/*).
        BEDROCK_REGION: 'eu-west-1',
        LLM_MODEL: 'mistral.mixtral-8x7b-instruct-v0:1',
        // Platform administrators (Cognito `sub`s, comma-separated) — the only
        // people who may read cross-account operational data such as one
        // device's firmware history. Deliberately a deploy-time allowlist and
        // not a flag in storage: no route can grant it, so escalating needs a
        // deploy. Unset means nobody, which is the safe default.
        ADMIN_USER_IDS: process.env.ADMIN_USER_IDS ?? '',
      },
    })

    dataBucket.grantReadWrite(serverFn)

    // Bedrock InvokeModel for the Analyse LLM insight (now served by this
    // function). Foundation-model ARNs carry no account (AWS-owned); inference
    // profiles live in this account/region.
    serverFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        'arn:aws:bedrock:*::foundation-model/*',
        `arn:aws:bedrock:eu-west-1:${this.account}:inference-profile/*`,
      ],
    }))

    // ses:SendEmail authorises against multiple resources at once — the same
    // trap the Cognito trigger grant documents above. The server function sends
    // group-invitation emails (src/lib/email.ts), so it needs the identical
    // grant, not just identity/paddlesnitch.com:
    //   - identity/*          — FROM plus (in SANDBOX) every recipient address.
    //   - configuration-set/* — VDM auto-attaches the account default config set
    //     to every send and SES checks IAM against it; without this, SendEmail
    //     fails with AccessDenied even though the identity grant is present. That
    //     failure is swallowed by email.ts, so invitation emails silently never
    //     send. Kept in lockstep with the createAuth grant above.
    serverFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: [
        `arn:aws:ses:eu-west-1:${this.account}:identity/*`,
        `arn:aws:ses:eu-west-1:${this.account}:configuration-set/*`,
      ],
    }))

    // Runtime-fetched SSM SecureStrings. CFN can't resolve SecureString
    // values at synth, so the Lambda decrypts them on first use and caches.
    // Scope is narrow — one explicit ARN per parameter.
    serverFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/att/github-issues-token`,
        `arn:aws:ssm:${this.region}:${this.account}:parameter/att/strava-client-id`,
        `arn:aws:ssm:${this.region}:${this.account}:parameter/att/strava-client-secret`,
        `arn:aws:ssm:${this.region}:${this.account}:parameter/att/strava-webhook-verify-token`,
      ],
    }))
    // kms:Decrypt is required to actually decrypt SecureString values. Without
    // it, GetParameter(WithDecryption=true) returns the encrypted ciphertext
    // blob silently, which is what bit us with the Strava client secret —
    // Strava saw the ~240-char encrypted base64 as "the secret" and rejected
    // it as Application/invalid. Restrict the grant to the SSM-service KMS
    // context so the role can only decrypt parameters fetched through SSM.
    serverFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['kms:Decrypt'],
      resources: [`arn:aws:kms:${this.region}:${this.account}:key/*`],
      conditions: {
        StringEquals: { 'kms:ViaService': `ssm.${this.region}.amazonaws.com` },
      },
    }))

    // Cognito admin operations the app calls. Must list every admin (IAM-gated)
    // action the server uses — a missing one throws AccessDeniedException at
    // runtime. The public client APIs (InitiateAuth/RespondToAuthChallenge/
    // SignUp/ForgotPassword/ConfirmForgotPassword) authenticate with the app
    // client id, NOT IAM, so they're intentionally absent here.
    //   ListUsers          — findUserByEmail / findUserBySub (email-merge +
    //                         Strava sign-in resolving a linked account by sub)
    //   AdminCreateUser     — create a Cognito user for a new Strava sign-in
    //   AdminSetUserPassword— set the throwaway password on that created user
    //   AdminConfirmSignUp / AdminUpdateUserAttributes — confirm + mark email
    //                         verified at signup so password reset works
    //   AdminGetUser        — read user state
    //   AdminDeleteUser     — GDPR Art. 17 erasure
    //   RevokeToken         — logout
    serverFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:ListUsers',
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminSetUserPassword',
        'cognito-idp:AdminConfirmSignUp',
        'cognito-idp:AdminGetUser',
        'cognito-idp:AdminUpdateUserAttributes',
        'cognito-idp:AdminDeleteUser',
        'cognito-idp:RevokeToken',
      ],
      resources: [userPool.userPoolArn],
    }))

    const serverUrl = serverFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    })

    const imageOptFn = new lambda.Function(this, 'ImageOptFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../apps/web/.open-next/image-optimization-function')
      ),
      memorySize: 1536,
      timeout: cdk.Duration.seconds(25),
      environment: {
        BUCKET_NAME: assetsBucket.bucketName,
        BUCKET_KEY_PREFIX: '_assets',
      },
    })

    assetsBucket.grantRead(imageOptFn)

    const imageOptUrl = imageOptFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    })

    // ---------------------------------------------------------------------------
    // CloudFront — behaviors match OpenNext v4 output manifest
    // Assets are deployed under _assets/ prefix; origin path translates back
    // ---------------------------------------------------------------------------
    const serverOrigin = new origins.HttpOrigin(
      cdk.Fn.select(2, cdk.Fn.split('/', serverUrl.url))
    )

    const imageOptOrigin = new origins.HttpOrigin(
      cdk.Fn.select(2, cdk.Fn.split('/', imageOptUrl.url))
    )

    // S3 origin with /_assets prefix — CloudFront prepends this when fetching
    const assetsOrigin = origins.S3BucketOrigin.withOriginAccessControl(assetsBucket, {
      originPath: '/_assets',
    })

    const certificate = acm.Certificate.fromCertificateArn(this, 'Certificate',
      'arn:aws:acm:us-east-1:423220633280:certificate/3c7ad0c4-5bd2-4959-907b-971417a0ff08'
    )

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      domainNames: ['paddlesnitch.com', 'www.paddlesnitch.com'],
      certificate,
      defaultBehavior: {
        origin: serverOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
      additionalBehaviors: {
        // Image optimizer — must be before /_next/* to take precedence
        '/_next/image*': {
          origin: imageOptOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
        // All other _next assets (JS, CSS, fonts) served from S3
        '/_next/*': {
          origin: assetsOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        // Static files under public/ (OpenNext copies public/ into the assets
        // bundle, deployed to S3 under _assets/). Without an explicit behavior
        // these hit the default server origin and 404 — which is why the Strava
        // brand images (public/strava/*.svg) showed as broken in prod (#135).
        // Add a behavior per public subdirectory the app actually fetches.
        '/strava/*': {
          origin: assetsOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        '/data/*': {
          origin: assetsOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        // Marketing landing media (the ?campaign= pages), e.g. the beta testers video.
        '/campaigns/*': {
          origin: assetsOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        // /analyse is now part of the single app: its pages + API hit the default
        // server origin and its assets are under /_next/* (served from S3 above),
        // so no /analyse-specific behaviors are needed any more.
      },
    })

    // OpenNext v4 assets go under _assets/ in S3.
    //
    // Two mid-deploy-safety properties, both needed because a deploy is NOT
    // atomic:
    //
    // 1. prune:false — BucketDeployment defaults to deleting any destination
    //    object not in the new build, which would remove the PREVIOUS build's
    //    hashed assets. In-flight/cached OLD HTML still references those, so
    //    pruning would 403 them. Next.js assets are content-hashed + immutable,
    //    so old and new coexist safely; the bucket lifecycle rule above expires
    //    the orphans later. (Protects OLD HTML → OLD chunks.)
    //
    // 2. The server Lambda must NOT go live with NEW HTML before the NEW chunks
    //    it references exist in S3, or every /_next/static/<hash> 404s until the
    //    upload finishes (this broke the whole app chrome when a shared-header
    //    change rehashed every page's bundle). We therefore make the upload a
    //    DEPENDENCY of the server function below (serverFn.addDependency), so
    //    CloudFormation uploads assets FIRST, then flips the Lambda. (Protects
    //    NEW HTML → NEW chunks.)
    //
    // NB: no `distribution`/`distributionPaths` here on purpose. The built-in
    // invalidation would make this deployment depend on the distribution, which
    // depends on serverFn — forcing the exact wrong order (Lambda before upload)
    // and making the dependency in (2) a cycle. Invalidation isn't needed anyway:
    // _next/* assets are content-hashed (new deploys = new URLs), so there is
    // nothing stale to purge. The one-off #135 cached-404s are long gone (the
    // /strava + /data behaviors exist now); if a non-hashed public/ file ever
    // changes, invalidate that path manually.
    const deployAssets = new s3deploy.BucketDeployment(this, 'DeployAssets', {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '../../apps/web/.open-next/assets')),
      ],
      destinationBucket: assetsBucket,
      destinationKeyPrefix: '_assets',
      prune: false,
    })

    // Order the deploy so the server Lambda only goes live AFTER its new hashed
    // assets are in S3 (see property 2 above). Without this, CloudFormation may
    // flip the Lambda first, leaving a window where new HTML references chunks
    // that aren't uploaded yet → 404s across the site during every deploy.
    serverFn.node.addDependency(deployAssets)

    // ---------------------------------------------------------------------------
    // DNS — www alias pointing to same CloudFront distribution
    // (apex A record was created manually in Route53; www was missing)
    // ---------------------------------------------------------------------------
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: 'Z08692883MHJE285KA9DQ',
      zoneName: 'paddlesnitch.com',
    })

    new route53.ARecord(this, 'WwwAlias', {
      zone: hostedZone,
      recordName: 'www',
      target: route53.RecordTarget.fromAlias(new route53targets.CloudFrontTarget(distribution)),
    })

    // ---------------------------------------------------------------------------
    // Inbound email — privacy@paddlesnitch.com forwarder
    // ---------------------------------------------------------------------------
    // SES receives mail addressed to privacy@paddlesnitch.com, stores the
    // raw MIME under inbound-email/privacy/{messageId} in the data bucket,
    // and invokes a Lambda that re-sends the message to the human inbox.
    //
    // NOTE: SES allows ONE active receipt rule set per region. After the
    // first deploy that creates the rule set, run:
    //   aws ses set-active-receipt-rule-set --rule-set-name <name> --region eu-west-1
    // The rule set name is exported below as ReceiptRuleSetName.
    // We could automate this via an AwsCustomResource, but that risks
    // clobbering an active rule set someone set manually in the future,
    // so we keep activation as a one-time human step.

    const inboundEmailBucket = dataBucket
    const inboundEmailPrefix = 'inbound-email/privacy/'

    // SES needs PutObject on the prefix to deliver mail to S3. The bucket
    // policy must explicitly allow the SES service principal scoped to
    // this account + region; without the SourceAccount + SourceArn
    // conditions, the action would 403.
    inboundEmailBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowSesInboundPut',
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('ses.amazonaws.com')],
      actions: ['s3:PutObject'],
      resources: [`${inboundEmailBucket.bucketArn}/${inboundEmailPrefix}*`],
      conditions: {
        StringEquals: {
          'AWS:SourceAccount': this.account,
        },
        StringLike: {
          'AWS:SourceArn': `arn:aws:ses:${this.region}:${this.account}:receipt-rule-set/*`,
        },
      },
    }))

    const forwarderFn = new lambda.Function(this, 'EmailForwarderFn', {
      functionName: 'att-email-forwarder',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambdas/email-forwarder')),
      timeout: cdk.Duration.seconds(20),
      memorySize: 256,
      environment: {
        INBOUND_BUCKET: inboundEmailBucket.bucketName,
        INBOUND_PREFIX: inboundEmailPrefix,
        FROM_EMAIL: 'noreply@paddlesnitch.com',
        // Hard-coded for now — the only privacy contact today. When we
        // need more sophisticated routing (per-team aliases, on-call
        // rotation) this becomes a Parameter Store lookup.
        FORWARD_TO: 'baldur.gudbjornsson@gmail.com',
        SUBJECT_PREFIX: '[paddlesnitch]',
      },
    })

    forwarderFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [`${inboundEmailBucket.bucketArn}/${inboundEmailPrefix}*`],
    }))
    forwarderFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendRawEmail'],
      resources: [`arn:aws:ses:${this.region}:${this.account}:identity/paddlesnitch.com`],
    }))

    const ruleSet = new ses.ReceiptRuleSet(this, 'InboundRules', {
      receiptRuleSetName: 'paddlesnitch-inbound',
    })

    ruleSet.addRule('PrivacyAlias', {
      recipients: ['privacy@paddlesnitch.com'],
      scanEnabled: true,    // spam / virus marker headers added to S3 object
      tlsPolicy: ses.TlsPolicy.OPTIONAL,
      actions: [
        new sesActions.S3({
          bucket: inboundEmailBucket,
          objectKeyPrefix: inboundEmailPrefix,
        }),
        new sesActions.Lambda({
          function: forwarderFn,
          invocationType: sesActions.LambdaInvocationType.EVENT,
        }),
      ],
    })

    // MX record so the world knows where to send paddlesnitch.com mail.
    // priority 10 is conventional for a single MX target.
    new route53.MxRecord(this, 'InboundMx', {
      zone: hostedZone,
      recordName: 'paddlesnitch.com.',
      values: [{ priority: 10, hostName: `inbound-smtp.${this.region}.amazonaws.com` }],
      ttl: cdk.Duration.minutes(30),
    })

    new cdk.CfnOutput(this, 'ReceiptRuleSetName', {
      value: ruleSet.receiptRuleSetName,
      description: 'Run `aws ses set-active-receipt-rule-set --rule-set-name <this> --region eu-west-1` once to activate.',
    })

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

    const dashboard = new cloudwatch.Dashboard(this, 'AppDashboard', {
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

    const firmwareDashboard = new cloudwatch.Dashboard(this, 'FirmwareDashboard', {
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
      new cloudwatch.SingleValueWidget({
        title: 'Selected range - totals',
        metrics: [
          firmwareMetric('FirmwareOfferIssued', cdk.Duration.days(1)),
          firmwareMetric('FirmwareBootConfirmed', cdk.Duration.days(1)),
          firmwareMetric('FirmwareBootFailed', cdk.Duration.days(1)),
          firmwareMetric('FirmwareCheckNotModified', cdk.Duration.days(1)),
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
    // Outputs
    // ---------------------------------------------------------------------------
    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: `https://${distribution.distributionDomainName}`,
    })
    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards/dashboard/paddlesnitch-app`,
      description: 'CloudWatch dashboard for product events + server health',
    })
    new cdk.CfnOutput(this, 'FirmwareDashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards/dashboard/paddlesnitch-firmware`,
      description: 'CloudWatch dashboard for firmware rollout (offers, boots, failures)',
    })
    new cdk.CfnOutput(this, 'DataBucketName', {
      value: dataBucket.bucketName,
    })
    new cdk.CfnOutput(this, 'AssetsBucketName', {
      value: assetsBucket.bucketName,
    })
    new cdk.CfnOutput(this, 'GithubDeployRoleArn', {
      value: deployRole.roleArn,
      description: 'Paste into GitHub Actions workflow as AWS_ROLE_ARN',
    })
  }
}
