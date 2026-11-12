import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { runDetached } from './proc'

describe('runDetached', () => {
  it('runs the child in its own process group, so the terminal Ctrl+C does not reach it', async () => {
    const mine = execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)]).toString().trim()
    const theirs = (await runDetached('sh', ['-c', 'ps -o pgid= -p $$'])).toString().trim()
    expect(theirs).not.toBe(mine)
  })
  it('returns stdout and rejects with the first line of stderr on failure', async () => {
    expect((await runDetached('sh', ['-c', 'printf hello'])).toString()).toBe('hello')
    await expect(runDetached('sh', ['-c', 'echo "no moov atom" >&2; exit 1'])).rejects.toThrow(/exited 1: no moov atom/)
  })
})
