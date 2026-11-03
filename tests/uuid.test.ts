import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUuid } from '../src/uuid'

afterEach(() => vi.unstubAllGlobals())

describe('createUuid', () => {
  it('creates distinct UUIDs when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto), randomUUID: undefined })
    const first = createUuid()
    const second = createUuid()
    expect({ valid: [first, second].every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)), distinct: first !== second })
      .toEqual({ valid: true, distinct: true })
  })
})
