// Saved, named sections (#435): a stretch a paddler comes back to ("Bridge to
// the lock"), with every pass through it, yours and your buddies'.
//
// Modelled on a time-trial gate course (owner's decision): two gates, each a
// line with the direction it must be crossed in (`rxsSign`, the same
// convention as CourseMetadata.gates), so a section is timed with the same
// line-crossing code and could become a course later. It belongs to one
// paddler (private; it never shows to anyone else) and keeps its own gates, so
// it stays valid when the paddle it was picked on is deleted.
import { nanoid } from 'nanoid'
import type { Line } from '@paddlesnitch/timing/types'
import { getJson, putJson, listKeys, deleteObject } from '@paddlesnitch/core/storage'
import type { Section } from './section-passes'

export type SavedSection = {
  id: string
  name: string
  gates: [{ line: Line; direction: 1 | -1 }, { line: Line; direction: 1 | -1 }]
  distanceMetres: number
  path: [number, number][]   // the line it was picked on, start to finish
  createdAt: string
}

export const MAX_SECTIONS = 200
export const MAX_NAME = 60

const key = (userId: string, id: string) => `users/${userId}/sections/${id}.json`
const sign = (s: number | undefined): 1 | -1 => (s === -1 ? -1 : 1)

export async function saveSection(userId: string, name: string, sec: Section): Promise<SavedSection | 'too_many'> {
  if ((await listKeys(`users/${userId}/sections/`)).length >= MAX_SECTIONS) return 'too_many'
  const saved: SavedSection = {
    id: nanoid(10),
    name: name.trim().slice(0, MAX_NAME),
    gates: [{ line: sec.startLine, direction: sign(sec.startSign) }, { line: sec.finishLine, direction: sign(sec.finishSign) }],
    distanceMetres: Math.round(sec.sectionM),
    path: sec.path,
    createdAt: new Date().toISOString(),
  }
  await putJson(key(userId, saved.id), saved)
  return saved
}

export async function getSavedSection(userId: string, id: string): Promise<SavedSection | null> {
  if (!/^[\w-]{1,64}$/.test(id)) return null
  return getJson<SavedSection>(key(userId, id))
}

export async function listSavedSections(userId: string): Promise<SavedSection[]> {
  const keys = await listKeys(`users/${userId}/sections/`)
  const all = await Promise.all(keys.map(k => getJson<SavedSection>(k)))
  return all.filter((s): s is SavedSection => !!s).sort((a, b) => a.name.localeCompare(b.name))
}

export async function renameSavedSection(userId: string, id: string, name: string): Promise<SavedSection | null> {
  const s = await getSavedSection(userId, id)
  if (!s) return null
  const next = { ...s, name: name.trim().slice(0, MAX_NAME) }
  await putJson(key(userId, id), next)
  return next
}

export async function deleteSavedSection(userId: string, id: string): Promise<boolean> {
  if (!(await getSavedSection(userId, id))) return false
  await deleteObject(key(userId, id))
  return true
}

/** A saved section as section-passes works with it. */
export function asSection(s: SavedSection): Section {
  return {
    startLine: s.gates[0].line, finishLine: s.gates[1].line,
    startSign: s.gates[0].direction, finishSign: s.gates[1].direction,
    sectionM: s.distanceMetres, path: s.path,
  }
}
