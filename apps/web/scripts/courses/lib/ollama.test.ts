import { describe, it, expect } from 'vitest'
import { assertLocalModel, chat, checkOllama, ollamaEndpoint, OllamaDown, readReply } from './ollama'

const stream = (...chunks: string[]) => new ReadableStream<Uint8Array>({
  start(c) { for (const s of chunks) c.enqueue(new TextEncoder().encode(s)); c.close() },
})
const line = (content: string) => JSON.stringify({ message: { content } }) + '\n'

describe('ollamaEndpoint', () => {
  it('defaults to this machine', () => {
    expect(ollamaEndpoint(undefined, false)).toBe('http://localhost:11434')
  })
  it('accepts host:port without a scheme, as Ollama itself writes it', () => {
    expect(ollamaEndpoint('127.0.0.1:11500', false)).toBe('http://127.0.0.1:11500')
  })
  it('refuses another machine unless told it is ours', () => {
    expect(() => ollamaEndpoint('http://192.168.1.20:11434', false)).toThrow(/refusing to send frames/)
    expect(() => ollamaEndpoint('0.0.0.0:11434', false)).toThrow(/refusing/)
    expect(ollamaEndpoint('http://192.168.1.20:11434', true)).toBe('http://192.168.1.20:11434')
  })
})

describe('assertLocalModel', () => {
  it('refuses Ollama cloud models, which run on ollama.com', () => {
    expect(() => assertLocalModel('qwen3-vl:235b-cloud')).toThrow(/cloud/)
    expect(() => assertLocalModel('qwen2.5vl:32b')).not.toThrow()
  })
})

describe('readReply', () => {
  it('joins content split across chunks, and a last line without a newline', async () => {
    const all = line('{"sce') + line('ne":"x"}') + JSON.stringify({ message: { content: '' }, done: true })
    expect(await readReply(stream(all.slice(0, 7), all.slice(7, 40), all.slice(40)))).toBe('{"scene":"x"}')
  })
  it('treats an error line in the stream as Ollama failing', async () => {
    await expect(readReply(stream(line('{"a'), '{"error":"model runner has unexpectedly stopped"}\n'))).rejects.toBeInstanceOf(OllamaDown)
  })
})

describe('checkOllama and chat', () => {
  const refused = (async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch
  it('says plainly when Ollama is not running', async () => {
    await expect(checkOllama('http://localhost:11999', 'qwen2.5vl:32b', refused)).rejects.toThrow(/isn't running/)
  })
  it('says when the model is not pulled', async () => {
    const tags = (async () => new Response(JSON.stringify({ models: [{ name: 'llama3.3:70b' }] }))) as unknown as typeof fetch
    await expect(checkOllama('http://localhost:11434', 'qwen2.5vl:32b', tags)).rejects.toThrow(/ollama pull qwen2.5vl:32b/)
  })
  it('a refused connection or an HTTP error is OllamaDown, never a reply', async () => {
    await expect(chat('http://localhost:11999', {}, refused)).rejects.toBeInstanceOf(OllamaDown)
    const notFound = (async () => new Response('model not found', { status: 404 })) as unknown as typeof fetch
    await expect(chat('http://localhost:11434', {}, notFound)).rejects.toBeInstanceOf(OllamaDown)
  })
})
