import fs from 'node:fs'

const file = 'packages/vite/src/node/config.ts'
let source = fs.readFileSync(file, 'utf8')

const importAnchor = "} from './build'\n"
const cloneImport = "import { cloneConfig } from './configClone'\n"

if (!source.includes(cloneImport)) {
  if (!source.includes(importAnchor)) {
    throw new Error('configClone import anchor was not found')
  }
  source = source.replace(importAnchor, importAnchor + cloneImport)
}

const oldEntry = '\n  let config = inlineConfig\n'
const newEntry = '\n  let config = cloneConfig(inlineConfig)\n'

if (!source.includes(newEntry)) {
  if (!source.includes(oldEntry)) {
    throw new Error('resolveConfig working-config assignment was not found')
  }
  source = source.replace(oldEntry, newEntry)
}

fs.writeFileSync(file, source)
