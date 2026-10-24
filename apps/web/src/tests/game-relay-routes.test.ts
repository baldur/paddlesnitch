// The live-race relay's three WebSocket routes each need their own Lambda
// integration. CDK grants API Gateway permission to call the Lambda per
// integration, scoped to the first route it's bound to: one integration shared
// by all three let only $connect through, so players connected but no message
// or disconnect ever reached the relay (the first production test, 2026-10-24).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const stack = readFileSync(path.join(__dirname, '../../../../infra/lib/att-stack.ts'), 'utf8')
const relay = stack.slice(stack.indexOf("new apigwv2.WebSocketApi(this, 'GameRelayApi'"), stack.indexOf("new apigwv2.WebSocketStage(this, 'GameRelayStage'"))

describe('the game relay API', () => {
  it('gives each route its own Lambda integration, so API Gateway may call it for all three', () => {
    for (const route of ['connectRouteOptions', 'disconnectRouteOptions', 'defaultRouteOptions']) {
      expect(relay).toMatch(new RegExp(`${route}: \\{ integration: new WebSocketLambdaIntegration\\(`))
    }
  })
})
