import { expect, it } from 'vitest'
import { editMentions, messageParts } from '../src/message-content'

it.each([
  ['@Alice hi', [{ id: 1, username: 'Alice', start: 0, end: 6 }]],
  ['😀 @Alice hi', [{ id: 1, username: 'Alice', start: 3, end: 9 }]],
  ['@Bob @Alice hi', [{ id: 1, username: 'Alice', start: 5, end: 11 }]],
  ['@Alicia hi', []],
  ['hi', []],
] as const)('preserves only untouched mentions when editing to %s', (content, expected) => {
  expect(editMentions([{ id: 1, username: 'Alice', start: 0, end: 6 }], '@Alice hi', content)).toEqual(expected)
})

it('ignores overlapping or invalid mention ranges without dropping message text', () => {
  expect(messageParts({ type: 'group', content: '@Alice <b>hello</b>', mentions: [
    { id: 1, username: 'Alice', start: 0, end: 6 },
    { id: 2, username: 'Alice', start: 0, end: 6 },
    { id: 3, username: 'hello', start: 9, end: 99 },
    { id: 4, username: 'Alice', start: -1, end: 5 },
  ] })).toEqual([{ text: '@Alice', mention: { id: 1, username: 'Alice', start: 0, end: 6 } }, { text: ' <b>hello</b>' }])
})
