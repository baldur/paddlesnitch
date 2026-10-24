// The live-race relay's Lambda: API Gateway's WebSocket routes ($connect,
// $disconnect, $default) all come here. The work is in relay.mjs; this only
// wires it to S3 and to API Gateway's "send to a connection" call. The AWS
// SDK comes with the Lambda runtime, so there's nothing to bundle.
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi'
import { createRelay } from './relay.mjs'

const Bucket = process.env.DATA_BUCKET
const s3 = new S3Client({})
let api = null // made on the first event, which names the API's address

const store = {
  async get(Key) {
    try {
      const res = await s3.send(new GetObjectCommand({ Bucket, Key }))
      return JSON.parse(await res.Body.transformToString())
    } catch (err) {
      if (err.name === 'NoSuchKey') return null
      throw err
    }
  },
  put: (Key, value) => s3.send(new PutObjectCommand({ Bucket, Key, Body: JSON.stringify(value), ContentType: 'application/json' })),
  del: (Key) => s3.send(new DeleteObjectCommand({ Bucket, Key })),
  async list(Prefix) {
    const res = await s3.send(new ListObjectsV2Command({ Bucket, Prefix }))
    return (res.Contents ?? []).map((o) => o.Key)
  },
}

async function post(ConnectionId, text) {
  try {
    await api.send(new PostToConnectionCommand({ ConnectionId, Data: text }))
  } catch (err) {
    if (err.name === 'GoneException' || err.$metadata?.httpStatusCode === 410) err.gone = true
    throw err
  }
}

const relay = createRelay({ store, post })

export const handler = async (event) => {
  const { domainName, stage } = event.requestContext
  api ??= new ApiGatewayManagementApiClient({ endpoint: `https://${domainName}/${stage}` })
  try {
    return { statusCode: await relay.handle(event) }
  } catch (err) {
    console.error('[game-relay]', event.requestContext.routeKey, err)
    return { statusCode: 500 }
  }
}
