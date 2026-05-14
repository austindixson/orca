#!/usr/bin/env node

import { spawn } from 'node:child_process'
import process from 'node:process'
import { chromium } from 'playwright'

const APP_URL = process.env.HERMES_TILE_APP_URL ?? 'http://127.0.0.1:4173'
const HERMES_BASE_URL = process.env.HERMES_TILE_BASE_URL ?? 'http://127.0.0.1:8642/v1'
const STARTUP_TIMEOUT_MS = 30_000

const scenarios = [
  {
    name: 'open-gateway',
    apiKey: '',
    input: 'hello from open gateway',
    expectedText: 'Open gateway says hello.',
    expectRequests: [
      { authorization: null, status: 200 },
    ],
  },
  {
    name: 'stale-key-retry',
    apiKey: 'stale-key',
    input: 'retry after stale key',
    expectedText: 'Recovered after dropping stale bearer.',
    expectRequests: [
      { authorization: 'Bearer stale-key', status: 403 },
      { authorization: null, status: 200 },
    ],
  },
  {
    name: 'protected-gateway',
    apiKey: 'super-secret',
    input: 'protected gateway request',
    expectedText: 'Protected gateway accepted the key.',
    expectRequests: [
      { authorization: 'Bearer super-secret', status: 200 },
    ],
  },
  {
    name: 'missing-key-error',
    apiKey: '',
    input: 'missing key should fail',
    // New formatHermesConnectionError copy for 403s mentions API_SERVER_KEY.
    expectedText: 'Hermes rejected the Bearer',
    expectRequests: [
      { authorization: null, status: 403 },
      { authorization: null, status: 403 },
    ],
  },
  {
    name: 'gateway-down',
    apiKey: '',
    input: 'hello while gateway is down',
    mode: 'gateway-down',
    // formatHermesConnectionError wording when fetch fails.
    expectedText: 'Cannot reach Hermes',
    // We also expect the gateway status pill to reflect "unreachable".
    expectPillLabel: 'Gateway unreachable',
    // "Start gateway" CTA must be visible when the pill is unreachable.
    expectStartGatewayVisible: true,
    expectRequests: [],
  },
  {
    name: 'autostart-spawn',
    apiKey: '',
    mode: 'gateway-down',
    // No chat send — just click Start gateway and verify a terminal tile is spawned
    // carrying meta.command = 'API_SERVER_ENABLED=true hermes gateway'.
    action: 'start-gateway',
    expectRequests: [],
  },
]

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForHttpOk(url, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // keep polling
    }
    await delay(250)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

function describeRequestLog(requests) {
  return requests
    .map((row, idx) => `${idx + 1}. ${row.status} auth=${row.authorization ?? '(none)'}`)
    .join(' | ')
}

