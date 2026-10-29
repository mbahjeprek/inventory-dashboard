// Formula engine of the Budgeting workbook: evaluates the Excel formulas of its sheets the way Excel does (cell / range
// references across sheets, + - * / ^ & % and comparisons, SUM / SUMIF / IFERROR and the other common functions,
// errors like #DIV/0! / #REF! / #VALUE! passed along). Values are computed lazily and kept until something changes.
// A reference to another Excel file ([4]GC0400!N26) reads from the workbook's "data dari file lain" table instead.

export type ErrCode = "#REF!" | "#DIV/0!" | "#VALUE!" | "#N/A" | "#NAME?" | "#NUM!" | "#NULL!" | "#ERROR!";
export class XErr {
  code: ErrCode;
  constructor(code: ErrCode) {
    this.code = code;
  }
  toString() {
    return this.code;
  }
}
export type Val = number | string | boolean | null | XErr;
export const isErr = (v: unknown): v is XErr => v instanceof XErr;
const ERR = (c: ErrCode) => new XErr(c);
const ERR_CODES = ["#REF!", "#DIV/0!", "#VALUE!", "#N/A", "#NAME?", "#NUM!", "#NULL!", "#ERROR!"];

// ---- cell addresses ----
export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
export function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
export const addr = (r: number, c: number) => `${colLetter(c)}${r}`;
export function parseAddr(a: string): { r: number; c: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(a);
  return m ? { r: Number(m[2]), c: colIndex(m[1]) } : null;
}

// ---- tokens / AST ----
type Node =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "err"; v: ErrCode }
  | { t: "ref"; sheet: string | null; r: number; c: number }
  | { t: "range"; sheet: string | null; r1: number; c1: number; r2: number; c2: number }
  | { t: "ext"; key: string }
  | { t: "fn"; name: string; args: Node[] }
  | { t: "un"; op: string; a: Node }
  | { t: "pct"; a: Node }
  | { t: "bin"; op: string; a: Node; b: Node };

type Tok = { k: "num" | "str" | "ref" | "fn" | "op" | "lp" | "rp" | "comma" | "err" | "bool"; v: string };

const REF_RE = /^(?:(?:'((?:[^']|'')+)'|(\[\d+\][^!'\s(),]*|[A-Za-z_][A-Za-z0-9_.]*))!)?(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?|#REF!)/;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\n" || ch === "\t") {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let s = "";
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            s += '"';
            j += 2;
            continue;
          }
          break;
        }
        s += src[j++];
      }
      out.push({ k: "str", v: s });
      i = j + 1;
      continue;
    }
    if (ch === "#") {
      const e = ERR_CODES.find((c) => src.startsWith(c, i));
      if (e) {
        out.push({ k: "err", v: e });
        i += e.length;
        continue;
      }
    }
    const num = /^(\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    // a number - unless it's the start of a reference like 1:1 (not used here)
    if (num && !/^[A-Za-z]/.test(src.slice(i + num[0].length, i + num[0].length + 1))) {
      out.push({ k: "num", v: num[0] });
      i += num[0].length;
      continue;
    }
    const ref = REF_RE.exec(src.slice(i));
    if (ref && !(src[i + ref[0].length] === "(")) {
      out.push({ k: "ref", v: ref[0] });
      i += ref[0].length;
      continue;
    }
    const fn = /^([A-Za-z_][A-Za-z0-9_.]*)\s*\(/.exec(src.slice(i));
    if (fn) {
      out.push({ k: "fn", v: fn[1].toUpperCase() });
      i += fn[0].length;
      continue;
    }
    const word = /^(TRUE|FALSE)\b/i.exec(src.slice(i));
    if (word) {
      out.push({ k: "bool", v: word[1].toUpperCase() });
      i += word[0].length;
      continue;
    }
    const op = /^(<>|<=|>=|[-+*/^&=<>%])/.exec(src.slice(i));
    if (op) {
      out.push({ k: "op", v: op[1] });
      i += op[1].length;
      continue;
    }
    if (ch === "(") out.push({ k: "lp", v: ch });
    else if (ch === ")") out.push({ k: "rp", v: ch });
    else if (ch === "," || ch === ";") out.push({ k: "comma", v: "," });
    else throw new Error(`Karakter tidak dikenal "${ch}"`);
    i++;
  }
  return out;
}

