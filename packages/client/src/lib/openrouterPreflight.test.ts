import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classifyEndpointsResponse, describePreflight } from './openrouterPreflight'

describe('classifyEndpointsResponse', () => {
  it('returns ok when a live endpoint exposes `tools`', () => {
    const r = classifyEndpointsResponse(200, {
      data: {
        endpoints: [
          { status: '0', supported_parameters: ['temperature', 'tools'], provider_name: 'Together', name: 'default' },
        ],
      },
    })
    assert.equal(r.status, 'ok')
    assert.equal(r.providerName, 'Together')
    assert.equal(r.endpointName, 'default')
  })

  it('returns no-tools when endpoints exist but none expose `tools`', () => {
    const r = classifyEndpointsResponse(200, {
      data: {
        endpoints: [
          { status: '0', supported_parameters: ['temperature', 'top_p'], provider_name: 'Example' },
        ],
      },
    })
    assert.equal(r.status, 'no-tools')
  })

  it('treats all non-"0" textual live markers as live', () => {
    const r = classifyEndpointsResponse(200, {
      data: {
        endpoints: [
          { status: 'healthy', supported_parameters: ['tools'], provider_name: 'X' },
        ],
      },
    })
    assert.equal(r.status, 'ok')
  })

  it('skips explicitly deprecated endpoints', () => {
    const r = classifyEndpointsResponse(200, {
      data: {
        endpoints: [
          { status: 'deprecated', supported_parameters: ['tools'], provider_name: 'Old' },
        ],
      },
    })
    assert.equal(r.status, 'no-tools')
  })

  it('returns no-tools when endpoints array is empty', () => {
    const r = classifyEndpointsResponse(200, { data: { endpoints: [] } })
    assert.equal(r.status, 'no-tools')
  })

  it('maps 401 → auth', () => {
    assert.equal(classifyEndpointsResponse(401, {}).status, 'auth')
  })

  it('maps 403 → auth', () => {
    assert.equal(classifyEndpointsResponse(403, {}).status, 'auth')
  })

  it('maps 402 → credits', () => {
    assert.equal(classifyEndpointsResponse(402, {}).status, 'credits')
  })

  it('maps 404 → not-found', () => {
    assert.equal(classifyEndpointsResponse(404, {}).status, 'not-found')
  })

  it('maps 429 → rate-limited', () => {
    assert.equal(classifyEndpointsResponse(429, {}).status, 'rate-limited')
  })

  it('maps other non-2xx → unknown with detail', () => {
    const r = classifyEndpointsResponse(500, { error: { message: 'upstream exploded' } })
    assert.equal(r.status, 'unknown')
    assert.match(r.detail ?? '', /upstream exploded/)
  })
})

describe('describePreflight', () => {
  it('returns a neutral "Not checked" short for undefined', () => {
    const d = describePreflight(undefined)
    assert.equal(d.tone, 'neutral')
    assert.match(d.short, /Not checked/)
  })

  it('formats ok with provider name when available', () => {
    const d = describePreflight({
      status: 'ok',
      providerName: 'Together',
      checkedAt: Date.now(),
    })
    assert.equal(d.tone, 'ok')
    assert.match(d.short, /Together/)
  })

  it('marks no-tools as an error', () => {
    const d = describePreflight({ status: 'no-tools', checkedAt: Date.now() })
    assert.equal(d.tone, 'err')
  })

  it('marks rate-limited as a warning', () => {
    const d = describePreflight({ status: 'rate-limited', checkedAt: Date.now() })
    assert.equal(d.tone, 'warn')
  })

  it('marks auth as an error', () => {
    const d = describePreflight({ status: 'auth', checkedAt: Date.now() })
    assert.equal(d.tone, 'err')
    assert.match(d.short, /key/i)
  })
})
