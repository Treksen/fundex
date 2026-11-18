// Runs the security tests against the REAL source files. Usage (from the project root): node tests/security/run.mjs
// The server function is TypeScript, so esbuild (already installed with Vite) turns it into plain JS for the test.
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { transformSync } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'nitalink-security-tests-'))
for (const f of ['passwordRules', 'passwordReset']) {
  writeFileSync(join(tmp, `${f}.mjs`), readFileSync(join(root, 'src', 'lib', `${f}.js`), 'utf8').replace("from './passwordRules'", "from './passwordRules.mjs'"))
}
writeFileSync(join(tmp, 'logic.mjs'), transformSync(readFileSync(join(root, 'supabase', 'functions', 'admin-create-member', 'logic.ts'), 'utf8'), { loader: 'ts', format: 'esm' }).code)
for (const t of ['reset.test.mjs', 'member-function.test.mjs']) copyFileSync(join(here, t), join(tmp, t))
for (const t of ['reset.test.mjs', 'member-function.test.mjs']) execFileSync(process.execPath, [join(tmp, t)], { stdio: 'inherit' })
console.log('\nAll security tests passed.')
