export interface ImageAttachment {
  id: string
  name: string
  mime: string
  size: number
  dataUrl: string
}

export interface ImageAttachmentResult {
  attachments: ImageAttachment[]
  rejected: string[]
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

export async function filesToImageAttachments(files: File[]): Promise<ImageAttachmentResult> {
  const attachments: ImageAttachment[] = []
  const rejected: string[] = []

  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      rejected.push(`${file.name}: not an image`)
      continue
    }
    if (file.size > MAX_IMAGE_BYTES) {
      rejected.push(`${file.name}: larger than 10MB`)
      continue
    }
    try {
      const dataUrl = await readFileAsDataUrl(file)
      attachments.push({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        mime: file.type,
        size: file.size,
        dataUrl,
      })
    } catch {
      rejected.push(`${file.name}: failed to read`)
    }
  }

  return { attachments, rejected }
}
