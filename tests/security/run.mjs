// Runs the security tests against the REAL source files. Usage (from the project root): node tests/security/run.mjs
// The server functions are TypeScript. esbuild (installed with Vite) turns them into plain JS; if esbuild is not
// installed, Node's built-in type stripping (Node 22.13+) is used instead.
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
const root = resolve(here, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'nitalink-security-tests-'))
for (const f of ['passwordRules', 'passwordReset', 'memberAdmin']) {
  writeFileSync(join(tmp, `${f}.mjs`), readFileSync(join(root, 'src', 'lib', `${f}.js`), 'utf8').replace("from './passwordRules'", "from './passwordRules.mjs'"))
}
writeFileSync(join(tmp, 'logic.mjs'), toJs(readFileSync(join(root, 'supabase', 'functions', 'admin-create-member', 'logic.ts'), 'utf8')))
writeFileSync(join(tmp, 'manage-logic.mjs'), toJs(readFileSync(join(root, 'supabase', 'functions', 'admin-manage-member', 'logic.ts'), 'utf8')))
const tests = ['reset.test.mjs', 'member-function.test.mjs', 'manage-member.test.mjs', 'member-admin-ui.test.mjs']
for (const t of tests) copyFileSync(join(here, t), join(tmp, t))
for (const t of tests) execFileSync(process.execPath, [join(tmp, t)], { stdio: 'inherit' })
console.log('\nAll security tests passed.')
