import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { throwIfProviderErrorObjectWithoutChoices } from './chatCompletionBodyGuards'

describe('throwIfProviderErrorObjectWithoutChoices', () => {
  it('does nothing when choices is non-empty', () => {
    assert.doesNotThrow(() =>
      throwIfProviderErrorObjectWithoutChoices(
        { choices: [{ message: { role: 'assistant', content: 'hi' } }] },
        200
      )
    )
  })

  it('throws when HTTP 200 body has error and no choices', () => {
    assert.throws(
      () =>
        throwIfProviderErrorObjectWithoutChoices(
          { error: { message: 'Rate limit exceeded', type: 'rate_limit' } },
          200
        ),
      /provider error in response body.*Rate limit exceeded/
    )
  })

  it('does not throw when choices missing but no error key (downstream may fail)', () => {
    assert.doesNotThrow(() => throwIfProviderErrorObjectWithoutChoices({ id: 'x' }, 200))
  })
})
