/**
 * Bundled markdown for the Integrations wizard (mirrors repo docs/skills/integrations/*.md).
 */
import curatedSkillSources from '../../../../../docs/skills/integrations/CURATED_SKILL_SOURCES.md?raw'
import gmail from '../../../../../docs/skills/integrations/gmail.md?raw'
import wordProcessor from '../../../../../docs/skills/integrations/word-processor.md?raw'
import twitter from '../../../../../docs/skills/integrations/twitter.md?raw'
import slack from '../../../../../docs/skills/integrations/slack.md?raw'
import answerOverflow from '../../../../../docs/skills/integrations/answer-overflow.md?raw'
import caldav from '../../../../../docs/skills/integrations/caldav.md?raw'
import notes from '../../../../../docs/skills/integrations/notes.md?raw'
import reminders from '../../../../../docs/skills/integrations/reminders.md?raw'
import googleDrive from '../../../../../docs/skills/integrations/google-drive.md?raw'
import nanoBananaPro from '../../../../../docs/skills/integrations/nano-banana-pro.md?raw'
import obsidian from '../../../../../docs/skills/integrations/obsidian.md?raw'
import obsidianBrain from '../../../../../docs/skills/integrations/obsidian-brain.md?raw'
import notion from '../../../../../docs/skills/integrations/notion.md?raw'
import prismfy from '../../../../../docs/skills/integrations/prismfy.md?raw'
import apigateway from '../../../../../docs/skills/integrations/apigateway.md?raw'

import type { IntegrationId } from './integrationCatalog'

/** Full curated matrix (same as `docs/skills/integrations/CURATED_SKILL_SOURCES.md`). */
export const CURATED_SKILL_SOURCES_MARKDOWN = curatedSkillSources

export const INTEGRATION_DOC_MARKDOWN: Record<IntegrationId, string> = {
  gmail,
  'word-processor': wordProcessor,
  twitter,
  slack,
  'answer-overflow': answerOverflow,
  caldav,
  notes,
  reminders,
  'google-drive': googleDrive,
  'nano-banana-pro': nanoBananaPro,
  obsidian,
  'obsidian-brain': obsidianBrain,
  notion,
  prismfy,
  apigateway,
}
