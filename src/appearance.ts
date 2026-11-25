import mountains from './assets/backgrounds/mountains.svg'
import forest from './assets/backgrounds/forest.svg'
import sunset from './assets/backgrounds/sunset.svg'
import night from './assets/backgrounds/night.svg'
import { LocaleError } from './i18n'
import type { ImSkin } from './types'
import type { ImLocaleKey } from './locales'

export const skins: { id: ImSkin; color: string; label: ImLocaleKey }[] = [
  { id: 'blue', color: '#426dff', label: 'skinBlue' },
  { id: 'green', color: '#008577', label: 'skinGreen' },
  { id: 'purple', color: '#7952b3', label: 'skinPurple' },
  { id: 'rose', color: '#b43e6e', label: 'skinRose' },
  { id: 'orange', color: '#ac5b0a', label: 'skinOrange' },
  { id: 'slate', color: '#46576b', label: 'skinSlate' },
]

export const backgrounds: { id: string; image: string; label: ImLocaleKey }[] = [
  { id: 'none', image: '', label: 'backgroundNone' },
  { id: 'mountains', image: mountains, label: 'backgroundMountains' },
  { id: 'forest', image: forest, label: 'backgroundForest' },
  { id: 'sunset', image: sunset, label: 'backgroundSunset' },
  { id: 'night', image: night, label: 'backgroundNight' },
]

export function isSkin(value: unknown): value is ImSkin { return skins.some(skin => skin.id === value) }

export function resolveBackground(value: unknown): string {
  if (typeof value !== 'string' || !value || value === 'none') return ''
  const preset = backgrounds.find(background => background.id === value)
  if (preset) return preset.image
  if (/^data:image\/(png|jpeg|gif|webp|avif);base64,[a-z0-9+/]+={0,2}$/i.test(value)) return value
  if (!/^(https?:|\/|\.\.?\/)/i.test(value)) return ''
  try { return ['https:', 'http:'].includes(new URL(value, location.href).protocol) ? value : '' }
  catch { return '' }
}

export async function readBackground(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|gif|webp|avif)$/i.test(file.type)) throw new LocaleError('backgroundTypeInvalid')
  if (file.size > 2 * 1024 * 1024) throw new LocaleError('backgroundTooLarge')
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' && resolveBackground(reader.result)
      ? resolve(reader.result) : reject(new LocaleError('backgroundReadFailed'))
    reader.onerror = reader.onabort = () => reject(new LocaleError('backgroundReadFailed'))
    reader.readAsDataURL(file)
  })
}
