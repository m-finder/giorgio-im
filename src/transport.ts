export interface ImTransportOptions {
  /** Require HTTPS/WSS for remote endpoints. Defaults to true. */
  requireTLS?: boolean
  /** Allow HTTP/WS on localhost, 127.0.0.1 and ::1 when the page uses HTTP. Defaults to true. */
  allowInsecureLocalhost?: boolean
}

/** Validate before sending credentials; encryption itself is provided by HTTPS/WSS. */
export function assertImTransport(url: string, kind: 'http' | 'socket', options: ImTransportOptions = {}): void {
  const endpoint = new URL(url, location.href)
  const protocols = kind === 'http' ? ['http:', 'https:'] : ['ws:', 'wss:']
  if (!protocols.includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error('Invalid IM transport URL: use HTTP(S)/WS(S) without embedded credentials')
  }
  const encrypted = endpoint.protocol === 'https:' || endpoint.protocol === 'wss:'
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
  if (!encrypted && (location.protocol === 'https:' || (options.requireTLS !== false && !(options.allowInsecureLocalhost !== false && loopback)))) {
    throw new Error('IM transport requires TLS: configure HTTPS/WSS endpoints')
  }
}
