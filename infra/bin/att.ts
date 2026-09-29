import * as cdk from 'aws-cdk-lib'
import { AttStack } from '../lib/att-stack'

const app = new cdk.App()

// Cost allocation. The AWS account is shared with unrelated projects, so this
// tag is what lets Cost Explorer show paddlesnitch on its own. Applied at the
// app root, it propagates to every taggable resource in every stack. It only
// shows up in billing once `project` is ACTIVATED as a cost allocation tag
// (Billing -> Cost allocation tags; one-time, and the key appears there up to
// 24 h after the first tagged resource is billed).
cdk.Tags.of(app).add('project', 'paddlesnitch')

new AttStack(app, 'AttStack', {
  // A `cdk destroy` or console delete would take the whole platform down.
  // The data bucket and user pool are RETAIN anyway; this guards the rest.
  terminationProtection: true,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'eu-west-1',
  },
})
