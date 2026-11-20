import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '../..')
const apiDirectory = path.join(repositoryRoot, 'apps', 'api')
const pythonExecutable =
  process.platform === 'win32'
    ? path.join(apiDirectory, '.venv', 'Scripts', 'python.exe')
    : path.join(apiDirectory, '.venv', 'bin', 'python')
const generator = path.join(scriptDirectory, 'openapi_codegen.py')

if (!existsSync(pythonExecutable)) {
  console.error(
    `API virtual environment Python was not found: ${pythonExecutable}`
  )
  process.exit(1)
}

const result = spawnSync(pythonExecutable, [generator, ...process.argv.slice(2)], {
  cwd: repositoryRoot,
  stdio: 'inherit',
  windowsHide: true,
})

if (result.error) {
  console.error(`Could not run OpenAPI generator: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
