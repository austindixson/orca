/** Minimal brand marks for provider sign-in (decorative; not official logos). */

export function LogoAnthropicMark({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" aria-hidden>
      <rect width="40" height="40" rx="10" fill="url(#anthropic-grad)" />
      <path
        d="M20 11l7.5 18h-4.2l-1.6-4.2h-3.4l-1.6 4.2H12.5L20 11zm-1.1 11.2h2.2L20 15.8l-1.9 6.4z"
        fill="white"
        fillOpacity={0.95}
      />
      <defs>
        <linearGradient id="anthropic-grad" x1="8" y1="6" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="#d97757" />
          <stop offset="1" stopColor="#b4532a" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function LogoOpenAiCodexMark({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" aria-hidden>
      <rect width="40" height="40" rx="10" fill="#0d0d0d" />
      <path
        d="M20 10c5.5 0 10 4.5 10 10s-4.5 10-10 10-10-4.5-10-10 4.5-10 10-10z"
        stroke="#10a37f"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M15 20c0-2.8 2.2-5 5-5s5 2.2 5 5-2.2 5-5 5-5-2.2-5-5z"
        fill="#10a37f"
        fillOpacity={0.35}
      />
    </svg>
  )
}

export function LogoGoogleMark({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" aria-hidden>
      <rect width="40" height="40" rx="10" fill="white" />
      <path
        d="M28.4 20.3c0-.7-.1-1.4-.2-2H20v3.8h4.7c-.2 1.2-.9 2.2-1.9 2.9v2.4h3.1c1.8-1.7 2.8-4.1 2.8-7.1z"
        fill="#4285F4"
      />
      <path
        d="M20 29c2.6 0 4.7-.9 6.3-2.3l-3.1-2.4c-.9.6-2 1-3.2 1-2.4 0-4.5-1.6-5.2-3.8h-3.2v2.5c1.6 3.2 4.9 5.4 8.4 5.4z"
        fill="#34A853"
      />
      <path
        d="M14.8 21.5c-.2-.6-.3-1.2-.3-1.9s.1-1.3.3-1.9v-2.5h-3.2c-.6 1.2-1 2.6-1 4.1s.4 2.9 1 4.1l3.2-2.5z"
        fill="#FBBC05"
      />
      <path
        d="M20 13.8c1.4 0 2.6.5 3.6 1.4l2.7-2.7C24.7 10.9 22.6 10 20 10c-3.5 0-6.8 2.2-8.4 5.4l3.2 2.5c.7-2.2 2.8-3.8 5.2-3.8z"
        fill="#EA4335"
      />
    </svg>
  )
}
