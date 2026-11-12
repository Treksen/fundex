// Runs the report tests against the REAL files in src/lib (copied to a temp folder as .mjs). Usage: node tests/reports/run.mjs
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'nitalink-report-tests-'))
for (const f of ['reportPeriod', 'reportModel', 'reportPdf', 'reportExcel', 'fetchAll', 'reportLoader']) {
  const src = readFileSync(join(root, 'src', 'lib', `${f}.js`), 'utf8').replace("from './fetchAll'", "from './fetchAll.mjs'")
  writeFileSync(join(tmp, `${f}.mjs`), src)
}
for (const f of ['fixtures.mjs', 'model.test.mjs', 'export.test.mjs']) copyFileSync(join(here, f), join(tmp, f))
for (const t of ['model.test.mjs', 'export.test.mjs']) {
  execFileSync(process.execPath, [join(tmp, t)], { stdio: 'inherit', env: { ...process.env, TZ: 'Africa/Nairobi' } })
}
console.log('\nAll report tests passed.')
