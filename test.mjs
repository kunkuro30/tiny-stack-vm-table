// tablevm's test suite: builds tiny instances, runs main.ts on them the way
// the grader does (MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR), and compares
// stdout.bin and exit.txt with the answers worked out by hand from ISA.md.
// Run from the repository root: node test.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'tablevm-'))
const I = join(root, 'in'), O = join(root, 'out')
const put = (id, program, input = []) => {
  mkdirSync(join(I, id), { recursive: true })
  writeFileSync(join(I, id, 'program.bin'), Buffer.from(program))
  writeFileSync(join(I, id, 'input.bin'), Buffer.from(input))
}
// PUSH8 40, PUSH8 2, ADD, PRINT, HALT -> writes "42", exits 0
put('t1', [0x01, 40, 0x01, 2, 0x10, 0x50, 0x00])
// PUSH8 1, PUSH8 0, DIV -> trap 4 (division by zero), writes nothing
put('t2', [0x01, 1, 0x01, 0, 0x13])
// IN, PUTC, IN, PUTC, HALT on the input "Hi" -> echoes "Hi", exits 0
put('t3', [0x52, 0x51, 0x52, 0x51, 0x00], [72, 105])
// PUSH8 -1, EXIT -> exits 255, the low byte of -1
put('t4', [0x01, 0xFF, 0x53])
execFileSync(process.execPath, [new URL('./main.ts', import.meta.url).pathname],
  { env: { ...process.env, MAKEFUN_INPUT_DIR: I, MAKEFUN_OUTPUT_DIR: O }, stdio: 'inherit' })
let bad = 0
const eq = (id, stdout, code) => {
  const got = readFileSync(join(O, id, 'stdout.bin'), 'utf8')
  const exit = readFileSync(join(O, id, 'exit.txt'), 'utf8').trim()
  const ok = got === stdout && exit === '' + code
  if (!ok) bad++
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + id + ': stdout ' + JSON.stringify(got) + ', exit ' + exit)
}
eq('t1', '42', 0)
eq('t2', '', 4)
eq('t3', 'Hi', 0)
eq('t4', '', 255)
console.log(bad ? bad + ' test(s) failed' : 'all tests passed')
process.exit(bad ? 1 : 0)
