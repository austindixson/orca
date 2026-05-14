export type IntegrationId =
  | 'gmail'
  | 'word-processor'
  | 'twitter'
  | 'slack'
  | 'answer-overflow'
  | 'caldav'
  | 'notes'
  | 'reminders'
  | 'google-drive'
  | 'nano-banana-pro'
  | 'obsidian'
  | 'obsidian-brain'
  | 'notion'
  | 'prismfy'
  | 'apigateway'

export type IntegrationKind = 'browser' | 'obsidian' | 'sidebar' | 'todo' | 'custom'

export interface IntegrationEntry {
  id: IntegrationId
  label: string
  description: string
  kind: IntegrationKind
  /** Default URL for browser tiles; optional for sidebar/todo/custom */
  defaultUrl?: string
  /** Some SaaS sites open external auth windows; browser preview may still be smoother externally. */
  blockedIframeLikely?: boolean
  keywords: string[]
}

export const INTEGRATION_CATALOG: IntegrationEntry[] = [
  {
    id: 'gmail',
    label: 'Gmail',
    description: 'Google Mail in a browser preview window.',
    kind: 'browser',
    defaultUrl: 'https://mail.google.com',
    blockedIframeLikely: true,
    keywords: ['email', 'google', 'mail'],
  },
  {
    id: 'word-processor',
    label: 'Word processor',
    description: 'Google Docs (new doc); switch to Office online in the tile if you prefer.',
    kind: 'browser',
    defaultUrl: 'https://docs.google.com/document/u/0/create',
    blockedIframeLikely: true,
    keywords: ['docs', 'writing', 'google docs', 'office'],
  },
  {
    id: 'twitter',
    label: 'X (Twitter)',
    description: 'X / Twitter web.',
    kind: 'browser',
    defaultUrl: 'https://x.com',
    blockedIframeLikely: true,
    keywords: ['x', 'twitter', 'social'],
  },
  {
    id: 'slack',
    label: 'Slack',
    description: 'Slack web client.',
    kind: 'browser',
    defaultUrl: 'https://app.slack.com',
    blockedIframeLikely: true,
    keywords: ['chat', 'slack'],
  },
  {
    id: 'answer-overflow',
    label: 'Answer Overflow',
    description: 'Discord-indexed public Q&A search.',
    kind: 'browser',
    defaultUrl: 'https://www.answeroverflow.com',
    blockedIframeLikely: false,
    keywords: ['discord', 'answeroverflow', 'research'],
  },
  {
    id: 'caldav',
    label: 'Calendar (web)',
    description: 'Provider calendar web UI; true CalDAV sync is outside Orca v1.',
    kind: 'browser',
    defaultUrl: 'https://calendar.google.com',
    blockedIframeLikely: true,
    keywords: ['calendar', 'caldav', 'schedule'],
  },
  {
    id: 'notes',
    label: 'Apple Notes (web)',
    description: 'iCloud Notes (limited web); full Notes.app is system-only.',
    kind: 'browser',
    defaultUrl: 'https://www.icloud.com/notes',
    blockedIframeLikely: true,
    keywords: ['notes', 'icloud', 'apple'],
  },
  {
    id: 'reminders',
    label: 'Reminders',
    description: 'Use the Todo tile; Apple Reminders has no embeddable web app.',
    kind: 'todo',
    keywords: ['reminders', 'tasks', 'apple', 'todo'],
  },
  {
    id: 'google-drive',
    label: 'Google Drive',
    description: 'Google Drive in a browser preview window.',
    kind: 'browser',
    defaultUrl: 'https://drive.google.com',
    blockedIframeLikely: true,
    keywords: ['drive', 'files', 'google'],
  },
  {
    id: 'nano-banana-pro',
    label: 'Nano banana pro',
    description:
      'Placeholder integration — set the URL field to your product (e.g. an image or API dashboard) before adding a tile.',
    kind: 'custom',
    defaultUrl: '',
    blockedIframeLikely: false,
    keywords: ['nano', 'banana', 'custom'],
  },
  {
    id: 'obsidian',
    label: 'Obsidian',
    description: 'Vault on disk + kepano/obsidian-skills; use editor and file tools.',
    kind: 'obsidian',
    keywords: ['obsidian', 'vault', 'markdown', 'wikilinks'],
  },
  {
    id: 'obsidian-brain',
    label: 'Obsidian Brain',
    description: 'Sidebar graph of your vault — open the panel and scan.',
    kind: 'sidebar',
    keywords: ['brain', 'graph', 'mem palace', 'mempalace'],
  },
  {
    id: 'notion',
    label: 'Notion',
    description: 'Notion web; API automation is a separate step.',
    kind: 'browser',
    defaultUrl: 'https://www.notion.so',
    blockedIframeLikely: true,
    keywords: ['notion', 'wiki', 'docs'],
  },
  {
    id: 'prismfy',
    label: 'Prismfy search',
    description:
      'Placeholder — enter your Prismfy or team search URL in the wizard when you have it; until then, paste any search hub URL.',
    kind: 'custom',
    defaultUrl: '',
    blockedIframeLikely: false,
    keywords: ['prismfy', 'search', 'custom'],
  },
  {
    id: 'apigateway',
    label: 'API Gateway',
    description:
      'AWS API Gateway console by default; switch the URL to Kong, Traefik, NGINX, or internal docs if you use those.',
    kind: 'custom',
    defaultUrl: 'https://console.aws.amazon.com/apigateway',
    blockedIframeLikely: true,
    keywords: ['api', 'gateway', 'aws', 'http'],
  },
]

export function getIntegrationById(id: IntegrationId): IntegrationEntry | undefined {
  return INTEGRATION_CATALOG.find((e) => e.id === id)
}
