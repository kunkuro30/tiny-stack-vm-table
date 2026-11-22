// tablevm: a table-driven interpreter for make.fun's tiny stack ISA v1.
// A dispatch table maps each opcode byte to its handler; the handlers share
// the push/pop helpers, so traps fire in the ISA's order: step limit, pc out
// of range, unknown opcode, cut-off immediate, underflow, overflow, then the
// instruction's own trap. Values are 32-bit integers that wrap; the data
// stack holds 256 values, the call stack 64 return addresses, memory 256
// words; at most 1,000,000 steps and 65,536 output bytes per program.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const run = (P, B) => {
  const D = new Int32Array(256)   // data stack
  const C = new Int32Array(64)    // call stack
  const M = new Int32Array(256)   // memory
  let sp = 0, csp = 0, pc = 0, steps = 0, ip = 0
  const out = []
  const X = (code) => { throw code }              // every end is an exit code: halt, EXIT, or a trap's
  const need = (n) => { if (sp < n) X(2) }        // trap 2: stack underflow
  const push = (v) => { if (sp > 255) X(3); D[sp++] = v }   // trap 3: stack overflow
  const imm16 = () => P[pc - 2] | P[pc - 1] << 8            // the immediate, once pc is past it
  const rel = () => (imm16() << 16) >> 16                   // the same bytes as a signed offset
  const bin = (op) => {                             // the two-operand family: ( a b -- r )
    need(2)
    const b = D[sp - 1], a = D[sp - 2]
    let r
    if (op === 0x10) r = a + b | 0                  // ADD
    else if (op === 0x11) r = a - b | 0             // SUB
    else if (op === 0x12) r = Math.imul(a, b)       // MUL, the low 32 bits of the exact product
    else if (op === 0x13) { if (!b) X(4); r = a / b | 0 }   // DIV, truncated toward zero
    else if (op === 0x14) { if (!b) X(4); r = a % b | 0 }   // MOD, the sign of a
    else if (op === 0x15) { if (!b) X(4); r = Math.floor((a >>> 0) / (b >>> 0)) | 0 } // DIVU
    else if (op === 0x16) { if (!b) X(4); r = (a >>> 0) % (b >>> 0) | 0 }             // MODU
    else if (op === 0x18) r = a & b                 // AND
    else if (op === 0x19) r = a | b                 // OR
    else if (op === 0x1A) r = a ^ b                 // XOR
    else if (op === 0x1C) r = a << (b & 31)         // SHL, only the low 5 bits of the count
    else if (op === 0x1D) r = a >> (b & 31)         // SHR, arithmetic
    else if (op === 0x1E) r = a >>> (b & 31) | 0    // SHRU, logical
    else if (op === 0x20) r = a === b ? 1 : 0       // EQ
    else if (op === 0x21) r = a < b ? 1 : 0         // LT, signed
    else r = (a >>> 0) < (b >>> 0) ? 1 : 0          // LTU, unsigned
    D[sp - 2] = r
    sp--
  }
  const T = {
    0x00: () => X(0),                                                 // HALT
    0x01: () => push((P[pc - 1] << 24) >> 24),                        // PUSH8, sign-extended
    0x02: () => push(P[pc - 4] | P[pc - 3] << 8 | P[pc - 2] << 16 | P[pc - 1] << 24), // PUSH32
    0x03: () => { need(1); sp-- },                                    // POP
    0x04: () => { need(1); push(D[sp - 1]) },                         // DUP
    0x05: () => { need(2); const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t }, // SWAP
    0x06: () => { need(2); push(D[sp - 2]) },                         // OVER
    0x07: () => { need(3); const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a }, // ROT
    0x17: () => { need(1); D[sp - 1] = -D[sp - 1] | 0 },              // NEG, wraps
    0x1B: () => { need(1); D[sp - 1] = ~D[sp - 1] },                  // NOT
    0x30: () => { pc += rel() },                                      // JMP, from the next instruction
    0x31: () => { need(1); if (!D[--sp]) pc += rel() },               // JZ
    0x32: () => { need(1); if (D[--sp]) pc += rel() },                // JNZ
    0x33: () => { if (csp > 63) X(7); C[csp++] = pc; pc = imm16() },  // CALL, to an absolute address
    0x34: () => { if (!csp) X(8); pc = C[--csp] },                    // RET
    0x40: () => { need(1); const a = D[sp - 1]; if (a < 0 || a > 255) X(6); D[sp - 1] = M[a] }, // LOAD
    0x41: () => { need(2); const a = D[sp - 1]; if (a < 0 || a > 255) X(6); M[a] = D[sp - 2]; sp -= 2 }, // STORE
    0x50: () => { need(1); const s = '' + D[sp - 1]; if (out.length + s.length > 65536) X(11); sp--; for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i)) }, // PRINT, decimal
    0x51: () => { need(1); if (out.length > 65535) X(11); out.push(D[--sp] & 255) }, // PUTC, one byte
    0x52: () => push(ip < B.length ? B[ip++] : -1),                   // IN, -1 once the input is used up
    0x53: () => { need(1); X(D[sp - 1] & 255) },                      // EXIT, the low byte is the code
  }
  for (const o of [0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x18, 0x19, 0x1A, 0x1C, 0x1D, 0x1E, 0x20, 0x21, 0x22]) T[o] = bin
  const n = P.length
  try {
    for (;;) {
      if (steps >= 1e6) X(10)                       // trap 10: step limit
      if (pc < 0 || pc >= n) X(9)                   // trap 9: pc outside the program
      const op = P[pc], h = T[op]
      if (!h) X(5)                                  // trap 5: unknown opcode
      const im = op === 1 ? 1 : op === 2 ? 4 : op >= 0x30 && op <= 0x33 ? 2 : 0
      if (pc + im >= n) X(9)                        // trap 9: immediate cut off by the end
      steps++
      pc += 1 + im
      h(op)
    }
  } catch (e) {
    if (typeof e !== 'number') throw e
    return { out, code: e }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input'
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output'
for (const id of readdirSync(I).sort()) {
  const P = readFileSync(join(I, id, 'program.bin'))
  let B
  try { B = readFileSync(join(I, id, 'input.bin')) } catch { B = new Uint8Array(0) }
  const r = run(P, B)
  mkdirSync(join(O, id), { recursive: true })
  writeFileSync(join(O, id, 'stdout.bin'), Buffer.from(r.out))
  writeFileSync(join(O, id, 'exit.txt'), r.code + '\n')
}
