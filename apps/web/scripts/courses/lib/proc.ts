// Running ffmpeg/ffprobe in their own process group, so a Ctrl+C in the terminal
// reaches only course:look, which then decides what to stop. (execFile ignores
// `detached`; spawn honours it.) Tested in proc.test.ts.
import { spawn, type ChildProcess } from 'child_process'

const running = new Set<ChildProcess>()

/** Run a command and collect its stdout; rejects with its stderr if it fails. */
export function runDetached(cmd: string, args: string[], maxBuffer = 1 << 30): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    running.add(child)
    const out: Buffer[] = []
    let size = 0
    let err = ''
    child.stdout!.on('data', (b: Buffer) => {
      size += b.length
      if (size > maxBuffer) { child.kill('SIGKILL'); return }
      out.push(b)
    })
    child.stderr!.on('data', (b: Buffer) => { err += b.toString() })
    child.on('error', (e) => { running.delete(child); reject(e) })
    child.on('close', (code, signal) => {
      running.delete(child)
      if (code === 0) resolve(Buffer.concat(out))
      else reject(new Error(`${cmd} ${signal ? `killed by ${signal}` : `exited ${code}`}: ${err.trim().split('\n')[0] ?? ''}`))
    })
  })
}

/** On a hard stop: kill every running child's whole group. */
export function killRunning() {
  for (const c of running) { try { if (c.pid) process.kill(-c.pid, 'SIGKILL') } catch { /* gone */ } }
  running.clear()
}