function refNode(text: string): Node {
  const m = REF_RE.exec(text)!;
  const sheetRaw = m[1] !== undefined ? m[1].replace(/''/g, "'") : (m[2] ?? null);
  const body = m[3];
  if (sheetRaw && /^\[\d+\]/.test(sheetRaw)) return { t: "ext", key: `${sheetRaw}!${body.replace(/\$/g, "")}` };
  if (body === "#REF!") return { t: "err", v: "#REF!" };
  const [a, b] = body.split(":");
  const p1 = parseAddr(a)!;
  if (!b) return { t: "ref", sheet: sheetRaw, r: p1.r, c: p1.c };
  const p2 = parseAddr(b)!;
  return { t: "range", sheet: sheetRaw, r1: Math.min(p1.r, p2.r), c1: Math.min(p1.c, p2.c), r2: Math.max(p1.r, p2.r), c2: Math.max(p1.c, p2.c) };
}

// Precedence: comparison < & < + - < * / < ^ < unary - < %
const PREC: Record<string, number> = { "=": 1, "<>": 1, "<": 1, ">": 1, "<=": 1, ">=": 1, "&": 2, "+": 3, "-": 3, "*": 4, "/": 4, "^": 5 };

export function parseFormula(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const expr = (minPrec: number): Node => {
    let left = unary();
    for (;;) {
      const t = peek();
      if (!t || t.k !== "op" || !(t.v in PREC) || PREC[t.v] < minPrec) break;
      p++;
      const prec = PREC[t.v];
      const right = expr(t.v === "^" ? prec : prec + 1);
      left = { t: "bin", op: t.v, a: left, b: right };
    }
    return left;
  };
  const unary = (): Node => {
    const t = peek();
    if (t && t.k === "op" && (t.v === "-" || t.v === "+")) {
      p++;
      const a = unary();
      return t.v === "-" ? { t: "un", op: "-", a } : a;
    }
    return postfix(primary());
  };
  const postfix = (n: Node): Node => {
    while (peek() && peek().k === "op" && peek().v === "%") {
      p++;
      n = { t: "pct", a: n };
    }
    return n;
  };
  const primary = (): Node => {
    const t = toks[p++];
    if (!t) throw new Error("Rumus tidak lengkap");
    if (t.k === "num") return { t: "num", v: Number(t.v) };
    if (t.k === "str") return { t: "str", v: t.v };
    if (t.k === "bool") return { t: "bool", v: t.v === "TRUE" };
    if (t.k === "err") return { t: "err", v: t.v as ErrCode };
    if (t.k === "ref") return refNode(t.v);
    if (t.k === "lp") {
      const e = expr(1);
      if (peek()?.k !== "rp") throw new Error("Kurung tutup kurang");
      p++;
      return e;
    }
    if (t.k === "fn") {
      const args: Node[] = [];
      if (peek()?.k === "rp") {
        p++;
        return { t: "fn", name: t.v, args };
      }
      for (;;) {
        // an empty argument (,,) counts as blank
        if (peek()?.k === "comma" || peek()?.k === "rp") args.push({ t: "str", v: "" });
        else args.push(expr(1));
        const n = toks[p++];
        if (!n) throw new Error("Kurung tutup kurang");
        if (n.k === "rp") break;
        if (n.k !== "comma") throw new Error("Pemisah argumen salah");
      }
      return { t: "fn", name: t.v, args };
    }
    throw new Error(`Tidak terduga: ${t.v}`);
  };
  const n = expr(1);
  if (p < toks.length) throw new Error(`Tidak terduga: ${toks[p].v}`);
  return n;
}

// ---- workbook model ----
export type CellDef = { v?: Val; f?: string };
export type SheetModel = { name: string; maxr: number; maxc: number; cells: Map<string, CellDef> };

