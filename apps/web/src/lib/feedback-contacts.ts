import { getJson, putJson, listKeys, deleteObject } from './storage'

// Who filed an issue report, kept OUT of the GitHub issue. The repo is public,
// so the issue carries only the report and a note that a contact exists; the
// maintainer looks the reporter up here by issue number to follow up.
//
// Personal data, so account erasure deletes a user's records and export
// includes them. An anonymous reporter who typed an email has no account to
// delete; they can ask by email.
export type FeedbackContact = {
  issueNumber: number
  userId?: string
  displayName?: string
  email?: string
  page?: string          // the full page URL, query string included
  reportedAt: string
}

const PREFIX = 'feedback-contacts/'
const keyFor = (issueNumber: number) => `${PREFIX}${issueNumber}.json`

export async function putFeedbackContact(c: FeedbackContact): Promise<void> {
  await putJson(keyFor(c.issueNumber), c)
}

async function forUser(userId: string): Promise<{ key: string; contact: FeedbackContact }[]> {
  const out: { key: string; contact: FeedbackContact }[] = []
  for (const key of await listKeys(PREFIX)) {
    const contact = await getJson<FeedbackContact>(key)
    if (contact?.userId === userId) out.push({ key, contact })
  }
  return out
}

export async function listFeedbackContactsForUser(userId: string): Promise<FeedbackContact[]> {
  return (await forUser(userId)).map(r => r.contact)
}

export async function eraseFeedbackContactsForUser(userId: string): Promise<void> {
  for (const { key } of await forUser(userId)) await deleteObject(key)
}
