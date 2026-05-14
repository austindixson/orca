# Hermes Any-App Hybrid — Practical Workflow Catalog (20)

## Purpose
Concrete, reusable workflow-pack examples for MVP and near-term expansion.

Machine-readable companion:
- `hermes-dev/HERMES-ANY-APP-WORKFLOW-CATALOG.json`
- Includes top-level defaults for `ui_shell`, `llm_connectivity`, and `auth_lanes` (OAuth, browser-session, hybrid router).

Format per item:
- User says
- Pack/target
- Commands
- Risk tier

## 1) Post a product update on X
- User says: "Post this on X: v0.9 is live, patch notes in thread."
- Pack/target: `x-social-ops`
- Commands: `x.compose.open` -> `x.tweet.send`
- Risk tier: mutating

## 2) Reply to top mentions from last 24h
- User says: "Reply to today’s top 10 mentions with this template."
- Pack/target: `x-social-ops`
- Commands: `x.mentions.list` -> `x.tweet.reply.batch`
- Risk tier: mutating

## 3) Queue 5 tweets from a draft file
- User says: "Take tweets.md and schedule these for tomorrow."
- Pack/target: `x-social-ops`
- Commands: `local.file.read` -> `x.post.schedule.batch`
- Risk tier: mutating

## 4) Upload active folder to Google Drive
- User says: "Move all of these to Google Drive under Client A/April."
- Pack/target: `drive-ingest`
- Commands: `local.folder.list` -> `gdrive.folder.ensure` -> `gdrive.batch.upload`
- Risk tier: mutating

## 5) Upload and then clean local files
- User says: "Upload these and delete local originals after verification."
- Pack/target: `drive-ingest`
- Commands: `gdrive.batch.upload` -> `gdrive.verify.uploads` -> `local.delete_batch`
- Risk tier: destructive (delete step)

## 6) Weekly invoice export to Drive
- User says: "Export this week’s invoices CSV and save to Drive/Finance."
- Pack/target: `billing-reports`
- Commands: `billing.invoices.export_csv` -> `gdrive.file.upload`
- Risk tier: read_only + mutating

## 7) Create client folder structure in Drive
- User says: "Create onboarding folder tree for Acme in Drive."
- Pack/target: `drive-ops`
- Commands: `gdrive.folder.ensure.batch`
- Risk tier: mutating

## 8) Generate and share meeting notes in Notion
- User says: "Create meeting notes page from template in Notion for today."
- Pack/target: `notion-workspace`
- Commands: `notion.page.create_from_template`
- Risk tier: mutating

## 9) Turn chat transcript into Notion task list
- User says: "Convert this transcript into tasks in Notion backlog."
- Pack/target: `notion-workspace`
- Commands: `local.file.read` -> `notion.tasks.create.batch`
- Risk tier: mutating

## 10) Update CRM stale lead tags
- User says: "Tag all leads untouched for 30+ days as re-engage-q2."
- Pack/target: `crm-ops`
- Commands: `crm.leads.search` -> `crm.leads.tag.batch`
- Risk tier: mutating

## 11) Build daily pipeline summary
- User says: "Give me daily pipeline summary and post it to Slack."
- Pack/target: `crm-slack-reporting`
- Commands: `crm.pipeline.report` -> `slack.message.send`
- Risk tier: read_only + mutating

## 12) Create support follow-up tasks from Zendesk
- User says: "Create follow-up tasks for unresolved high-priority tickets."
- Pack/target: `support-ops`
- Commands: `zendesk.tickets.list` -> `linear.issue.create.batch`
- Risk tier: mutating

## 13) Sync local design assets to Drive and share link
- User says: "Upload /Brand/Launch assets and send share link to #design."
- Pack/target: `design-delivery`
- Commands: `gdrive.batch.upload` -> `gdrive.link.create` -> `slack.message.send`
- Risk tier: mutating

## 14) Publish blog draft from docs folder
- User says: "Publish latest docs/blog/*.md as a draft post."
- Pack/target: `cms-publisher`
- Commands: `local.glob.read` -> `cms.post.create_draft`
- Risk tier: mutating

## 15) End-of-week analytics snapshot
- User says: "Capture this week analytics screenshots and upload report pack."
- Pack/target: `analytics-capture`
- Commands: `web.capture.dashboard` -> `local.archive.create` -> `gdrive.file.upload`
- Risk tier: read_only + mutating

## 16) Compare ad spend vs conversions and alert anomalies
- User says: "Alert me if CAC rose above 20% week-over-week."
- Pack/target: `marketing-monitor`
- Commands: `ads.metrics.fetch` -> `analytics.metrics.fetch` -> `monitor.rule.evaluate` -> `slack.alert.send`
- Risk tier: read_only + mutating

## 17) Bulk rename and normalize before upload
- User says: "Rename all files in this folder to YYYY-MM-DD_client_topic and upload."
- Pack/target: `file-normalizer`
- Commands: `local.file.rename.batch` -> `gdrive.batch.upload`
- Risk tier: mutating

## 18) Recruiter workflow from spreadsheet
- User says: "Take candidates.csv and create interview tasks in Linear."
- Pack/target: `hiring-ops`
- Commands: `local.csv.read` -> `linear.issue.create.batch`
- Risk tier: mutating

## 19) Release checklist runner
- User says: "Run release checklist and post status update."
- Pack/target: `release-ops`
- Commands: `repo.checks.run` -> `ci.status.read` -> `slack.message.send`
- Risk tier: read_only + mutating

## 20) Multi-app launch day push
- User says: "Use launch-day pack and publish release note everywhere."
- Pack/target: `launch-day`
- Commands: `x.tweet.send` + `notion.page.publish` + `slack.message.send` + `gdrive.file.upload`
- Risk tier: mutating

## Notes
- Any delete/overwrite operation must remain explicit approval-only.
- Prefer upload+verify before local cleanup.
- Keep pack-level audit trace for each run.
