// tablevm's tests: tiny instances run through main.ts the way the grader
// runs it (MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR); stdout.bin and exit.txt
// are compared with answers worked out by hand from ISA.md. node test.mjs
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
// 40 + 2, PRINT, HALT -> "42", exit 0
put('t1', [0x01, 40, 0x01, 2, 0x10, 0x50, 0x00])
// PUSH8 1, PUSH8 0, DIV -> trap 4, no output
put('t2', [0x01, 1, 0x01, 0, 0x13])
// IN, PUTC twice on the input "Hi" -> echoes "Hi", exit 0
put('t3', [0x52, 0x51, 0x52, 0x51, 0x00], [72, 105])
// PUSH8 -1, EXIT -> 255, the low byte of -1
put('t4', [0x01, 0xFF, 0x53])
execFileSync(process.execPath, ['main.ts'],
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