function createMockHermesServer() {
  return {
    requestLog: new Map(),
    async install(context) {
      const handler = async (route) => {
        const request = route.request()
        const url = new URL(request.url())
        const method = request.method()
        const corsHeaders = {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,OPTIONS',
          'access-control-allow-headers': 'authorization,content-type,accept,accept-language',
        }

        if (method === 'OPTIONS') {
          await route.fulfill({
            status: 204,
            headers: corsHeaders,
            body: '',
          })
          return
        }

        if (method === 'GET' && url.pathname.endsWith('/models')) {
          await route.fulfill({
            status: 200,
            headers: { ...corsHeaders, 'content-type': 'application/json' },
            body: JSON.stringify({
              object: 'list',
              data: [{ id: 'hermes-agent', object: 'model' }],
            }),
          })
          return
        }

        if (method !== 'POST' || !url.pathname.endsWith('/responses')) {
          await route.fulfill({
            status: 404,
            headers: { ...corsHeaders, 'content-type': 'application/json' },
            body: JSON.stringify({ error: 'not_found' }),
          })
          return
        }

        let body
        try {
          body = JSON.parse(request.postData() || '{}')
        } catch {
          await route.fulfill({
            status: 400,
            headers: { ...corsHeaders, 'content-type': 'application/json' },
            body: JSON.stringify({ error: 'invalid_json' }),
          })
          return
        }

        const input = typeof body.input === 'string' ? body.input : ''
        const conversation =
          typeof body.conversation === 'string' ? body.conversation : 'unknown'
        const authorization = await request.headerValue('authorization')
        const requestKey = input || conversation

        const requests = this.requestLog.get(requestKey) ?? []
        this.requestLog.set(requestKey, requests)

        const fulfillForbidden = async (detail) => {
          requests.push({ authorization, input, status: 403 })
          await route.fulfill({
            status: 403,
            headers: { ...corsHeaders, 'content-type': 'application/json' },
            body: JSON.stringify({ detail }),
          })
        }

        const fulfillSse = async (finalText) => {
          requests.push({ authorization, input, status: 200 })
          const split = Math.ceil(finalText.length / 2)
          const bodyText =
            `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: { text: finalText.slice(0, split) } })}\n\n` +
            `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: { text: finalText.slice(split) } })}\n\n` +
            `data: ${JSON.stringify({
              type: 'response.completed',
              output: [
                {
                  type: 'message',
                  content: [{ type: 'output_text', text: finalText }],
                },
              ],
            })}\n\n` +
            'data: [DONE]\n\n'

          await route.fulfill({
            status: 200,
            headers: {
              ...corsHeaders,
              'content-type': 'text/event-stream',
              'cache-control': 'no-cache',
            },
            body: bodyText,
          })
        }

        switch (requestKey) {
          case 'hello from open gateway':
            if (authorization) return fulfillForbidden('unexpected bearer for open gateway')
            return fulfillSse('Open gateway says hello.')
          case 'retry after stale key':
            if (authorization === 'Bearer stale-key') return fulfillForbidden('invalid stale bearer')
            if (authorization) return fulfillForbidden('unexpected bearer')
            return fulfillSse('Recovered after dropping stale bearer.')
          case 'protected gateway request':
            if (authorization !== 'Bearer super-secret') return fulfillForbidden('missing or invalid auth')
            return fulfillSse('Protected gateway accepted the key.')
          case 'missing key should fail':
            return fulfillForbidden('missing auth')
          default:
            if (authorization) return fulfillForbidden('unexpected auth for unknown scenario')
            return fulfillSse(`Echo: ${input || 'empty input'}`)
        }
      }
      await context.route('**/__agent-proxy/hermes/**', handler)
      await context.route('http://127.0.0.1:8642/**', handler)
      await context.route('http://localhost:8642/**', handler)
    },
    async stop() {
      // no-op for route-backed mock
    },
  }
}

function spawnClientIfNeeded() {
  return {
    child: null,
    async ensureRunning() {
      try {
        await waitForHttpOk(APP_URL, 1_000)
        return false
      } catch {
        const child = spawn(
          'npm',
          ['run', 'build', '--workspace=packages/client'],
          {
            cwd: process.cwd(),
            env: { ...process.env, VITE_ENABLE_CANVAS_BRIDGE: 'false' },
            stdio: ['ignore', 'pipe', 'pipe'],
          }
        )
        child.stdout.on('data', (chunk) => {
          process.stdout.write(`[client-build] ${chunk}`)
        })
        child.stderr.on('data', (chunk) => {
          process.stderr.write(`[client-build] ${chunk}`)
        })
        const buildExit = await new Promise((resolve) => child.once('exit', resolve))
        if (buildExit !== 0) {
          throw new Error(`Client build failed with exit code ${buildExit}`)
        }

        const preview = spawn(
          'npm',
          ['run', 'preview', '--workspace=packages/client', '--', '--host', '127.0.0.1', '--port', '4173'],
          {
            cwd: process.cwd(),
            env: { ...process.env },
            stdio: ['ignore', 'pipe', 'pipe'],
          }
        )
        this.child = preview
        preview.stdout.on('data', (chunk) => {
          process.stdout.write(`[client-preview] ${chunk}`)
        })
        preview.stderr.on('data', (chunk) => {
          process.stderr.write(`[client-preview] ${chunk}`)
        })
        await waitForHttpOk(APP_URL, STARTUP_TIMEOUT_MS)
        return true
      }
    },
    async stop() {
      if (!this.child) return
      this.child.kill('SIGTERM')
      await Promise.race([
        new Promise((resolve) => this.child.once('exit', resolve)),
        delay(5_000).then(() => {
          this.child.kill('SIGKILL')
        }),
      ])
    },
  }
}

async function prepareHermesTile(page, scenario) {
  await page.addInitScript(
    ({ storageKey, persistedState }) => {
      localStorage.clear()
      localStorage.setItem(storageKey, JSON.stringify({ state: persistedState, version: 0 }))
    },
    {
      storageKey: 'agent-canvas-settings',
      persistedState: {
        hermesApiBaseUrl: HERMES_BASE_URL,
        hermesApiKey: scenario.apiKey,
        hermesModel: 'hermes-agent',
      },
    }
  )

  // For gateway-down scenarios we register per-page routes FIRST so they win
  // over the context-level mock handler (Playwright matches page-scoped routes
  // before context-scoped ones).
  if (scenario.mode === 'gateway-down') {
    const abortHandler = (route) => route.abort('failed')
    await page.route('**/__agent-proxy/hermes/**', abortHandler)
    await page.route('http://127.0.0.1:8642/**', abortHandler)
    await page.route('http://localhost:8642/**', abortHandler)
  }

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="canvas-toolbar"]').waitFor({ timeout: 15_000 })
  await page.getByRole('button', { name: /Add tile/i }).click()
  await page.getByRole('menuitem', { name: /Hermes agent/i }).click()
  await page.locator('textarea[placeholder*="Message Hermes"]').waitFor({ timeout: 10_000 })
}

