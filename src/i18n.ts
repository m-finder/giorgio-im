import { computed, ref, watch } from 'vue'
import { en, zhCN, type ImLocaleKey, type ImLocaleMessages, type ImLocaleParams, type ImLocales } from './locales'

/** Keep internal errors translatable without changing errors returned by the host. */
export class LocaleError extends Error {
  constructor(readonly key: ImLocaleKey) { super(key) }
}

export function useImLocale(options: { locale?: string; locales?: ImLocales }) {
  const selectedLocale = ref<string>()
  const customMessages = ref<ImLocales>({})
  const locale = computed(() => selectedLocale.value ?? options.locale ?? 'zh-CN')
  const messages = computed<ImLocaleMessages>(() => {
    const result = { ...(/^en(?:-|$)/i.test(locale.value) ? en : zhCN) }
    for (const source of [options.locales?.[locale.value], customMessages.value[locale.value]]) {
      if (!source) continue
      for (const key of Object.keys(zhCN) as ImLocaleKey[]) {
        const value = source[key]
        if (typeof value === 'string') result[key] = value
      }
    }
    return result
  })
  const timeFormatter = computed(() => {
    try {
      return new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit' })
    } catch {
      return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }
  })

  watch(() => options.locale, () => { selectedLocale.value = undefined })

  function t(key: ImLocaleKey, params: ImLocaleParams = {}): string {
    return messages.value[key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
      Object.hasOwn(params, name) ? String(params[name]) : placeholder)
  }

  function setLocale(name: string, overrides?: Partial<ImLocaleMessages>): void {
    if (overrides) customMessages.value[name] = { ...customMessages.value[name], ...overrides }
    selectedLocale.value = name
  }

  function errorText(error: string | Error): string {
    return error instanceof LocaleError ? t(error.key) : error instanceof Error ? error.message : error
  }

  return { locale, t, setLocale, errorText, timeFormatter }
}
