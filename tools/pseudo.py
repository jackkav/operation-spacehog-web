"""Tiny symbolic simplifier for -O0 DJGPP code: turns a function range of `objdump -M intel` output into readable pseudo-C.

usage: pseudo.py sh.asm START_HEX END_HEX [--raw-stack]
- registers hold symbolic values; affine forms (coef*atom + const) are tracked so `i*148 + 0xae6c8 + 0x78` becomes S[i].f78
- tables: S = enemy slots (0xae6c8, 148), E = formation emitters (0xccc68, 40), L = level records (0xaa088, 64)
- stack temporaries are inlined inside a basic block; stores to stack variables are kept only when read across blocks
"""
import re, sys

TABLES = [('S', 0xae6c8, 148, 50), ('E', 0xccc68, 40, 10), ('L', 0xaa088, 64, 400)]
GLOBALS = {}
rx = re.compile(r'^\s*([0-9a-f]+):\s+(?:[0-9a-f]{2} ?)+\s*\t(\S+)\s*(.*)$')
REGS = ['eax', 'ebx', 'ecx', 'edx', 'esi', 'edi', 'ebp']
SUB = {'al': 'eax', 'bl': 'ebx', 'cl': 'ecx', 'dl': 'edx', 'ax': 'eax', 'bx': 'ebx', 'cx': 'ecx', 'dx': 'edx', 'ah': 'eax', 'bh': 'ebx', 'ch': 'ecx', 'dh': 'edx'}


class V:                                          # affine value: coef*atom + const (atom None = pure constant)
    def __init__(s, atom=None, coef=1, const=0): s.atom, s.coef, s.const = atom, coef, const
    def is_const(s): return s.atom is None
    def __str__(s):
        if s.atom is None: return hex(s.const) if abs(s.const) > 9 else str(s.const)
        t = s.atom if s.coef == 1 else f'{s.coef}*{s.atom}'
        return t + (f' + {hex(s.const)}' if s.const > 0 else f' - {hex(-s.const)}' if s.const < 0 else '')


def const(n): return V(None, 0, n)
def opaque(t): return V(t, 1, 0)


def add(a, b, sign=1):
    if b.is_const(): return V(a.atom, a.coef, a.const + sign * b.const)
    if a.is_const(): return V(b.atom, sign * b.coef, a.const + sign * b.const) if sign == 1 else opaque(f'({a} - {b})')
    if a.atom == b.atom: return V(a.atom, a.coef + sign * b.coef, a.const + sign * b.const)
    return opaque(f'({a} {"+" if sign == 1 else "-"} {b})')


def mul(a, k):
    return const(a.const * k) if a.is_const() else V(a.atom, a.coef * k, a.const * k)


def addr_name(v, size):
    """Symbolic memory reference for an address value."""
    if v.is_const():
        return f'G{v.const:x}'
    for nm, base, stride, n in TABLES:
        if v.coef == stride and base <= v.const < base + stride:
            return f'{nm}[{v.atom}].f{v.const - base:x}'
        if v.coef == stride and base <= v.const < base + stride * n:
            k, off = divmod(v.const - base, stride)
            return f'{nm}[{v.atom}+{k}].f{off:x}'
    return f'*({v})'


