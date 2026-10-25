# infra — production (AWS CDK)

Moved from the root `CLAUDE.md`. The stack is `infra/lib/att-stack.ts`; dashboards are `infra/lib/dashboards.ts`. Product analytics, operational telemetry, the performance check and the jobs folder are described in `apps/web/CLAUDE.md` (they're server code with infra behind them).

## Architecture (Production)

```
Browser
  │
  └─── CloudFront (d1745e47jh0mdf.cloudfront.net)
         ├──► S3 paddlesnitch-assets-prod  (static assets, served via OAC)
         └──► Lambda (server function)     (Next.js SSR + API routes via OpenNext v4)
                ├──► Cognito paddlesnitch-users (eu-west-1) ← users + tokens
                ├──► S3 paddlesnitch-data-prod              ← courses, trials, entries
                └──► SES (noreply@paddlesnitch.com)         ← sign-in codes, invitations, notifications
```

OpenNext v4 bundles the Next.js server into a single Lambda. No API Gateway — CloudFront routes directly to a Lambda function URL. Static assets (JS/CSS/images) go to S3 and are served by CloudFront with long cache TTLs.

**Deploy is not atomic — asset ordering matters (both directions).** Next.js chunks are content-hashed, so a deploy that changes shared code (e.g. the header) rehashes every page's bundle. Two guards in `infra/lib/att-stack.ts` keep the site from breaking mid-deploy: (1) the asset `BucketDeployment`s use **`prune:false`** so the PREVIOUS build's hashed files survive for in-flight/cached OLD HTML (a lifecycle rule expires orphans later); and (2) the server Lambda (`ServerFn`) has an explicit **`.node.addDependency(deployAssets)`** so CloudFormation uploads the NEW chunks to S3 *before* flipping the Lambda that serves HTML referencing them — otherwise the new HTML 404s on `/_next/static/*` for the duration of the upload. The BucketDeployments deliberately carry **no** `distribution`/`distributionPaths` (that built-in invalidation would depend on the distribution → serverFn and force the wrong order / a cycle); invalidation isn't needed for immutable hashed assets — invalidate a changed non-hashed `public/` path manually if that ever comes up.

Cognito is the identity store. The server function has IAM permission for an explicit list of `cognito-idp` actions on the user pool and `ses:SendEmail` for the `paddlesnitch.com` identity. The S3 data bucket holds *only* course/trial/entry data — no user records, no sessions.

## Deploy sequence

**Normal path — just push:**
```bash
git push origin main   # triggers GitHub Actions: test → build → cdk deploy
```

The deploy job guards itself twice. After the build it **refuses an incomplete server bundle**: if OpenNext's arm64 `npm install` logged "Could not install dependencies", or `@swc/helpers`, `styled-jsx` or `@next/env` is missing from the top of the bundle's `node_modules` (2026-10-21: that shipped and every request 502'd). After the deploy its smoke test asks for `/`, `/att`, `/guide`, `/api/trpc/me` and **one planner route** (Devizes → Westminster): that proves the published river dataset loads in production and loads it on the warm instance, so the first paddler after a deploy doesn't wait ~9 s for it.

**Manual deploy** (use if CI is broken or you need to deploy from your machine):
```bash
pnpm build:open-next                  # production bundle (includes OpenNext v4)
cd infra
npx cdk deploy --profile paddlesnitch --require-approval never
```

SSO session expires after ~8 h. If CDK says "Unable to resolve AWS account", run:
```bash
aws sso login --profile paddlesnitch
```

## Strava secrets in SSM

The env var names are in `apps/web/CLAUDE.md` § Strava integration.

Both SSM parameters are set once with the AWS CLI:
```bash
aws ssm put-parameter --name /att/strava-client-id --type String --value '<id>' --overwrite --profile paddlesnitch --region eu-west-1

# IMPORTANT: write the secret to a tempfile with `printf '%s'` so there is
# NO trailing newline. `grep ... > file` or `echo ... > file` both append
# a \n, which AWS CLI stores verbatim via `file://`. The Lambda then ships
# a 41-char "secret" to Strava and gets back 401 Application/""/invalid.
# Bash $(...) strips trailing newlines on read, so length checks via
# ${#VAL} will lie. Verify with `wc -c < file`.
SECRET_FILE=$(mktemp)
printf '%s' '<the 40-char hex secret>' > "$SECRET_FILE"
aws ssm put-parameter --name /att/strava-client-secret --type SecureString --value "file://$SECRET_FILE" --overwrite --profile paddlesnitch --region eu-west-1
rm "$SECRET_FILE"
```

The Lambda IAM role has `ssm:GetParameter` on the parameter ARNs **and** `kms:Decrypt` on `alias/aws/ssm` (scoped via `kms:ViaService = ssm.<region>.amazonaws.com`). Without the KMS grant, SSM **silently returns the encrypted ciphertext blob** (`AQICAH...`, ~240 chars) instead of failing — which the runtime would then forward to Strava as the "secret".

## Sign in with Google (#697)

Cognito's hosted sign-in does the Google part; the app only sends people there and swaps the code (`apps/web/CLAUDE.md` § Sign-in flows). In `att-stack.ts`:

- **Hosted domain** `paddlesnitch` → `https://paddlesnitch.auth.eu-west-1.amazoncognito.com` (Cognito's own, no certificate). The server gets it as `COGNITO_DOMAIN`.
- **Google provider** (`GoogleIdp`): scopes `openid email profile`; maps `email`, `email_verified`, `name`.
- **App client:** only the authorization-code flow (with PKCE), callback `https://paddlesnitch.com/att/api/auth/google/callback`, providers COGNITO + GOOGLE. Until #697 CDK's defaults were live (implicit flow, callback `https://example.com`).
- **PreSignUp trigger** (`infra/lambdas/cognito-auth/pre-sign-up.mjs`, `att-cognito-pre-sign-up`): **one account per email**. Our sign-ins find people by email, so it refuses any new account (Google, email sign-up, Strava's AdminCreateUser) whose email a confirmed account already has (`ACCOUNT_EXISTS`; owner: Google is linked only from Account), and a Google account without a Google-verified email (`NO_EMAIL`, `EMAIL_UNVERIFIED`). UNCONFIRMED accounts block nobody. Its ListUsers grant is a separate `iam.Policy` on this pool only (the account is shared; the function's own policy would make a dependency cycle).

**Before the first deploy with it, both must exist** (CloudFormation reads them at deploy time and fails without them):

```bash
# Client ID: public, an SSM String.
aws ssm put-parameter --name /att/google-client-id --type String --value '<id>.apps.googleusercontent.com' --profile paddlesnitch --region eu-west-1
# Client secret: Secrets Manager, NOT SSM. CloudFormation can't read an SSM SecureString into a
# Cognito identity provider (ssm-secure works only for a short list of resources), and this
# way it never appears in the template. Same no-trailing-newline rule as Strava's secret.
SECRET_FILE=$(mktemp); printf '%s' '<secret from Google>' > "$SECRET_FILE"
aws secretsmanager create-secret --name paddlesnitch/google-client-secret --secret-string "file://$SECRET_FILE" --profile paddlesnitch --region eu-west-1
rm "$SECRET_FILE"
```

Google Cloud (project `paddlesnitch`, set up 2026-10-25; Google Auth Platform):
- **Branding:** app name paddlesnitch; home, `/privacy` and `/terms` links; authorized domains `paddlesnitch.com` and the Cognito domain. No logo (a logo needs Google's review).
- **Audience:** External, in **Testing**. Only listed test users (the owner's handful, managed in the console) can sign in until it is published, and publishing is the owner's call.
- **Client** "paddlesnitch Cognito" (Web): redirect URI `https://paddlesnitch.auth.eu-west-1.amazoncognito.com/oauth2/idpresponse`, JavaScript origin the Cognito domain. Its ID is in SSM and its secret in Secrets Manager (above). Google shows a secret only once: to rotate it, make a new one in the console and `aws secretsmanager put-secret-value` it, never in chat or the repo.

**The button is off until the `GOOGLE_SIGNIN` repository variable is `1`** (`deploy.yml` passes it as `NEXT_PUBLIC_GOOGLE_SIGNIN`): `gh variable set GOOGLE_SIGNIN --body 1`. Check what's live: `aws cognito-idp list-identity-providers --user-pool-id eu-west-1_BHyKJ0toh` and `describe-user-pool-client`.

## Inbound email — privacy@paddlesnitch.com

Mail to `privacy@paddlesnitch.com` lands via SES receipt rule and gets forwarded to the human inbox by the `att-email-forwarder` Lambda.

### Pipeline

1. **MX record** on `paddlesnitch.com` → `inbound-smtp.eu-west-1.amazonaws.com` (priority 10).
2. **SES receipt rule** `PrivacyAlias` in rule set `paddlesnitch-inbound`. Recipients: `privacy@paddlesnitch.com`. Actions in order:
   - **S3** — stores raw MIME at `s3://paddlesnitch-data-prod/inbound-email/privacy/{messageId}` for audit. Spam + virus scan headers are added by SES (`scanEnabled: true`).
   - **Lambda** — invokes `att-email-forwarder` (event-style, fire-and-forget).
3. **Lambda forwarder** (`infra/lambdas/email-forwarder/index.mjs`) reads the raw MIME, parses headers, builds a fresh MIME with `From: noreply@paddlesnitch.com` + `Reply-To: <original sender>`, and `SendRawEmail`s it to `FORWARD_TO` (currently `baldur.gudbjornsson@gmail.com`).
4. **`dmarc@paddlesnitch.com`** (rule `DmarcReports`) — DMARC aggregate reports (the `rua=` address) are stored at `inbound-email/dmarc/` in S3 only, never forwarded.

**Outbound delivery problems:** the SES account-level suppression list (BOUNCE + COMPLAINT, console setting) stops repeat sends to bad addresses. Every bounce, complaint and reject on the default configuration set `my-first-configuration-set` (made by hand, referenced by name in CDK) is published to the `paddlesnitch-alerts` SNS topic, and bounce-rate (>5%) and complaint-rate (>0.1%) alarms sit next to the other alerts. Test: `src/tests/ses-delivery-alerts.test.ts`.

### One-time activation

SES allows ONE active receipt rule set per region. After the first deploy that creates the rule set, run **once**:

```bash
aws ses set-active-receipt-rule-set --rule-set-name paddlesnitch-inbound --region eu-west-1 --profile paddlesnitch
```

CDK does NOT automate this — an AwsCustomResource that flips the active set would risk clobbering a manually-set production rule set during routine deploys.

### Adding a new alias

1. Add a new `addRule` call to the `InboundRules` rule set in `infra/lib/att-stack.ts` with a different recipient address and (optionally) a different S3 prefix.
2. If the forwarder should handle the new alias the same way, no Lambda change needed — the existing forwarder treats every record uniformly.
3. If the new alias should go to a different person, either parameterise `FORWARD_TO` per-alias (read from S3 prefix or rule name) or deploy a second Lambda.

### Tests

- `src/tests/email-forwarder.test.ts` — pure-helper coverage for the MIME parser + builder (header unfolding, case-insensitive headers, From/Reply-To fallback, subject prefix). The SES + S3 round trip is manual smoke after deploy.

## Cost Model (Production, Low Scale)

< 1000 entries/month:
- S3 storage + requests: < $1/month
- CloudFront: free tier / cents
- Lambda: free tier covers ~1M invocations
- Cognito: free up to 50,000 MAU

**Cost attribution — the `project=paddlesnitch` tag.** The AWS account is shared with unrelated projects, so paddlesnitch spend is isolated by tag, not by account. `infra/bin/att.ts` applies `cdk.Tags.of(app).add('project', 'paddlesnitch')` at the app root, which reaches every taggable resource in the stack (Lambdas, buckets, CloudFront, Cognito pool, IAM roles, dashboards). Tag changes are in-place updates (including the Cognito pool's `UserPoolTags` — no replacement). Not covered by CDK, tagged once by hand: Lambda-created log groups (`/aws/lambda/AttStack-*`, `/aws/lambda/att-*`) and the imported `paddlesnitch.com` hosted zone. `project` must be **activated** once as a cost allocation tag (Billing → Cost allocation tags) before Cost Explorer can group by it. Tag-blind charges: SES sending, on-demand Bedrock invocations (would need an application inference profile), tax, and the shared CDK bootstrap bucket.

Migration path to add a database: replace S3 JSON reads with DynamoDB; processing Lambda writes to both S3 (raw) and DynamoDB (indexed). Leaderboard becomes a DynamoDB query instead of reading `leaderboard.json`.