type Range = { range: true; sheet: string; r1: number; c1: number; r2: number; c2: number };
type Arg = Val | Range;

const num = (v: Val): number | XErr => {
  if (v === null || v === "") return v === "" ? ERR("#VALUE!") : 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (isErr(v)) return v;
  const t = v.trim().replace(/,/g, "");
  if (t !== "" && !Number.isNaN(Number(t))) return Number(t);
  if (/^-?\d+(\.\d+)?%$/.test(t)) return Number(t.slice(0, -1)) / 100;
  return ERR("#VALUE!");
};
const text = (v: Val): string => (v === null ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : typeof v === "number" ? String(Math.round(v * 1e10) / 1e10) : String(v));

// Excel compare: blank = 0 = ""; numbers < text < booleans; text case-insensitive.
function cmp(a: Val, b: Val): number {
  const rank = (v: Val) => (typeof v === "number" ? 0 : typeof v === "string" ? 1 : 2);
  if (a === null) a = typeof b === "string" ? "" : typeof b === "boolean" ? false : 0;
  if (b === null) b = typeof a === "string" ? "" : typeof a === "boolean" ? false : 0;
  const ra = rank(a),
    rb = rank(b);
  if (ra !== rb) return ra - rb;
  // numbers compare at 15 significant digits, as Excel does (9277609.157380179 <> 9277609.157380186, but sums that
  // differ only in the 16th digit are equal)
  if (typeof a === "number" && typeof b === "number") {
    const x = Number(a.toPrecision(15)),
      y = Number(b.toPrecision(15));
    return x === y ? 0 : x < y ? -1 : 1;
  }
  if (typeof a === "string" && typeof b === "string") {
    const x = a.toLowerCase(),
      y = b.toLowerCase();
    return x === y ? 0 : x < y ? -1 : 1;
  }
  return Number(a) - Number(b);
}

// SUMIF / COUNTIF criteria: a number, or text with an optional operator and * ? wildcards.
function matcher(crit: Val): (v: Val) => boolean {
  if (typeof crit === "number" || typeof crit === "boolean") return (v) => v !== null && cmp(v, crit) === 0;
  const s = crit === null ? "" : String(crit);
  const m = /^(<>|<=|>=|=|<|>)?(.*)$/s.exec(s)!;
  const op = m[1] ?? "=";
  const rest = m[2];
  const n = rest.trim() !== "" && !Number.isNaN(Number(rest)) ? Number(rest) : null;
  if (n !== null) {
    return (v) => {
      if (typeof v !== "number") return op === "<>" ? true : false;
      const c = cmp(v, n);
      return op === "=" ? c === 0 : op === "<>" ? c !== 0 : op === "<" ? c < 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : c >= 0;
    };
  }
  if (op === "=" || op === "<>") {
    if (rest === "") return op === "=" ? (v) => v === null || v === "" : (v) => !(v === null || v === "");
    const re = new RegExp("^" + rest.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/~\*/g, "\u0001").replace(/~\?/g, "\u0002").replace(/\*/g, ".*").replace(/\?/g, ".").replace(/\u0001/g, "\\*").replace(/\u0002/g, "\\?") + "$", "is");
    return op === "=" ? (v) => typeof v === "string" && re.test(v) : (v) => !(typeof v === "string" && re.test(v));
  }
  return (v) => {
    if (typeof v !== "string") return false;
    const c = cmp(v, rest);
    return op === "<" ? c < 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : c >= 0;
  };
}

// Excel keeps 15 significant digits: a sum / difference that is 0 within them shows as 0 (not -0.0000076).
const snap = (r: number, x: number, y: number) => (r !== 0 && Math.abs(r) < Math.max(Math.abs(x), Math.abs(y)) * 1e-14 ? 0 : r);
const roundTo = (x: number, d: number, mode: "half" | "up" | "down") => {
  const f = Math.pow(10, d);
  const y = x * f;
  const r = mode === "half" ? Math.sign(y) * Math.round(Math.abs(y) + 1e-9) : mode === "up" ? Math.sign(y) * Math.ceil(Math.abs(y) - 1e-9) : Math.sign(y) * Math.floor(Math.abs(y) + 1e-9);
  return r / f;
};

