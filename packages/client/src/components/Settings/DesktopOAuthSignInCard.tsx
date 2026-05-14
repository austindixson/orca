import { LogoAnthropicMark, LogoGoogleMark, LogoOpenAiCodexMark } from './ProviderBrandLogos'
import type { PiRegistryKeyStatus } from '../../lib/llmCredentials'

type OauthKind = 'anthropic' | 'openai' | 'google' | null

export type DesktopOAuthSignInCardProps = {
  loading: boolean
  registry: PiRegistryKeyStatus[] | null
  oauthKind: OauthKind
  terminalBusy: boolean
  actionMsg: string | null
  onRefresh: () => void
  onSignInAnthropic: () => void
  onSignInOpenaiCodex: () => void
  onSignInGoogleGemini: () => void
  onOpenCliInTerminal: () => void
}

/**
 * Desktop-only OAuth sign-in: Claude, ChatGPT Codex, Google Gemini CLI — presented as native Orca flows.
 */
export function DesktopOAuthSignInCard({
  loading,
  registry,
  oauthKind,
  terminalBusy,
  actionMsg,
  onRefresh,
  onSignInAnthropic,
  onSignInOpenaiCodex,
  onSignInGoogleGemini,
  onOpenCliInTerminal,
}: DesktopOAuthSignInCardProps) {
  const anthropicLoggedIn = !!registry?.find((row) => row.key === 'anthropic')?.present
  const openaiLoggedIn = !!registry?.find((row) => row.key === 'openai-codex')?.present
  const googleLoggedIn = !!registry?.find((row) => row.key === 'google-gemini-cli')?.present

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.06] to-white/[0.02] shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset]">
      <div className="border-b border-white/[0.06] bg-black/20 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-['Syne',sans-serif] text-base font-semibold tracking-tight text-white">
              Sign in with your account
            </h3>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-gray-400">
              Use your existing provider credentials on this Mac. Sessions are stored in the desktop auth file so
              Orca can call the API without pasting keys. Claude and ChatGPT (Codex) use each vendor’s OAuth; Gemini
              CLI uses the Google account flow.
            </p>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={onRefresh}
            className="shrink-0 rounded-lg border border-white/12 bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:border-accent-teal/35 hover:text-white disabled:opacity-50"
          >
            {loading ? 'Refreshing…' : 'Refresh status'}
          </button>
        </div>
        {registry && registry.length > 0 ? (
          <div className="mt-3">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">Saved session keys</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {registry.map((row) => (
                <span
                  key={row.key}
                  className={`inline-flex items-center rounded-md px-2 py-0.5 font-['IBM_Plex_Mono',monospace] text-[10px] ${
                    row.present ? 'bg-emerald-500/15 text-emerald-300/95' : 'bg-white/[0.04] text-gray-600'
                  }`}
                >
                  {row.key}
                  {row.present ? ' · active' : ''}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-3">
        <button
          type="button"
          disabled={oauthKind !== null}
          onClick={onSignInAnthropic}
          className="group flex flex-col items-stretch rounded-xl border border-white/[0.08] bg-black/25 p-4 text-left transition-all hover:border-accent-teal/40 hover:bg-accent-teal/[0.06] disabled:opacity-50"
        >
          <div className="flex items-center gap-3">
            <LogoAnthropicMark />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">Claude</div>
              <div className="text-[11px] text-gray-500">Anthropic</div>
            </div>
          </div>
          {anthropicLoggedIn ? (
            <div className="mt-2 text-xs font-semibold text-emerald-300/95">Logged in</div>
          ) : null}
          {oauthKind === 'anthropic' ? (
            <div className="mt-auto pt-4 text-xs font-medium text-accent-teal/95 group-hover:text-accent-teal">
              Signing in…
            </div>
          ) : !anthropicLoggedIn ? (
            <div className="mt-auto pt-4 text-xs font-medium text-accent-teal/95 group-hover:text-accent-teal">
              Click to log in
            </div>
          ) : null}
        </button>

        <button
          type="button"
          disabled={oauthKind !== null}
          onClick={onSignInOpenaiCodex}
          className="group flex flex-col items-stretch rounded-xl border border-white/[0.08] bg-black/25 p-4 text-left transition-all hover:border-emerald-500/40 hover:bg-emerald-500/[0.06] disabled:opacity-50"
        >
          <div className="flex items-center gap-3">
            <LogoOpenAiCodexMark />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">ChatGPT</div>
              <div className="text-[11px] text-gray-500">Codex subscription</div>
            </div>
          </div>
          {openaiLoggedIn ? (
            <div className="mt-2 text-xs font-semibold text-emerald-300/95">Logged in</div>
          ) : null}
          {oauthKind === 'openai' ? (
            <div className="mt-auto pt-4 text-xs font-medium text-emerald-300/95 group-hover:text-emerald-200">
              Signing in…
            </div>
          ) : !openaiLoggedIn ? (
            <div className="mt-auto pt-4 text-xs font-medium text-emerald-300/95 group-hover:text-emerald-200">
              Click to log in
            </div>
          ) : null}
        </button>

        <button
          type="button"
          disabled={oauthKind !== null}
          onClick={onSignInGoogleGemini}
          className="group flex flex-col items-stretch rounded-xl border border-white/[0.08] bg-black/25 p-4 text-left transition-all hover:border-blue-400/35 hover:bg-blue-500/[0.06] disabled:opacity-50"
        >
          <div className="flex items-center gap-3">
            <LogoGoogleMark />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">Google</div>
              <div className="text-[11px] text-gray-500">Gemini CLI</div>
            </div>
          </div>
          {googleLoggedIn ? (
            <div className="mt-2 text-xs font-semibold text-emerald-300/95">Logged in</div>
          ) : null}
          {oauthKind === 'google' ? (
            <div className="mt-auto pt-4 text-xs font-medium text-blue-200/95 group-hover:text-blue-100">
              Signing in…
            </div>
          ) : !googleLoggedIn ? (
            <div className="mt-auto pt-4 text-xs font-medium text-blue-200/95 group-hover:text-blue-100">
              Click to log in
            </div>
          ) : null}
        </button>
      </div>

      <div className="border-t border-white/[0.06] px-4 pb-4 pt-2">
        <button
          type="button"
          disabled={terminalBusy || oauthKind !== null}
          onClick={onOpenCliInTerminal}
          className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left text-xs font-medium text-gray-300 transition-colors hover:border-white/18 hover:bg-white/[0.07] disabled:opacity-50 sm:w-auto"
        >
          {terminalBusy ? 'Opening Terminal…' : 'Advanced: open Terminal for CLI login'}
        </button>
        <p className="mt-2 text-[10px] leading-relaxed text-gray-600">
          If the bundled CLI is installed, run <code className="rounded bg-black/40 px-1">/login</code> in its prompt
          to add or switch accounts.
        </p>
        {actionMsg ? (
          <p className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[11px] leading-relaxed text-gray-400">
            {actionMsg}
          </p>
        ) : null}
      </div>

    </div>
  )
}
