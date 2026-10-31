import { onUnmounted, ref, shallowRef } from 'vue'
import { LocaleError } from './i18n'

/** Record a short voice clip locally. Uploading and sending require explicit user action. */
export function useVoiceRecorder() {
  const state = ref<'idle' | 'requesting' | 'recording' | 'preview'>('idle')
  const duration = ref(0)
  const preview = ref('')
  const file = shallowRef<File | null>(null)
  const error = ref<LocaleError | ''>('')
  const maxSeconds = 60
  let generation = 0
  let recorder: MediaRecorder | undefined
  let stream: MediaStream | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let startedAt = 0

  function release(): void {
    clearInterval(timer)
    timer = undefined
    if (recorder) {
      recorder.ondataavailable = recorder.onstop = recorder.onerror = null
      if (recorder.state !== 'inactive') recorder.stop()
      recorder = undefined
    }
    stream?.getTracks().forEach(track => { track.onended = null; track.stop() })
    stream = undefined
  }

  function cancel(): void {
    generation++
    release()
    if (preview.value) URL.revokeObjectURL(preview.value)
    preview.value = ''
    file.value = null
    duration.value = 0
    error.value = ''
    state.value = 'idle'
  }

  function stop(): void {
    if (state.value !== 'recording' || !recorder || recorder.state === 'inactive') return
    clearInterval(timer)
    duration.value = Math.max(1, Math.min(maxSeconds, Math.ceil((Date.now() - startedAt) / 1000)))
    recorder.stop()
    stream?.getTracks().forEach(track => { track.onended = null; track.stop() })
  }

  async function start(): Promise<void> {
    if (state.value !== 'idle') return
    cancel()
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      error.value = new LocaleError('recordingUnsupported')
      return
    }
    const request = generation
    state.value = 'requesting'
    try {
      const granted = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (request !== generation) { granted.getTracks().forEach(track => track.stop()); return }
      stream = granted
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']
        .find(type => MediaRecorder.isTypeSupported?.(type))
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      const chunks: Blob[] = []
      recorder.ondataavailable = event => { if (request === generation && event.data.size) chunks.push(event.data) }
      recorder.onstop = () => {
        if (request !== generation) return
        duration.value = Math.max(1, Math.min(maxSeconds, Math.ceil((Date.now() - startedAt) / 1000)))
        const type = recorder?.mimeType || chunks[0]?.type || 'audio/webm'
        release()
        const blob = new Blob(chunks, { type })
        if (!blob.size) { cancel(); error.value = new LocaleError('recordingEmpty'); return }
        const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'
        file.value = new File([blob], `voice-${Date.now()}.${extension}`, { type })
        preview.value = URL.createObjectURL(blob)
        state.value = 'preview'
      }
      recorder.onerror = () => { cancel(); error.value = new LocaleError('recordingFailed') }
      stream.getTracks().forEach(track => { track.onended = stop })
      recorder.start()
      startedAt = Date.now()
      state.value = 'recording'
      timer = setInterval(() => {
        duration.value = Math.min(maxSeconds, Math.floor((Date.now() - startedAt) / 1000))
        if (duration.value >= maxSeconds) stop()
      }, 250)
    } catch (cause) {
      if (request !== generation) return
      cancel()
      error.value = cause instanceof Error && cause.name === 'NotAllowedError'
        ? new LocaleError('microphoneDenied')
        : new LocaleError('microphoneUnavailable')
    }
  }

  onUnmounted(cancel)
  return { state, duration, preview, file, error, start, stop, cancel }
}