export class Workbook {
  sheets = new Map<string, SheetModel>();
  private lower = new Map<string, string>();
  private cache = new Map<string, Val>();
  private busy = new Set<string>();
  private ast = new Map<string, Node | Error>();
  // values of references to other Excel files, by key "[4]GC0400!N26"; one not filled in counts as blank (or, with
  // linkKosongError, as #REF! - what Excel shows without the other file)
  links = new Map<string, Val>();
  linkKosongError = false;
  // the external references a formula reached while the last recalculation ran (for the "perlu diisi" list)
  usedLinks = new Set<string>();

  addSheet(s: SheetModel) {
    this.sheets.set(s.name, s);
    this.lower.set(s.name.toLowerCase(), s.name);
  }
  sheetName(n: string | null, from: string): string | null {
    if (n === null) return from;
    return this.lower.get(n.toLowerCase()) ?? null;
  }
  invalidate() {
    this.cache.clear();
    this.usedLinks.clear();
  }
  setCell(sheet: string, a: string, def: CellDef | null) {
    const s = this.sheets.get(sheet);
    if (!s) return;
    if (def === null) s.cells.delete(a);
    else s.cells.set(a, def);
    const p = parseAddr(a);
    if (p) {
      s.maxr = Math.max(s.maxr, p.r);
      s.maxc = Math.max(s.maxc, p.c);
    }
  }
  parsed(f: string): Node | Error {
    let n = this.ast.get(f);
    if (!n) {
      try {
        n = parseFormula(f);
      } catch (e) {
        n = e instanceof Error ? e : new Error(String(e));
      }
      this.ast.set(f, n);
    }
    return n;
  }

