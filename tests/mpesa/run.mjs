// M-Pesa tests against the REAL source. Usage (from the project root): node tests/mpesa/run.mjs
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { stripTypeScriptTypes } from 'node:module'

let toJs
try {
  const { transformSync } = await import('esbuild')
  toJs = (src) => transformSync(src, { loader: 'ts', format: 'esm' }).code
} catch {
  if (typeof stripTypeScriptTypes !== 'function') throw new Error('Install dependencies (npm install) or use Node 22.13+')
  toJs = (src) => stripTypeScriptTypes(src)
}
const here = dirname(fileURLToPath(import.meta.url))
const fn = resolve(here, '..', '..', 'supabase', 'functions')
const tmp = mkdtempSync(join(tmpdir(), 'nitalink-mpesa-tests-'))
const fix = (s) => s.replaceAll("'../_shared/mpesa.ts'", "'./shared.mjs'")
writeFileSync(join(tmp, 'shared.mjs'), toJs(readFileSync(join(fn, '_shared', 'mpesa.ts'), 'utf8')))
writeFileSync(join(tmp, 'stk.mjs'), fix(toJs(readFileSync(join(fn, 'mpesa-stk-push', 'logic.ts'), 'utf8'))))
writeFileSync(join(tmp, 'callback.mjs'), fix(toJs(readFileSync(join(fn, 'mpesa-callback', 'logic.ts'), 'utf8'))))
copyFileSync(join(here, 'mpesa.test.mjs'), join(tmp, 'mpesa.test.mjs'))
execFileSync(process.execPath, ['--no-warnings', join(tmp, 'mpesa.test.mjs')], { stdio: 'inherit' })
