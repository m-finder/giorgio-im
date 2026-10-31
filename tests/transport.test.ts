import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertImTransport } from '../src'

afterEach(() => vi.unstubAllGlobals())

describe('IM transport policy', () => {
  it.each(['http://im.example/api', 'ws://im.example/socket', 'http://192.168.1.10/api', 'ws://localhost.example/socket'])('rejects insecure remote transport: %s', url => {
    expect(() => assertImTransport(url, url.startsWith('ws') ? 'socket' : 'http')).toThrow(/TLS/)
  })

  it.each(['https://im.example/api', 'wss://im.example/socket', 'http://localhost/api', 'ws://127.0.0.1:9502', 'ws://[::1]:9502'])('accepts TLS or an explicit loopback hostname: %s', url => {
    expect(() => assertImTransport(url, url.startsWith('ws') ? 'socket' : 'http')).not.toThrow()
  })

  it('can require TLS for local development and explicitly permit insecure remote development', () => {
    expect(() => assertImTransport('/api/im', 'http', { allowInsecureLocalhost: false })).toThrow(/TLS/)
    expect(() => assertImTransport('http://im.example/api', 'http', { requireTLS: false })).not.toThrow()
  })

  it('rejects mixed content even when insecure transport was explicitly allowed', () => {
    vi.stubGlobal('location', new URL('https://im.example/'))
    expect(() => assertImTransport('ws://localhost:9502', 'socket', { requireTLS: false })).toThrow(/TLS/)
  })

  it.each(['ftp://im.example/file', 'https://user:secret@im.example/api', 'wss://user:secret@im.example/socket'])('rejects invalid protocols and embedded credentials: %s', url => {
    expect(() => assertImTransport(url, url.startsWith('ws') ? 'socket' : 'http')).toThrow()
  })
})