  // The value of a cell (a formula is evaluated; a loop counts as 0, as Excel shows it).
  value(sheet: string, r: number, c: number): Val {
    const key = `${sheet}\u0000${r}\u0000${c}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    const s = this.sheets.get(sheet);
    const d = s?.cells.get(addr(r, c));
    if (!d) return null;
    if (d.f === undefined) {
      const v = d.v ?? null;
      return typeof v === "string" && ERR_CODES.includes(v) ? ERR(v as ErrCode) : v;
    }
    if (this.busy.has(key)) return 0;
    this.busy.add(key);
    let out: Val;
    try {
      const n = this.parsed(d.f);
      if (n instanceof Error) out = ERR("#NAME?");
      else {
        const v = this.ev(n, sheet);
        out = isRange(v) ? this.single(v) : v;
        if (out === null) out = 0;
      }
    } catch {
      out = ERR("#VALUE!");
    }
    this.busy.delete(key);
    this.cache.set(key, out);
    return out;
  }

  private single(r: Range): Val {
    // a range used as a single value: its top-left cell (implicit intersection is not needed in these sheets)
    if (r.r1 === r.r2 && r.c1 === r.c2) return this.value(r.sheet, r.r1, r.c1);
    return ERR("#VALUE!");
  }
  private *cellsOf(r: Range): Generator<Val> {
    const s = this.sheets.get(r.sheet);
    if (!s) return;
    const r2 = Math.min(r.r2, s.maxr),
      c2 = Math.min(r.c2, s.maxc);
    for (let i = r.r1; i <= r2; i++) for (let j = r.c1; j <= c2; j++) yield this.value(r.sheet, i, j);
  }
  private flat(args: Arg[], fromRange: (v: Val) => void, direct: (v: Val) => void) {
    for (const a of args) {
      if (isRange(a)) for (const v of this.cellsOf(a)) fromRange(v);
      else direct(a);
    }
  }

  private ev(n: Node, sheet: string): Arg {
    switch (n.t) {
      case "num":
        return n.v;
      case "str":
        return n.v;
      case "bool":
        return n.v;
      case "err":
        return ERR(n.v);
      case "ext": {
        this.usedLinks.add(n.key);
        return this.links.has(n.key) ? this.links.get(n.key)! : this.linkKosongError ? ERR("#REF!") : null;
      }
      case "ref": {
        const sh = this.sheetName(n.sheet, sheet);
        if (!sh) return ERR("#REF!");
        return this.value(sh, n.r, n.c);
      }
      case "range": {
        const sh = this.sheetName(n.sheet, sheet);
        if (!sh) return ERR("#REF!");
        return { range: true, sheet: sh, r1: n.r1, c1: n.c1, r2: n.r2, c2: n.c2 };
      }
      case "un": {
        const v = num(this.val(n.a, sheet));
        return isErr(v) ? v : -v;
      }
      case "pct": {
        const v = num(this.val(n.a, sheet));
        return isErr(v) ? v : v / 100;
      }
      case "bin": {
        const a = this.val(n.a, sheet);
        const b = this.val(n.b, sheet);
        if (n.op === "&") {
          if (isErr(a)) return a;
          if (isErr(b)) return b;
          return text(a) + text(b);
        }
        if (["=", "<>", "<", ">", "<=", ">="].includes(n.op)) {
          if (isErr(a)) return a;
          if (isErr(b)) return b;
          const c = cmp(a, b);
          return n.op === "=" ? c === 0 : n.op === "<>" ? c !== 0 : n.op === "<" ? c < 0 : n.op === ">" ? c > 0 : n.op === "<=" ? c <= 0 : c >= 0;
        }
        const x = num(a);
        if (isErr(x)) return x;
        const y = num(b);
        if (isErr(y)) return y;
        switch (n.op) {
          case "+":
            return snap(x + y, x, y);
          case "-":
            return snap(x - y, x, y);
          case "*":
            return x * y;
          case "/":
            return y === 0 ? ERR("#DIV/0!") : x / y;
          case "^": {
            const r = Math.pow(x, y);
            return Number.isFinite(r) ? r : ERR("#NUM!");
          }
        }
        return ERR("#VALUE!");
      }
      case "fn":
        return this.call(n.name, n.args, sheet);
    }
  }
  private val(n: Node, sheet: string): Val {
    const v = this.ev(n, sheet);
    return isRange(v) ? this.single(v) : v;
  }

  private call(name: string, args: Node[], sheet: string): Arg {
    const A = () => args.map((a) => this.ev(a, sheet));
    const V = (i: number): Val => (args[i] ? this.val(args[i], sheet) : null);
    switch (name) {
      case "IFERROR": {
        const v = V(0);
        return isErr(v) ? V(1) : v;
      }
      case "IFNA": {
        const v = V(0);
        return isErr(v) && v.code === "#N/A" ? V(1) : v;
      }
      case "ISERROR":
        return isErr(V(0));
      case "ISBLANK":
        return V(0) === null;
      case "ISNUMBER":
        return typeof V(0) === "number";
      case "IF": {
        const c = V(0);
        if (isErr(c)) return c;
        const t = typeof c === "string" ? (c.toUpperCase() === "TRUE" ? true : c.toUpperCase() === "FALSE" ? false : null) : Boolean(c === null ? 0 : num(c));
        if (t === null) return ERR("#VALUE!");
        return t ? (args.length > 1 ? this.ev(args[1], sheet) : true) : args.length > 2 ? this.ev(args[2], sheet) : false;
      }
      case "AND":
      case "OR": {
        let any = false,
          all = true;
        let err: XErr | null = null;
        this.flat(
          A(),
          (v) => {
            if (typeof v === "number" || typeof v === "boolean") {
              any = any || Boolean(v);
              all = all && Boolean(v);
            } else if (isErr(v)) err = err ?? v;
          },
          (v) => {
            if (isErr(v)) err = err ?? v;
            else {
              const x = typeof v === "boolean" ? v : Boolean(num(v));
              any = any || x;
              all = all && x;
            }
          }
        );
        if (err) return err;
        return name === "AND" ? all : any;
      }
      case "NOT": {
        const v = V(0);
        return isErr(v) ? v : !(typeof v === "boolean" ? v : Boolean(num(v)));
      }
      case "SUM":
      case "AVERAGE":
      case "MIN":
      case "MAX":
      case "COUNT":
      case "PRODUCT": {
        const nums: number[] = [];
        let err: XErr | null = null;
        this.flat(
          A(),
          (v) => {
            if (typeof v === "number") nums.push(v);
            else if (isErr(v)) err = err ?? v;
          },
          (v) => {
            if (isErr(v)) err = err ?? v;
            else if (name === "COUNT") {
              if (typeof v === "number" || (typeof v === "string" && !isErr(num(v)) && v.trim() !== "")) nums.push(0);
            } else if (v !== null) {
              const x = num(v);
              if (isErr(x)) err = err ?? x;
              else nums.push(x);
            }
          }
        );
        if (name === "COUNT") return nums.length;
        if (err) return err;
        if (name === "SUM") return nums.reduce((s, x) => s + x, 0);
        if (name === "PRODUCT") return nums.length ? nums.reduce((s, x) => s * x, 1) : 0;
        if (name === "AVERAGE") return nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : ERR("#DIV/0!");
        if (!nums.length) return 0;
        return name === "MIN" ? Math.min(...nums) : Math.max(...nums);
      }
      case "COUNTA": {
        let n = 0;
        this.flat(
          A(),
          (v) => {
            if (v !== null) n++;
          },
          () => n++
        );
        return n;
      }
      case "COUNTBLANK": {
        let n = 0;
        this.flat(
          A(),
          (v) => {
            if (v === null || v === "") n++;
          },
          () => {}
        );
        return n;
      }
      case "SUMIF":
      case "COUNTIF":
      case "AVERAGEIF": {
        const rg = this.ev(args[0], sheet);
        if (!isRange(rg)) return isErr(rg) ? rg : ERR("#VALUE!");
        const crit = V(1);
        if (isErr(crit)) return crit;
        const ok = matcher(crit);
        const sr0 = name === "COUNTIF" ? null : args[2] ? this.ev(args[2], sheet) : rg;
        if (sr0 !== null && !isRange(sr0)) return isErr(sr0) ? sr0 : ERR("#VALUE!");
        let total = 0,
          count = 0;
        for (let i = rg.r1; i <= Math.min(rg.r2, this.sheets.get(rg.sheet)?.maxr ?? 0); i++)
          for (let j = rg.c1; j <= Math.min(rg.c2, this.sheets.get(rg.sheet)?.maxc ?? 0); j++) {
            if (!ok(this.value(rg.sheet, i, j))) continue;
            count++;
            if (sr0) {
              const v = this.value(sr0.sheet, sr0.r1 + (i - rg.r1), sr0.c1 + (j - rg.c1));
              if (isErr(v)) return v;
              if (typeof v === "number") total += v;
            }
          }
        if (name === "COUNTIF") return count;
        if (name === "SUMIF") return total;
        return count ? total / count : ERR("#DIV/0!");
      }
      case "SUMIFS":
      case "COUNTIFS": {
        const first = name === "SUMIFS" ? 1 : 0;
        const target = name === "SUMIFS" ? this.ev(args[0], sheet) : null;
        if (target !== null && !isRange(target)) return isErr(target) ? target : ERR("#VALUE!");
        const conds: { rg: Range; ok: (v: Val) => boolean }[] = [];
        for (let k = first; k + 1 < args.length; k += 2) {
          const rg = this.ev(args[k], sheet);
          if (!isRange(rg)) return isErr(rg) ? rg : ERR("#VALUE!");
          const c = V(k + 1);
          if (isErr(c)) return c;
          conds.push({ rg, ok: matcher(c) });
        }
        if (!conds.length) return ERR("#VALUE!");
        const base = conds[0].rg;
        let total = 0,
          count = 0;
        for (let i = 0; i <= base.r2 - base.r1; i++)
          for (let j = 0; j <= base.c2 - base.c1; j++) {
            if (!conds.every((c) => c.ok(this.value(c.rg.sheet, c.rg.r1 + i, c.rg.c1 + j)))) continue;
            count++;
            if (target) {
              const v = this.value(target.sheet, target.r1 + i, target.c1 + j);
              if (isErr(v)) return v;
              if (typeof v === "number") total += v;
            }
          }
        return name === "SUMIFS" ? total : count;
      }
      case "SUMPRODUCT": {
        const rs = A();
        if (!rs.length || !rs.every(isRange)) return ERR("#VALUE!");
        const rr = rs as Range[];
        const h = rr[0].r2 - rr[0].r1,
          w = rr[0].c2 - rr[0].c1;
        if (rr.some((r) => r.r2 - r.r1 !== h || r.c2 - r.c1 !== w)) return ERR("#VALUE!");
        let total = 0;
        for (let i = 0; i <= h; i++)
          for (let j = 0; j <= w; j++) {
            let p = 1;
            for (const r of rr) {
              const v = this.value(r.sheet, r.r1 + i, r.c1 + j);
              if (isErr(v)) return v;
              p *= typeof v === "number" ? v : 0;
            }
            total += p;
          }
        return total;
      }
      case "ROUND":
      case "ROUNDUP":
      case "ROUNDDOWN": {
        const x = num(V(0));
        if (isErr(x)) return x;
        const d = args[1] ? num(V(1)) : 0;
        if (isErr(d)) return d;
        return roundTo(x, Math.trunc(d), name === "ROUND" ? "half" : name === "ROUNDUP" ? "up" : "down");
      }
      case "INT": {
        const x = num(V(0));
        return isErr(x) ? x : Math.floor(x);
      }
      case "ABS": {
        const x = num(V(0));
        return isErr(x) ? x : Math.abs(x);
      }
      case "MOD": {
        const x = num(V(0)),
          y = num(V(1));
        if (isErr(x)) return x;
        if (isErr(y)) return y;
        return y === 0 ? ERR("#DIV/0!") : x - y * Math.floor(x / y);
      }
      case "SQRT": {
        const x = num(V(0));
        return isErr(x) ? x : x < 0 ? ERR("#NUM!") : Math.sqrt(x);
      }
      case "POWER": {
        const x = num(V(0)),
          y = num(V(1));
        if (isErr(x)) return x;
        if (isErr(y)) return y;
        return Math.pow(x, y);
      }
      case "CONCATENATE":
      case "CONCAT": {
        let s = "";
        for (const a of args) {
          const v = this.val(a, sheet);
          if (isErr(v)) return v;
          s += text(v);
        }
        return s;
      }
      case "UPPER":
      case "LOWER":
      case "TRIM": {
        const v = V(0);
        if (isErr(v)) return v;
        const s = text(v);
        return name === "UPPER" ? s.toUpperCase() : name === "LOWER" ? s.toLowerCase() : s.replace(/\s+/g, " ").trim();
      }
      case "LEFT":
      case "RIGHT": {
        const v = V(0);
        if (isErr(v)) return v;
        const k = args[1] ? num(V(1)) : 1;
        if (isErr(k)) return k;
        const s = text(v);
        return name === "LEFT" ? s.slice(0, k) : s.slice(Math.max(0, s.length - k));
      }
      case "LEN": {
        const v = V(0);
        return isErr(v) ? v : text(v).length;
      }
      case "VLOOKUP":
      case "HLOOKUP": {
        const key = V(0);
        if (isErr(key)) return key;
        const tb = this.ev(args[1], sheet);
        if (!isRange(tb)) return ERR("#REF!");
        const k = num(V(2));
        if (isErr(k)) return k;
        const exact = args[3] ? !this.truthy(V(3)) : false;
        const vertical = name === "VLOOKUP";
        const len = vertical ? tb.r2 - tb.r1 : tb.c2 - tb.c1;
        let hit = -1;
        for (let i = 0; i <= len; i++) {
          const v = vertical ? this.value(tb.sheet, tb.r1 + i, tb.c1) : this.value(tb.sheet, tb.r1, tb.c1 + i);
          if (v === null) continue;
          const c = cmp(v, key);
          if (c === 0) {
            hit = i;
            break;
          }
          if (!exact && c < 0) hit = i;
          if (!exact && c > 0) break;
        }
        if (hit < 0) return ERR("#N/A");
        return vertical ? this.value(tb.sheet, tb.r1 + hit, tb.c1 + k - 1) : this.value(tb.sheet, tb.r1 + k - 1, tb.c1 + hit);
      }
      case "INDEX": {
        const tb = this.ev(args[0], sheet);
        if (!isRange(tb)) return ERR("#REF!");
        const r = num(V(1));
        const c = args[2] ? num(V(2)) : 1;
        if (isErr(r)) return r;
        if (isErr(c)) return c;
        const rr = tb.r1 === tb.r2 && args.length < 3 ? 1 : r;
        const cc = tb.r1 === tb.r2 && args.length < 3 ? r : c;
        if (rr < 1 || cc < 1 || tb.r1 + rr - 1 > tb.r2 || tb.c1 + cc - 1 > tb.c2) return ERR("#REF!");
        return this.value(tb.sheet, tb.r1 + rr - 1, tb.c1 + cc - 1);
      }
      case "MATCH": {
        const key = V(0);
        if (isErr(key)) return key;
        const tb = this.ev(args[1], sheet);
        if (!isRange(tb)) return ERR("#N/A");
        const type = args[2] ? num(V(2)) : 1;
        if (isErr(type)) return type;
        const vals: Val[] = [...this.cellsOf(tb)];
        if (type === 0) {
          const ok = typeof key === "string" ? matcher(key) : (v: Val) => cmp(v, key) === 0;
          const i = vals.findIndex((v) => v !== null && ok(v));
          return i < 0 ? ERR("#N/A") : i + 1;
        }
        let hit = -1;
        vals.forEach((v, i) => {
          if (v === null) return;
          const c = cmp(v, key);
          if (type > 0 ? c <= 0 : c >= 0) hit = i;
        });
        return hit < 0 ? ERR("#N/A") : hit + 1;
      }
      case "TODAY": {
        const d = new Date();
        return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);
      }
      case "TRUE":
        return true;
      case "FALSE":
        return false;
      case "NA":
        return ERR("#N/A");
    }
    return ERR("#NAME?");
  }
  private truthy(v: Val) {
    return typeof v === "boolean" ? v : typeof v === "number" ? v !== 0 : false;
  }
}

function isRange(v: unknown): v is Range {
  return typeof v === "object" && v !== null && (v as Range).range === true;
}

// What a person typed into a cell: a formula (=...), a number (Indonesian or English way: 300.000 / 1.234,5 / 1,234.5 /
// 10%), TRUE / FALSE, or text.
export function parseInput(raw: string): CellDef | null {
  const s = raw.trim();
  if (s === "") return null;
  if (s.startsWith("=") && s.length > 1) return { f: s.slice(1) };
  if (/^(true|false)$/i.test(s)) return { v: s.toUpperCase() === "TRUE" };
  const pct = s.endsWith("%");
  let t = (pct ? s.slice(0, -1) : s).replace(/\s/g, "");
  const neg = /^\(.*\)$/.test(t);
  if (neg) t = t.slice(1, -1);
  let n: number | null = null;
  if (/^-?\d+$/.test(t)) n = Number(t);
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) n = Number(t.replace(/\./g, ""));
  else if (/^-?\d{1,3}(,\d{3})+$/.test(t)) n = Number(t.replace(/,/g, ""));
  else if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(t)) n = Number(t.replace(/\./g, "").replace(",", "."));
  else if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(t)) n = Number(t.replace(/,/g, ""));
  else if (/^-?\d*\.\d+$/.test(t)) n = Number(t);
  else if (/^-?\d*,\d+$/.test(t)) n = Number(t.replace(",", "."));
  if (n !== null && !Number.isNaN(n)) {
    if (neg) n = -n;
    return { v: pct ? n / 100 : n };
  }
  return { v: s };
}
