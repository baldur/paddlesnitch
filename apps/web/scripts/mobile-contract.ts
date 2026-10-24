// pnpm mobile:contract — regenerate mobile/contract/{api,tokens} for the apps.
// Run after changing a schema in packages/api/src/contract.ts or a token in
// packages/ui/src/tokens.css; the contract test fails until you do.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { mobileContractFiles } from '../src/lib/mobile-contract'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const out = path.join(root, 'mobile/contract')
const files = mobileContractFiles(fs.readFileSync(path.join(root, 'packages/ui/src/tokens.css'), 'utf8'))

// Generated folders are rewritten whole, so a removed type leaves no stale file.
for (const dir of ['api', 'tokens']) fs.rmSync(path.join(out, dir), { recursive: true, force: true })
for (const [name, content] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(out, name)), { recursive: true })
  fs.writeFileSync(path.join(out, name), content)
}
console.log(`wrote ${Object.keys(files).length} files to mobile/contract/`)
