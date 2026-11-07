import type { ImAttachment, ImMention, ImMessage, ImMessageReference } from './types'

/** Preserve the original images alongside a quoted caption. */
export function quoteImages(reference: Pick<ImMessageReference, 'attachment' | 'attachments'>): ImAttachment[] {
  return (reference.attachments?.length ? reference.attachments : reference.attachment ? [reference.attachment] : []).filter(attachment => attachment.kind === 'image')
}

/** Image URLs and filenames are placeholders, not captions. */
export function quoteText(reference: Pick<ImMessageReference, 'content' | 'attachment' | 'attachments'>): string {
  const images = quoteImages(reference)
  return images.some(image => reference.content === image.url || reference.content === image.name)
    || (images.length > 0 && reference.content === images.map(image => image.name).join(', ')) ? '' : reference.content
}

/** Keep selected mentions attached to untouched text as the draft changes. */
export function editMentions(mentions: ImMention[], previous: string, content: string): ImMention[] {
  let start = 0
  while (start < previous.length && start < content.length && previous[start] === content[start]) start++
  let oldEnd = previous.length
  let newEnd = content.length
  while (oldEnd > 0 && newEnd > 0 && previous[oldEnd - 1] === content[newEnd - 1]) { oldEnd--; newEnd-- }
  return mentions.flatMap(mention => {
    if (mention.end <= start) return [mention]
    if (mention.start >= oldEnd) return [{ ...mention, start: mention.start + newEnd - oldEnd, end: mention.end + newEnd - oldEnd }]
    return []
  }).filter(mention => content.slice(mention.start, mention.end) === `@${mention.username}`)
}

/** Render validated mention spans as text, without interpreting message HTML. */
export function messageParts(message: Pick<ImMessage, 'content' | 'mentions' | 'type'>): { text: string; mention?: ImMention }[] {
  const parts: { text: string; mention?: ImMention }[] = []
  let cursor = 0
  for (const mention of message.type === 'group' ? [...(message.mentions || [])].sort((a, b) => a.start - b.start) : []) {
    if (!Number.isInteger(mention.start) || !Number.isInteger(mention.end) || mention.start < cursor || mention.end > message.content.length
      || mention.end <= mention.start || message.content.slice(mention.start, mention.end) !== `@${mention.username}`) continue
    if (mention.start > cursor) parts.push({ text: message.content.slice(cursor, mention.start) })
    parts.push({ text: message.content.slice(mention.start, mention.end), mention })
    cursor = mention.end
  }
  if (cursor < message.content.length) parts.push({ text: message.content.slice(cursor) })
  return parts
}
