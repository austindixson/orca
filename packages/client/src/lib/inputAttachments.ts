import type { UserMessageContent } from './orchestrator/types'
import { isTauri, readFileBinary, saveClipboardImageTemp } from './tauri'

export type InputAttachmentKind = 'image' | 'text' | 'binary'

export interface InputAttachment {
  id: string
  name: string
  mime: string
  size: number
  kind: InputAttachmentKind
  /** Absolute local file path when available (Tauri path drops / clipboard image temp saves). */
  sourcePath?: string
  dataUrl?: string
  textContent?: string
  truncated?: boolean
}

export interface InputAttachmentResult {
  attachments: InputAttachment[]
  rejected: string[]
}

export interface ClipboardTransferItemLike {
  kind?: string
  type?: string
  getAsFile?: () => File | null
}

export interface ClipboardTransferLike {
  items?: ArrayLike<ClipboardTransferItemLike>
  files?: ArrayLike<File>
}

const MAX_FILE_BYTES = 12 * 1024 * 1024
const MAX_TEXT_CHARS = 32000
const TEXT_MIME_HINTS = [
  'text/',
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
]
const TEXT_EXT_HINTS = /\.(md|txt|log|json|yaml|yml|toml|ini|cfg|conf|xml|html|css|js|jsx|ts|tsx|rs|py|go|java|c|cpp|h|hpp|sh|zsh|bash)$/i

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

function looksTextLike(file: File): boolean {
  if (TEXT_MIME_HINTS.some((m) => file.type.startsWith(m))) return true
  return TEXT_EXT_HINTS.test(file.name)
}

function looksTextLikeByNameAndMime(name: string, mime: string): boolean {
  if (TEXT_MIME_HINTS.some((m) => mime.startsWith(m))) return true
  return TEXT_EXT_HINTS.test(name)
}

