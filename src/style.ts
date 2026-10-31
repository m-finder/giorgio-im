import css from './style.css?inline'

export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  const existing = document.getElementById('giorgio-im-style')
  if (existing) {
    existing.textContent = css
    return
  }
  const style = document.createElement('style')
  style.id = 'giorgio-im-style'
  style.textContent = css
  document.head.appendChild(style)
}

if (import.meta.hot) {
  import.meta.hot.accept('./style.css?inline', (module) => {
    const style = document.getElementById('giorgio-im-style')
    if (style && module) style.textContent = module.default
  })
}
