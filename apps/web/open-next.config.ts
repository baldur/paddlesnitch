import type { OpenNextConfig } from '@opennextjs/aws/types/open-next'

const config: OpenNextConfig = {
  default: {
    override: {
      // We don't use ISR/revalidation — disable the SQS/DynamoDB dependencies
      incrementalCache: 'dummy',
      tagCache: 'dummy',
      queue: 'dummy',
    },
    install: {
      // pnpm symlinks prevent OpenNext from copying transitive deps; force install them.
      // @aws-sdk/client-s3 brings in all @smithy/* deps automatically.
      packages: ['@aws-sdk/client-s3@3.1048.0', '@aws-sdk/client-ses@3.1056.0', '@next/env', '@swc/helpers', 'styled-jsx', 'postcss', 'caniuse-lite', 'baseline-browser-mapping'],
    },
  },
}

export default config
