import { afterEach, expect, it, vi } from 'vitest'
import { createGroupCall } from '../src/group-call'

const calls: ReturnType<typeof createGroupCall>[] = []
afterEach(() => {
  calls.splice(0).forEach(call => call.destroy())
  vi.unstubAllGlobals()
})

it.each(['creator', 'member', 'invitee'] as const)('sends the correct hangup signal for a %s', async role => {
  const stop = vi.fn()
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } })
  vi.stubGlobal('RTCPeerConnection', class {})
  const sendSignal = vi.fn()
  const call = createGroupCall(() => ({ sendSignal }), () => 1, () => {})
  calls.push(call)
  if (role === 'creator') call.start({ id: 10, groupname: 'Team' })
  else {
    call.receive({ id: 2, groupId: 10, callId: 'room', action: 'invite', expiresAt: Date.now() + 60000, participants: [] })
    if (role === 'member') call.accept()
  }
  if (role !== 'invitee') await vi.waitFor(() => expect(sendSignal).toHaveBeenCalledWith(expect.objectContaining({ action: role === 'creator' ? 'invite' : 'join' })))
  call.hangup()
  await vi.waitFor(() => expect(sendSignal).toHaveBeenLastCalledWith(expect.objectContaining({ groupId: 10, action: role === 'creator' ? 'end' : role === 'member' ? 'leave' : 'reject' })))
  expect(stop).toHaveBeenCalledTimes(role === 'invitee' ? 0 : 1)
})