function decodeBase64Text(dataBase64: string): string {
  const binary = atob(dataBase64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

function mimeToFallbackExtension(mime: string): string {
  const media = mime.toLowerCase().split('/')[1] || 'bin'
  const cleaned = media.split(';')[0].replace(/[^a-z0-9]+/g, '')
  if (!cleaned) return 'bin'
  if (cleaned === 'jpeg') return 'jpg'
  return cleaned
}

function normalizeIncomingFiles(files: File[]): File[] {
  return files.map((file, idx) => {
    const trimmed = file.name?.trim() ?? ''
    if (trimmed) return file
    const fallbackExt = mimeToFallbackExtension(file.type || 'application/octet-stream')
    return new File([file], `pasted-image-${Date.now()}-${idx + 1}.${fallbackExt}`, {
      type: file.type || 'application/octet-stream',
      lastModified: Date.now(),
    })
  })
}

export function extractClipboardFiles(transfer: ClipboardTransferLike | null | undefined): File[] {
  if (!transfer) return []
  const out: File[] = []

  if (transfer.items && transfer.items.length > 0) {
    for (const raw of Array.from(transfer.items)) {
      if (!raw) continue
      if (raw.kind !== 'file') continue
      const file = raw.getAsFile?.()
      if (!file) continue
      if (file.type && !file.type.startsWith('image/')) continue
      out.push(file)
    }
  }

  if (out.length > 0) return normalizeIncomingFiles(out)

  if (transfer.files && transfer.files.length > 0) {
    const fromFiles = Array.from(transfer.files).filter((f) => f.type.startsWith('image/'))
    if (fromFiles.length > 0) return normalizeIncomingFiles(fromFiles)
  }

  return []
}

export async function filesToInputAttachments(
  files: File[],
  opts?: {
    /** When true on desktop, pasted images are saved to a local temp file and attached with `sourcePath`. */
    preferLocalImagePaths?: boolean
  }
): Promise<InputAttachmentResult> {
  const attachments: InputAttachment[] = []
  const rejected: string[] = []

  for (const file of normalizeIncomingFiles(files)) {
    if (file.size > MAX_FILE_BYTES) {
      rejected.push(`${file.name}: larger than 12MB`)
      continue
    }
    const id = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

    try {
      if (file.type.startsWith('image/')) {
        const dataUrl = await readFileAsDataUrl(file)
        const dataBase64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : ''
        let sourcePath: string | undefined
        if (opts?.preferLocalImagePaths && isTauri() && dataBase64) {
          try {
            sourcePath = await saveClipboardImageTemp({
              dataBase64,
              mime: file.type || 'image/*',
              suggestedName: file.name,
            })
          } catch {
            sourcePath = undefined
          }
        }
        attachments.push({
          id,
          name: file.name,
          mime: file.type || 'image/*',
          size: file.size,
          kind: 'image',
          sourcePath,
          dataUrl,
        })
        continue
      }

      if (looksTextLike(file)) {
        const text = await readFileAsText(file)
        const truncated = text.length > MAX_TEXT_CHARS
        attachments.push({
          id,
          name: file.name,
          mime: file.type || 'text/plain',
          size: file.size,
          kind: 'text',
          textContent: truncated ? text.slice(0, MAX_TEXT_CHARS) : text,
          truncated,
        })
        continue
      }

      attachments.push({
        id,
        name: file.name,
        mime: file.type || 'application/octet-stream',
        size: file.size,
        kind: 'binary',
      })
    } catch {
      rejected.push(`${file.name}: failed to read`)
    }
  }

  return { attachments, rejected }
}

export async function pathsToInputAttachments(paths: string[]): Promise<InputAttachmentResult> {
  const attachments: InputAttachment[] = []
  const rejected: string[] = []
  if (!isTauri()) {
    return { attachments, rejected: ['Path drops are only available in Tauri'] }
  }

  for (const path of paths) {
    try {
      const file = await readFileBinary(path)
      if (file.size > MAX_FILE_BYTES) {
        rejected.push(`${file.name}: larger than 12MB`)
        continue
      }
      const id = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

      if (file.mime.startsWith('image/')) {
        attachments.push({
          id,
          name: file.name,
          mime: file.mime,
          size: file.size,
          kind: 'image',
          sourcePath: path,
          dataUrl: `data:${file.mime};base64,${file.data_base64}`,
        })
        continue
      }

      if (looksTextLikeByNameAndMime(file.name, file.mime)) {
        const text = decodeBase64Text(file.data_base64)
        const truncated = text.length > MAX_TEXT_CHARS
        attachments.push({
          id,
          name: file.name,
          mime: file.mime || 'text/plain',
          size: file.size,
          kind: 'text',
          sourcePath: path,
          textContent: truncated ? text.slice(0, MAX_TEXT_CHARS) : text,
          truncated,
        })
        continue
      }

      attachments.push({
        id,
        name: file.name,
        mime: file.mime || 'application/octet-stream',
        size: file.size,
        kind: 'binary',
        sourcePath: path,
      })
    } catch {
      rejected.push(`${path.split('/').pop() || path}: failed to read`)
    }
  }

  return { attachments, rejected }
}

export function toUserContentWithAttachments(
  userText: string,
  attachments: InputAttachment[]
): UserMessageContent {
  const base = userText.trim() || '(attachment-only message)'
  if (attachments.length === 0) return base

  const textBlocks: string[] = [base]
  const imageParts: Array<{ type: 'image_url'; image_url: { url: string } }> = []

  for (const a of attachments) {
    if (a.kind === 'image' && a.dataUrl) {
      imageParts.push({
        type: 'image_url',
        image_url: { url: a.dataUrl },
      })
      textBlocks.push(
        a.sourcePath ? `[Attached image: ${a.name} | local path: ${a.sourcePath}]` : `[Attached image: ${a.name}]`
      )
      continue
    }

    if (a.kind === 'text') {
      textBlocks.push(
        [
          `Attached file: ${a.name} (${Math.max(1, Math.round(a.size / 1024))}KB)`,
          a.sourcePath ? `Local path: ${a.sourcePath}` : '',
          '```',
          a.textContent || '',
          '```',
          a.truncated ? '[File content truncated for context window safety.]' : '',
        ]
          .filter(Boolean)
          .join('\n')
      )
      continue
    }

    textBlocks.push(
      [
        `Attached file: ${a.name} (${Math.max(1, Math.round(a.size / 1024))}KB, ${a.mime}) [binary; content not inlined]`,
        a.sourcePath ? `Local path: ${a.sourcePath}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    )
  }

  if (imageParts.length === 0) {
    return textBlocks.join('\n\n')
  }

  return [{ type: 'text', text: textBlocks.join('\n\n') }, ...imageParts]
}