def main(path, lo, hi, raw_stack=False):
    ins = []
    for ln in open(path):
        m = rx.match(ln)
        if not m: continue
        a = int(m.group(1), 16)
        if a < lo: continue
        if a >= hi: break
        ins.append((a, m.group(2), m.group(3).strip()))
    targets = set()
    for a, op, rest in ins:
        if op.startswith('j'):
            mm = re.match(r'(0x[0-9a-f]+)', rest)
            if mm: targets.add(int(mm.group(1), 16))
    out = []; regs = {}; temps = {}; delta = 0; pushed = []; cmp = None; blk = 0
    stack_written = {}; stack_needed = set()
    reg0 = lambda r: regs.get(SUB.get(r, r), opaque(SUB.get(r, r)))

    def parse_operand(o, size=4):
        o = o.strip()
        mm = re.match(r'(?:(byte|word|dword) ptr )?\[(.*)\]$', o)
        if mm:
            sz = {'byte': 1, 'word': 2, 'dword': 4, None: 4}[mm.group(1)]
            expr = mm.group(2); val = const(0)
            for part in re.split(r'\s*\+\s*', expr.replace(' - ', ' + -')):
                part = part.strip()
                mp = re.match(r'(\d+)\*(\w+)$', part)
                if mp: val = add(val, mul(reg0(mp.group(2)), int(mp.group(1))))
                elif part in REGS or part in SUB: val = add(val, reg0(part))
                elif re.match(r'-?0x[0-9a-f]+$', part): val = add(val, const(int(part, 16)))
                elif re.match(r'-?\d+$', part): val = add(val, const(int(part)))
                elif part.startswith('esp'): val = add(val, opaque('ESP'))
                else: val = add(val, opaque(part))
            return ('mem', val, sz)
        if o == 'esp': return ('reg', 'esp', 4)
        if o in REGS or o in SUB: return ('reg', SUB.get(o, o), 4)
        if re.match(r'-?0x[0-9a-f]+$', o): return ('imm', const(int(o, 16)), 4)
        if re.match(r'-?\d+$', o): return ('imm', const(int(o)), 4)
        return ('imm', opaque(o), 4)

    def stack_ref(val):
        """if val is esp+K: name of the stack slot"""
        if val.atom == 'ESP':
            off = val.const - delta - 4 if False else val.const - delta
            return ('arg%x' % (off - 4)) if off >= 4 else ('v%x' % -off)
        return None

    def read(o):
        k, v, sz = parse_operand(o)
        if k == 'reg': return reg0(v)
        if k == 'imm': return v
        sr = stack_ref(v)
        if sr:
            if sr in temps: return temps[sr]
            stack_needed.add(sr); return opaque(sr)
        nm = addr_name(v, sz)
        return opaque(nm if sz == 4 else f'{"u8" if sz == 1 else "u16"}({nm})')

    def emit(a, s): out.append((a, s))

    for a, op, rest in ins:
        if a in targets:
            out.append((a, f'L{a:x}:')); regs = {}; temps = {}; cmp = None
        ops = [x.strip() for x in re.split(r',(?![^\[]*\])', rest)] if rest else []
        if op in ('mov', 'movzx', 'movsx'):
            dst = parse_operand(ops[0]); val = read(ops[1])
            if dst[0] == 'reg': regs[dst[1]] = val
            else:
                sr = stack_ref(dst[1])
                if sr:
                    temps[sr] = val
                    out.append((a, f'#{sr} = {val}'))
                else: emit(a, f'{addr_name(dst[1], dst[2])} = {val};')
        elif op == 'lea':
            dst = parse_operand(ops[0]); k, v, sz = parse_operand(ops[1].replace('dword ptr ', ''))
            regs[dst[1]] = v
        elif op in ('add', 'sub'):
            d = parse_operand(ops[0])
            if d[0] == 'reg' and d[1] == 'esp': delta += (1 if op == 'sub' else -1) * int(ops[1], 0); pushed = [] if op == 'add' else pushed; continue
            b = read(ops[1]); sign = 1 if op == 'add' else -1
            if d[0] == 'reg': regs[d[1]] = add(reg0(d[1]), b, sign)
            else:
                sr = stack_ref(d[1])
                if sr: temps[sr] = add(read(ops[0]), b, sign); out.append((a, f'#{sr} {op}= {b}'))
                else: emit(a, f'{addr_name(d[1], d[2])} {"+=" if op == "add" else "-="} {b};')
        elif op in ('inc', 'dec'):
            d = parse_operand(ops[0])
            if d[0] == 'reg': regs[d[1]] = add(reg0(d[1]), const(1), 1 if op == 'inc' else -1)
            else:
                sr = stack_ref(d[1])
                if sr: temps[sr] = add(read(ops[0]), const(1), 1 if op == 'inc' else -1); out.append((a, f'#{sr}{"++" if op == "inc" else "--"}'))
                else: emit(a, f'{addr_name(d[1], d[2])}{"++" if op == "inc" else "--"};')
        elif op in ('shl', 'sal'):
            d = parse_operand(ops[0]); k = int(ops[1], 0)
            if d[0] == 'reg': regs[d[1]] = mul(reg0(d[1]), 1 << k)
            else: sr = stack_ref(d[1]); temps[sr] = mul(read(ops[0]), 1 << k) if sr else None
        elif op == 'imul':
            if len(ops) == 2: d = parse_operand(ops[0]); regs[d[1]] = opaque(f'({reg0(d[1])} * {read(ops[1])})') if not read(ops[1]).is_const() else mul(reg0(d[1]), read(ops[1]).const)
            else: d = parse_operand(ops[0]); regs[d[1]] = mul(read(ops[1]), read(ops[2]).const)
        elif op in ('and', 'or', 'xor', 'sar', 'shr', 'neg', 'not'):
            d = parse_operand(ops[0])
            sym = {'and': '&', 'or': '|', 'xor': '^', 'sar': '>>', 'shr': '>>'}.get(op)
            if d[0] == 'reg':
                regs[d[1]] = opaque(f'({reg0(d[1])} {sym} {read(ops[1])})') if sym else opaque(f'{op}({reg0(d[1])})')
            else: emit(a, f'{addr_name(d[1], d[2])} {sym}= {read(ops[1])};' if sym else f'{op} {ops[0]}')
        elif op == 'push': pushed.append(read(ops[0])); delta += 4
        elif op == 'pop': dst = parse_operand(ops[0]); regs[dst[1]] = opaque('popped'); delta -= 4
        elif op in ('cmp', 'test'):
            x = read(ops[0]); y = read(ops[1]) if op == 'cmp' else const(0)
            if op == 'test' and ops[0] == ops[1]: y = const(0)
            cmp = (x, y, op)
        elif op.startswith('j'):
            mm = re.match(r'(0x[0-9a-f]+)', rest); t = int(mm.group(1), 16) if mm else 0
            if op == 'jmp': emit(a, f'goto L{t:x};'); regs = {}; temps = {}; cmp = None
            elif cmp:
                x, y, kind = cmp
                if kind == 'test' and ops and False: pass
                sym = {'je': '==', 'jne': '!=', 'jl': '<', 'jle': '<=', 'jg': '>', 'jge': '>=', 'jb': '<u', 'jbe': '<=u', 'ja': '>u', 'jae': '>=u', 'js': '<0', 'jns': '>=0'}.get(op, op)
                emit(a, f'if ({x} {sym} {y}) goto L{t:x};')
        elif op == 'call':
            mm = re.match(r'(0x[0-9a-f]+)', rest); t = int(mm.group(1), 16) if mm else 0
            args = ', '.join(str(x) for x in reversed(pushed)); pushed = []
            regs['eax'] = opaque(f'f{t:x}({args})'); emit(a, f'call f{t:x}({args});')
        elif op in ('ret', 'nop', 'cld', 'cdq', 'xchg', 'leave'):
            if op == 'ret': emit(a, 'return;')
            elif op == 'cdq': pass
        elif op.startswith('rep') or op.startswith('movs') or op.startswith('stos'): emit(a, f'# {op} {rest}')
        else: emit(a, f'# ?? {op} {rest}')
    # drop stack-variable assignments that nobody reads across blocks
    for a, s in out:
        if s.startswith('#'):
            var = s[1:].split()[0].rstrip('+-')
            mv = re.match(r'(arg[0-9a-f]+|v[0-9a-f]+)', var); var = mv.group(1) if mv else var
            if raw_stack or var in stack_needed: print(f'{a:x}  {s[1:]};')
        else: print(f'{a:x}  {s}')


if __name__ == '__main__':
    main(sys.argv[1], int(sys.argv[2], 16), int(sys.argv[3], 16), '--raw-stack' in sys.argv)
