// Talking to the local Ollama. Frames show other people and their boats, so they
// only ever go to a model on this machine: the endpoint must be loopback (unless
// --allow-remote), and Ollama's cloud models, which it forwards to ollama.com,
// are refused. Tested in ollama.test.ts.

/** Ollama can't be reached or refused the request: stop the run, record nothing. */
export class OllamaDown extends Error {}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * The endpoint, from PADDLESNITCH_OLLAMA (not OLLAMA_HOST, which is often set
 * for other reasons, e.g. 0.0.0.0 to serve a LAN). Accepts "host:port" without a scheme.
 */
export function ollamaEndpoint(value: string | undefined, allowRemote: boolean): string {
  const v = value?.trim() || 'http://localhost:11434'
  const url = new URL(/^https?:\/\//.test(v) ? v : `http://${v}`)
  if (!LOOPBACK.has(url.hostname) && !allowRemote) throw new Error(`refusing to send frames to ${url.host}: only a model on this machine (localhost) is allowed; pass --allow-remote if that host is yours`)
  return url.origin
}

/** Ollama runs "*-cloud" / ":cloud" models on ollama.com: frames would leave the machine. */
export function assertLocalModel(model: string) {
  if (/cloud/i.test(model)) throw new Error(`refusing ${model}: Ollama runs cloud models on its servers, and frames must stay on this machine`)
}

/** The text of a streamed /api/chat reply. An error line in the stream means Ollama failed, not the model. */
export async function readReply(body: ReadableStream<Uint8Array>): Promise<string> {
  let text = ''
  let buf = ''
  const decoder = new TextDecoder()
  const take = (line: string) => {
    if (!line.trim()) return
    const j = JSON.parse(line) as { message?: { content?: string }; error?: string }
    if (j.error) throw new OllamaDown(`Ollama: ${j.error}`)
    text += j.message?.content ?? ''
  }
  const reader = body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) { take(buf.slice(0, nl)); buf = buf.slice(nl + 1) }
  }
  take(buf + decoder.decode())
  return text
}

/** Fail early, before any spot is touched, if Ollama isn't up or doesn't have the model. */
export async function checkOllama(endpoint: string, model: string, fetchFn = fetch) {
  let res: Response
  try { res = await fetchFn(`${endpoint}/api/tags`) } catch {
    throw new OllamaDown(`Ollama isn't running at ${endpoint} (start it with: ollama serve)`)
  }
  if (!res.ok) throw new OllamaDown(`Ollama at ${endpoint} answered ${res.status}`)
  const { models } = (await res.json()) as { models?: Array<{ name: string }> }
  const names = (models ?? []).map((m) => m.name)
  if (!names.includes(model) && !names.includes(`${model}:latest`)) throw new OllamaDown(`Ollama doesn't have ${model} (pull it with: ollama pull ${model})`)
  // A cloud model copied to a plain name (ollama cp) is still run remotely: its details name the remote.
  const show = await fetchFn(`${endpoint}/api/show`, { method: 'POST', body: JSON.stringify({ model }) }).catch(() => null)
  const details = show?.ok ? ((await show.json()) as Record<string, unknown>) : {}
  if (details.remote_host || details.remote_model) throw new Error(`refusing ${model}: it runs on ${String(details.remote_host ?? 'a remote host')}, and frames must stay on this machine`)
}

/**
 * A POST with no wait limit on the reply's headers. Node's fetch gives up when
 * they take over 5 minutes, which they do while Ollama finishes another
 * client's request first (the night shift shares the model): the look then
 * failed with "fetch failed" though nothing was wrong. The caller's signal
 * (10 minutes) still bounds the whole reply.
 */
export const patientFetch = (async (url: string, init: { method?: string; body?: string; signal?: AbortSignal } = {}) => {
  const { request } = await import('http')
  return new Promise<Response>((resolve, reject) => {
    const req = request(url, { method: init.method ?? 'GET', signal: init.signal, headers: { 'content-type': 'application/json' } }, (res) => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          res.on('data', (b: Buffer) => c.enqueue(new Uint8Array(b)))
          res.on('end', () => c.close())
          res.on('error', (e) => c.error(e))
        },
      })
      resolve(new Response(body, { status: res.statusCode ?? 500 }))
    })
    req.on('error', reject)
    req.end(init.body)
  })
}) as unknown as typeof fetch

/** One streamed chat with an image. Anything other than a model reply throws OllamaDown.
 *  Thinking is off unless the caller asks: qwen3.8 thinks by default and a look then takes minutes, not seconds. */
export async function chat(endpoint: string, body: Record<string, unknown>, fetchFn: typeof fetch = patientFetch): Promise<string> {
  let res: Response
  try {
    res = await fetchFn(`${endpoint}/api/chat`, { method: 'POST', signal: AbortSignal.timeout(10 * 60_000), body: JSON.stringify({ think: false, ...body, stream: true }) })
  } catch (e) {
    throw new OllamaDown(`Ollama at ${endpoint}: ${(e as Error).message}`)
  }
  if (!res.ok || !res.body) throw new OllamaDown(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`)
  try { return await readReply(res.body) } catch (e) {
    if (e instanceof OllamaDown) throw e
    throw new OllamaDown(`Ollama's reply broke off: ${(e as Error).message}`)
  }
}
