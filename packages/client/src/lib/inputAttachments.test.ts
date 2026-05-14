import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { extractClipboardFiles, filesToInputAttachments } from './inputAttachments'

class FakeFileReader {
  result: string | ArrayBuffer | null = null
  error: Error | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null

  readAsDataURL(file: File) {
    this.result = `data:${file.type || 'application/octet-stream'};base64,ZmFrZQ==`
    queueMicrotask(() => this.onload?.())
  }

  readAsText(file: File) {
    this.result = `text:${file.name}`
    queueMicrotask(() => this.onload?.())
  }
}

;(globalThis as unknown as { FileReader: typeof FileReader }).FileReader = FakeFileReader as unknown as typeof FileReader

describe('extractClipboardFiles', () => {
  it('extracts image files from clipboard items and ignores non-image payloads', () => {
    const img = new File(['img-bytes'], 'paste.png', { type: 'image/png' })
    const txt = new File(['hello'], 'note.txt', { type: 'text/plain' })

    const files = extractClipboardFiles({
      items: [
        { kind: 'string', type: 'text/plain', getAsFile: () => null },
        { kind: 'file', type: 'text/plain', getAsFile: () => txt },
        { kind: 'file', type: 'image/png', getAsFile: () => img },
      ],
    })

    assert.equal(files.length, 1)
    assert.equal(files[0].type, 'image/png')
  })

  it('assigns fallback names for nameless pasted images', () => {
    const nameless = new File(['img-bytes'], '', { type: 'image/jpeg' })
    const files = extractClipboardFiles({
      files: [nameless],
    })

    assert.equal(files.length, 1)
    assert.ok(files[0].name.startsWith('pasted-image-'))
    assert.ok(files[0].name.endsWith('.jpg'))
  })
})

describe('filesToInputAttachments', () => {
  it('converts pasted image files to image attachments with data URLs', async () => {
    const input = [new File(['img-bytes'], '', { type: 'image/png' })]
    const out = await filesToInputAttachments(input)

    assert.equal(out.rejected.length, 0)
    assert.equal(out.attachments.length, 1)
    assert.equal(out.attachments[0].kind, 'image')
    assert.ok(out.attachments[0].name.startsWith('pasted-image-'))
    assert.ok(out.attachments[0].dataUrl?.startsWith('data:image/png;base64,'))
  })
})
