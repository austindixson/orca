/**
 * Explicit harness loop phases (setup → model → error recovery → tools → continuation).
 * Used for tracing and future async-generator orchestration.
 */

export enum OrchestratorLoopPhase {
  Setup = 'setup',
  Model = 'model',
  ErrorRecovery = 'error_recovery',
  Tools = 'tools',
  Continuation = 'continuation',
}
