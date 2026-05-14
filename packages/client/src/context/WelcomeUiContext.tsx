import { createContext, useContext, type ReactNode } from 'react'

export type WelcomeUiValue = {
  /** True while the "Open a project" welcome screen is shown — hide workspace chrome (e.g. title bar project + task %). */
  welcomeMode: boolean
}

const WelcomeUiContext = createContext<WelcomeUiValue>({ welcomeMode: false })

export function WelcomeUiProvider({
  welcomeMode,
  children,
}: {
  welcomeMode: boolean
  children: ReactNode
}) {
  return (
    <WelcomeUiContext.Provider value={{ welcomeMode }}>{children}</WelcomeUiContext.Provider>
  )
}

export function useWelcomeUi(): WelcomeUiValue {
  return useContext(WelcomeUiContext)
}