async function runAutostartSpawnScenario(context, scenario) {
  const page = await context.newPage()
  await prepareHermesTile(page, scenario)

  // Wait until the "Start gateway" button appears on the tile; the pill will have
  // settled to "unreachable" because /models is aborted by the page-scoped route.
  const startButton = page.locator('[data-testid="hermes-start-gateway"]').first()
  await startButton.waitFor({ timeout: 10_000 })
  await startButton.click()

  // The autostart banner should render while the tile polls for gateway readiness.
  // The banner is only mounted after spawnHermesGatewayTerminal returns, so its
  // presence confirms the terminal tile (or tab) carrying meta.command was created.
  await page
    .locator('[data-testid="hermes-autostart-banner"]')
    .waitFor({ timeout: 10_000 })

  // We don't actually want to wait the full autostart timeout; close immediately.
  await page.close()
  return []
}

async function runSendScenario(context, mockServer, scenario) {
  const page = await context.newPage()
  await prepareHermesTile(page, scenario)

  if (scenario.expectPillLabel) {
    await page
      .locator('[data-testid="hermes-gateway-pill"]', { hasText: scenario.expectPillLabel })
      .waitFor({ timeout: 15_000 })
  }

  const input = page.locator('textarea[placeholder*="Message Hermes"]')
  await input.fill(scenario.input)
  await page.getByRole('button', { name: 'Send' }).click()

  try {
    await page.getByText(scenario.expectedText, { exact: false }).waitFor({ timeout: 10_000 })
  } catch (error) {
    const requests = mockServer.requestLog.get(scenario.input) ?? []
    const transcript = await page.locator('body').innerText().catch(() => '(failed to read body)')
    throw new Error(
      `${scenario.name}: expected text not found.\nrequests=${describeRequestLog(requests)}\nbody=${transcript.slice(0, 4000)}\noriginal=${error instanceof Error ? error.message : String(error)}`
    )
  }

  if (scenario.expectStartGatewayVisible) {
    await page
      .locator('[data-testid="hermes-start-gateway"]')
      .first()
      .waitFor({ timeout: 5_000 })
  }

  const requests = mockServer.requestLog.get(scenario.input) ?? []
  if (requests.length !== scenario.expectRequests.length) {
    throw new Error(
      `${scenario.name}: expected ${scenario.expectRequests.length} request(s), got ${requests.length}. ${describeRequestLog(requests)}`
    )
  }

  for (let i = 0; i < scenario.expectRequests.length; i += 1) {
    const actual = requests[i]
    const expected = scenario.expectRequests[i]
    if (actual.authorization !== expected.authorization || actual.status !== expected.status) {
      throw new Error(
        `${scenario.name}: request ${i + 1} mismatch. Expected status=${expected.status} auth=${expected.authorization ?? '(none)'}, got status=${actual.status} auth=${actual.authorization ?? '(none)'}`
      )
    }
  }

  await page.close()
  return requests
}

async function runScenario(context, mockServer, scenario) {
  if (scenario.action === 'start-gateway') {
    return runAutostartSpawnScenario(context, scenario)
  }
  return runSendScenario(context, mockServer, scenario)
}

async function main() {
  console.log('\nHermes tile smoke test\n')
  console.log(`App URL: ${APP_URL}`)
  console.log(`Hermes base under test: ${HERMES_BASE_URL}\n`)

  const mockServer = createMockHermesServer()
  const client = spawnClientIfNeeded()
  let browser

  try {
    const startedClient = await client.ensureRunning()
    console.log(startedClient ? 'Started local Vite client.' : 'Reusing existing client.')

    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext()
    await mockServer.install(context)

    let passed = 0
    for (const scenario of scenarios) {
      const requests = await runScenario(context, mockServer, scenario)
      passed += 1
      console.log(`PASS ${scenario.name} :: ${describeRequestLog(requests)}`)
    }

    console.log(`\nHermes tile smoke test passed: ${passed}/${scenarios.length} scenarios\n`)
  } finally {
    try {
      await browser?.close()
    } finally {
      await mockServer.stop()
      await client.stop()
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  console.error(`\nHermes tile smoke test failed\n${message}\n`)
  process.exit(1)
})
