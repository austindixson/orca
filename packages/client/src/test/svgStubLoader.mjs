/**
 * Node test loader: Vite resolves image assets as URL strings; Node/tsx does not.
 * Stub common static asset imports as empty default exports for unit tests.
 *
 * @type {import('node:module').LoadHook}
 */
const ASSET_EXT = /\.(svg|png|jpe?g|gif|webp|ico)$/i

export async function load(url, context, nextLoad) {
  if (ASSET_EXT.test(url)) {
    return {
      format: 'module',
      shortCircuit: true,
      source: 'export default ""\n',
    }
  }
  return nextLoad(url, context, nextLoad)
}
