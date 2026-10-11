// A stand-in tracker key for tests. Real trackers make their own key and are
// enrolled at cable-flash time (firmware/tools/enroll.sh); tests enrol this one.
import { generateKeyPairSync, sign } from 'crypto'
import { enrolDeviceKey, claimProofMessage, linkProofMessage } from '@/lib/devices'

const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
export const TEST_DEVICE_PUBKEY = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')

const signWith = (msg: string, key = pair.privateKey) => sign('sha256', Buffer.from(msg), key).toString('base64')

export async function enrolTestDevice(deviceId: string): Promise<void> {
  await enrolDeviceKey(deviceId, TEST_DEVICE_PUBKEY, 'cable')
}

/** What a tracker sends when it polls for its token: enrols the test key for
 *  this device, then signs the claim secret with it. */
export async function provedPoll(deviceId: string, claimSecret: string) {
  await enrolTestDevice(deviceId)
  return { deviceId, claimSecret, proof: signWith(claimProofMessage(deviceId, claimSecret)) }
}

/** The proof alone, for calling redeemToken directly. */
export async function claimProof(deviceId: string, claimSecret: string): Promise<string> {
  return (await provedPoll(deviceId, claimSecret)).proof
}

/** The tracker's signature over a Bluetooth link (deviceId + its token hash). */
export async function linkProof(deviceId: string, tokenHash: string): Promise<string> {
  await enrolTestDevice(deviceId)
  return signWith(linkProofMessage(deviceId, tokenHash))
}

/** A signature by some OTHER key -- what someone who knows only the ID can make. */
export function strangerProof(message: string): string {
  return signWith(message, generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey)
}
