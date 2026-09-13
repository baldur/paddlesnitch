import { startCognito, stopCognito, type TestPoolHandle } from './cognito-test-server'

const TEST_PORT = 9230

// Vitest globalSetup: spawn cognito-local once for the whole run, create a pool,
// and expose the IDs to the test environment via env vars.
export default async function setup() {
  const handle = await startCognito(TEST_PORT)

  process.env.COGNITO_ENDPOINT = handle.endpoint
  process.env.COGNITO_USER_POOL_ID = handle.userPoolId
  process.env.COGNITO_CLIENT_ID = handle.clientId
  process.env.COGNITO_REGION = 'eu-west-1'
  // Expose the cognito-local db dir so individual tests can poke at it
  // (e.g. read the password-reset confirmation code).
  process.env.COGNITO_LOCAL_DB_DIR = handle.dataDir

  // Hand the handle to teardown via a module-scoped reference.
  ;(globalThis as unknown as { __cognitoHandle: TestPoolHandle }).__cognitoHandle = handle

  return async () => {
    await stopCognito(handle)
  }
}
