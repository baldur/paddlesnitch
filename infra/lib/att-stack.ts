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
          // GitHub Actions → AWS OIDC deploy: trust main of the paddlesnitch repo.
          'token.actions.githubusercontent.com:sub': 'repo:baldur/paddlesnitch:ref:refs/heads/main',
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
        // Same sweep for the analysis app's hashed assets (deployed with
        // prune:false under _analyse-assets/analyse/, see DeployAnalysisAssets).
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
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'define-auth-challenge.handler',
      code: lambda.Code.fromAsset(lambdaDir),
      timeout: cdk.Duration.seconds(5),
    })
    const createAuth = new lambda.Function(this, 'CreateAuthChallenge', {
      functionName: 'att-cognito-create-auth-challenge',
      runtime: lambda.Runtime.NODEJS_20_X,
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
      runtime: lambda.Runtime.NODEJS_20_X,
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
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../apps/att/.open-next/server-functions/default')
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
      },
    })

    dataBucket.grantReadWrite(serverFn)

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
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../apps/att/.open-next/image-optimization-function')
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
    // Analysis app — second OpenNext server Lambda, served at /analyse
    // ---------------------------------------------------------------------------
    // Same shared Cognito pool + data bucket as att (one account, per-app S3
    // key prefixes — the analysis app writes under analysis/{userId}/…). The app
    // uses Bedrock for its LLM insight (src/lib/llm.ts) and Strava for imports,
    // so it needs bedrock:InvokeModel + the same Strava SSM/KMS grants ServerFn
    // has. It does NOT call any Cognito admin API (getAuthUser verifies JWTs via
    // JWKS), so no cognito-idp permissions here.
    const analysisFn = new lambda.Function(this, 'AnalysisFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../apps/analysis/.open-next/server-functions/default')
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
        // Bedrock region for the LLM insight backend (llm.ts). NODE_ENV=production
        // hard-pins the Bedrock backend.
        BEDROCK_REGION: 'eu-west-1',
        // The Bedrock model the insight generator calls. Mistral Mixtral 8x7b:
        // ON_DEMAND in eu-west-1 (auto-enables on first invoke — no console
        // step), and the same base as the local Ollama `dolphin-mixtral:8x7b`
        // so prompt-tuning maps between dev and prod. Verified via Converse.
        //
        // To BUMP the narration model for the personable-insights feature
        // (docs/features/personable-insights.md), switch this to a Claude Haiku
        // or Nova Lite eu-west-1 INFERENCE-PROFILE id, e.g.
        //   'eu.anthropic.claude-3-5-haiku-20241022-v1:0'  (Claude Haiku 3.5)
        //   'eu.amazon.nova-lite-v1:0'                       (Amazon Nova Lite)
        // The `BedrockInsighter` already uses model-agnostic Converse, so it's a
        // one-line change here. Before flipping: (1) enable model access for that
        // model in the Bedrock console (unlike Mixtral's auto-enable), and (2)
        // confirm the exact profile id in this region. The IAM grant already
        // covers `inference-profile/*`. Billed to AWS, NOT the Anthropic quota.
        LLM_MODEL: 'mistral.mixtral-8x7b-instruct-v0:1',
        // Strava API credentials — shared with att, fetched from SSM at runtime.
        STRAVA_CLIENT_ID_PARAM: '/att/strava-client-id',
        STRAVA_CLIENT_SECRET_PARAM: '/att/strava-client-secret',
      },
    })

    dataBucket.grantReadWrite(analysisFn)

    // Bedrock InvokeModel for the LLM insight. Foundation-model ARNs carry no
    // account (AWS-owned); inference profiles live in this account/region.
    analysisFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        'arn:aws:bedrock:*::foundation-model/*',
        `arn:aws:bedrock:eu-west-1:${this.account}:inference-profile/*`,
      ],
    }))

    // Strava credentials via SSM — same grants ServerFn has (see the notes on
    // the ServerFn SSM + KMS statements above for why kms:Decrypt is required).
    analysisFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/att/strava-client-id`,
        `arn:aws:ssm:${this.region}:${this.account}:parameter/att/strava-client-secret`,
      ],
    }))
    analysisFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['kms:Decrypt'],
      resources: [`arn:aws:kms:${this.region}:${this.account}:key/*`],
      conditions: {
        StringEquals: { 'kms:ViaService': `ssm.${this.region}.amazonaws.com` },
      },
    }))

    const analysisUrl = analysisFn.addFunctionUrl({
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

    // Analysis app server origin (its own OpenNext Lambda function URL).
    const analysisOrigin = new origins.HttpOrigin(
      cdk.Fn.select(2, cdk.Fn.split('/', analysisUrl.url))
    )

    // Analysis assets S3 origin. The analysis app has basePath '/analyse', so the
    // browser requests assets at /analyse/_next/*. OpenNext still writes them to
    // disk under _next/* (basePath is applied to emitted URLs, not on-disk paths),
    // so we deploy them into the shared assets bucket under the key prefix
    // `_analyse-assets/analyse/…` (DeployAnalysisAssets below). originPath only
    // PREPENDS — it can't strip the /analyse the request carries — so pointing it
    // at /_analyse-assets turns a request for /analyse/_next/static/x into the S3
    // key _analyse-assets/analyse/_next/static/x, which is where the file lands.
    const analysisAssetsOrigin = origins.S3BucketOrigin.withOriginAccessControl(assetsBucket, {
      originPath: '/_analyse-assets',
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
        // Analysis app (basePath /analyse). MUST be listed before /analyse* so
        // the more specific asset pattern wins — static JS/CSS/fonts served from
        // S3, everything else (pages + API) from the analysis server Lambda.
        '/analyse/_next/*': {
          origin: analysisAssetsOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        '/analyse*': {
          origin: analysisOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
    })

    // OpenNext v4 assets go under _assets/ in S3.
    // prune:false is the fix for mid-deploy 403s on CSS/JS: BucketDeployment
    // defaults to deleting any destination object not in the new build, which
    // removes the PREVIOUS build's hashed assets. Because a deploy isn't atomic
    // (the server Lambda begins serving HTML with new asset hashes while old
    // cached HTML still references old hashes), pruning leaves a window where a
    // requested /_next/static/<hash> is gone from S3 and the OAC origin returns
    // 403. Next.js assets are content-hashed + immutable, so old and new coexist
    // safely; the bucket lifecycle rule above expires the orphans later.
    new s3deploy.BucketDeployment(this, 'DeployAssets', {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '../../apps/att/.open-next/assets')),
      ],
      destinationBucket: assetsBucket,
      destinationKeyPrefix: '_assets',
      prune: false,
      distribution,
      // Invalidate the public-asset paths too so previously-cached 404s (from
      // before the /strava + /data behaviors existed) are purged (#135).
      distributionPaths: ['/_next/*', '/strava/*', '/data/*'],
    })

    // Analysis app assets. Deployed under _analyse-assets/analyse/ so the key
    // includes the /analyse basePath segment the browser sends (see
    // analysisAssetsOrigin above). Same prune:false + lifecycle story as att.
    new s3deploy.BucketDeployment(this, 'DeployAnalysisAssets', {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '../../apps/analysis/.open-next/assets')),
      ],
      destinationBucket: assetsBucket,
      destinationKeyPrefix: '_analyse-assets/analyse',
      prune: false,
      distribution,
      distributionPaths: ['/analyse/_next/*'],
    })

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
      runtime: lambda.Runtime.NODEJS_20_X,
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
    // Outputs
    // ---------------------------------------------------------------------------
    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: `https://${distribution.distributionDomainName}`,
    })
    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards/dashboard/paddlesnitch-app`,
      description: 'CloudWatch dashboard for product events + server health',
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
