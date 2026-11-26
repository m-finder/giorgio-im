import type { ImContact } from './types'

export type CallSpeaker = Pick<ImContact, 'id' | 'username' | 'avatar' | 'groupname'>

type PeerContact = { peer: RTCPeerConnection; contact: ImContact }
type AudioStats = { id: string; type: string; kind?: string; mediaType?: string; audioLevel?: number; totalAudioEnergy?: number; totalSamplesDuration?: number }

export function createSpeakerMonitor(peers: () => PeerContact[], local: () => CallSpeaker | undefined, update: (speaker?: CallSpeaker) => void) {
  const minimumLevel = 0.025
  const sampleInterval = 250
  const silenceDelay = 800
  const switchRatio = 1.2
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  let speaker: CallSpeaker | undefined
  let lastSpeech = 0
  let previous = new WeakMap<RTCPeerConnection, Map<string, { energy: number; duration: number }>>()

  async function sample(request: number): Promise<void> {
    const levels = new Map<string, { contact: CallSpeaker; level: number }>()
    await Promise.all(peers().filter(({ peer }) => peer.connectionState === 'connected').map(async ({ peer, contact }) => {
      try {
        const report = await peer.getStats()
        if (request !== generation || !peers().some(item => item.peer === peer)) return
        let samples = previous.get(peer)
        if (!samples) { samples = new Map(); previous.set(peer, samples) }
        report.forEach((stat: AudioStats) => {
          if ((stat.kind ?? stat.mediaType) !== 'audio') return
          const participant = stat.type === 'inbound-rtp' ? contact : stat.type === 'media-source' ? local() : undefined
          if (!participant) return
          let level = stat.audioLevel ?? 0
          if (stat.totalAudioEnergy !== undefined && stat.totalSamplesDuration !== undefined) {
            const before = samples.get(stat.id)
            samples.set(stat.id, { energy: stat.totalAudioEnergy, duration: stat.totalSamplesDuration })
            if (before) {
              const duration = stat.totalSamplesDuration - before.duration
              level = duration > 0 ? Math.sqrt(Math.max(0, stat.totalAudioEnergy - before.energy) / duration) : 0
            }
          }
          const id = String(participant.id)
          if (Number.isFinite(level) && level > (levels.get(id)?.level ?? 0)) levels.set(id, { contact: participant, level })
        })
      } catch {}
    }))
    if (request !== generation) return
    let loudest = speaker ? levels.get(String(speaker.id)) : undefined
    for (const participant of levels.values()) {
      if (!loudest || participant.level > loudest.level * switchRatio) loudest = participant
    }
    let next = speaker
    if (loudest && loudest.level >= minimumLevel) {
      next = loudest.contact
      lastSpeech = Date.now()
    } else if (Date.now() - lastSpeech >= silenceDelay || (speaker && ![local(), ...peers().map(item => item.contact)].some(contact => contact && String(contact.id) === String(speaker?.id)))) {
      next = undefined
    }
    if (next?.id !== speaker?.id) { speaker = next; update(speaker) }
    if (request === generation) timer = setTimeout(() => { void sample(request) }, sampleInterval)
  }

  function stop(): void {
    generation++
    clearTimeout(timer)
    speaker = undefined
    lastSpeech = 0
    previous = new WeakMap()
  }

  return {
    start(): void { stop(); void sample(generation) },
    stop,
  }
}
