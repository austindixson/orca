export type OneShotPhase =
  | 'idle'
  | 'research'
  | 'clarify'
  | 'spec'
  | 'architecture'
  | 'decomposition'
  | 'codegen'
  | 'validation'
  | 'preview'
  | 'complete'

/** Up to 3 multiple-choice rows for optional 1-shot clarification (option 4 = other / fill-in). */
export interface ClarifyingQuestion {
  id: string
  question: string
  /** Exactly four choices; index 3 is the "Other" line (fill-in when selected). */
  options: [string, string, string, string]
}

export interface ClarifyingAnswer {
  questionId: string
  /** 1–4 */
  selectedOption: number
  /** Required when `selectedOption === 4`. */
  customText?: string
}
