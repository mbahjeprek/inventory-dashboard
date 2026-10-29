# Usage: python scripts/budget_extract.py <workbook.xlsx> <out.json> [--semua]  (needs openpyxl and Pillow). The JSON is gzipped into budget_workbook.data.
# SHOW below = the sheets shown as tabs (the rest of what their formulas reach comes along as "sheet pendukung").
# Converts the budget workbook into JSON for the web Budgeting viewer: per sheet the used cells (cached value, formula,
# style id), merges, column widths / row heights, hidden rows / cols, freeze pane, hyperlinks, comments and images;
# one shared style table. Theme colours are resolved to RGB (with tint) so the browser shows the same colours.
import openpyxl, json, re, sys, io, hashlib, base64, zipfile, colorsys, datetime
from openpyxl.utils import get_column_letter
from xml.etree import ElementTree as ET

SRC, OUT = sys.argv[1], sys.argv[2]
SHOW = ["COVER", "DAFTAR ISI", "AREASTA", "STRUKTUR ORGANISASI", "STO", "DETAILL TK", "KEBUTUHAN RUMAH", "REKAP COST", "GC SUMMARY",
        "GC KALENDERISASI", "PM DETAIL", "PM ALL", "PM INTI", "KALENDERISASI", "A TTM 13"]

wbf = openpyxl.load_workbook(SRC)
wbv = openpyxl.load_workbook(SRC, data_only=True)
# --semua: every sheet visible in Excel is a tab, in Excel's order (hidden ones come along only when a formula needs them)
if "--semua" in sys.argv:
    SHOW = [ws.title for ws in wbf.worksheets if ws.sheet_state == "visible"]

# ---- theme colours ----
z = zipfile.ZipFile(SRC)
theme = []
try:
    t = ET.fromstring(z.read("xl/theme/theme1.xml"))
    ns = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
    cs = t.find(".//a:clrScheme", ns)
    order = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"]
    m = {}
    for el in cs:
        tag = el.tag.split("}")[1]
        c = el[0]
        m[tag] = c.get("lastClr") or c.get("val")
    # Excel theme index order: 0 lt1, 1 dk1, 2 lt2, 3 dk2, 4.. accents
    theme = [m.get(k, "000000") for k in order]
except Exception as e:
    print("theme failed", e)
    theme = ["FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47", "0563C1", "954F72"]

def tint(hexrgb, t):
    r, g, b = (int(hexrgb[i:i + 2], 16) / 255 for i in (0, 2, 4))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    l = l * (1 + t) if t < 0 else l * (1 - t) + t
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return "%02X%02X%02X" % (round(r * 255), round(g * 255), round(b * 255))

def color(c):
    if c is None:
        return None
    try:
        if c.type == "rgb" and isinstance(c.rgb, str):
            v = c.rgb[-6:]
            return v
        if c.type == "theme" and c.theme is not None:
            base = theme[c.theme] if c.theme < len(theme) else "000000"
            return tint(base, c.tint or 0) if c.tint else base
        if c.type == "indexed" and c.indexed is not None:
            from openpyxl.styles.colors import COLOR_INDEX
            if c.indexed < len(COLOR_INDEX):
                return COLOR_INDEX[c.indexed][-6:]
    except Exception:
        return None
    return None

styles, style_ix = [], {}
def style_of(c):
    f, fl, b, a = c.font, c.fill, c.border, c.alignment
    s = {}
    if f:
        if f.b: s["b"] = 1
        if f.i: s["i"] = 1
        if f.u: s["u"] = 1
        if f.strike: s["st"] = 1
        if f.sz and float(f.sz) != 11: s["sz"] = float(f.sz)
        if f.name and f.name not in ("Calibri", "Arial"): s["fn"] = f.name
        fc = color(f.color)
        if fc and fc != "000000": s["fc"] = fc
    if fl is not None and fl.fill_type == "solid":
        bg = color(fl.fgColor)
        if bg and bg != "FFFFFF": s["bg"] = bg
        elif bg == "FFFFFF": s["bg"] = "FFFFFF"
    bd = {}
    for side in ("left", "right", "top", "bottom"):
        sd = getattr(b, side, None) if b else None
        if sd is not None and sd.style:
            bd[side[0]] = [sd.style, color(sd.color) or "000000"]
    if bd: s["bd"] = bd
    if a:
        if a.horizontal and a.horizontal != "general": s["h"] = a.horizontal
        if a.vertical and a.vertical != "bottom": s["v"] = a.vertical
        if a.wrap_text: s["w"] = 1
        if a.indent: s["ind"] = int(a.indent)
        if a.text_rotation: s["rot"] = int(a.text_rotation)
    if c.number_format and c.number_format != "General": s["nf"] = c.number_format
    key = json.dumps(s, sort_keys=True)
    if key == "{}":
        return None
    if key not in style_ix:
        style_ix[key] = len(styles)
        styles.append(s)
    return style_ix[key]

def val(v):
    if isinstance(v, (datetime.datetime, datetime.date)):
        # Excel serial date, so number formats / formulas treat it like Excel does
        d = v if isinstance(v, datetime.datetime) else datetime.datetime(v.year, v.month, v.day)
        return (d - datetime.datetime(1899, 12, 30)).total_seconds() / 86400
    if isinstance(v, datetime.time):
        return (v.hour * 3600 + v.minute * 60 + v.second) / 86400
    if isinstance(v, (int, float, bool, str)) or v is None:
        return v
    return str(v)

# ---- which sheets: the shown ones and everything their formulas reach ----
names = set(wbf.sheetnames)
refre = re.compile(r"(?:'((?:[^']|'')+)'|([A-Za-z0-9_\.]+))!")
deps = {}
for ws in wbf.worksheets:
    d = set()
    for row in ws.iter_rows():
        for c in row:
            if isinstance(c.value, str) and c.value.startswith("="):
                for a, b in refre.findall(c.value):
                    n = (a or b).replace("''", "'")
                    if n in names: d.add(n)
    deps[ws.title] = d
need, stack = set(SHOW), list(SHOW)
while stack:
    for d in deps[stack.pop()]:
        if d not in need: need.add(d); stack.append(d)
order = [n for n in wbf.sheetnames if n in need]

# comments
def comments(ws):
    out = {}
    for row in ws.iter_rows():
        for c in row:
            if c.comment: out[c.coordinate] = c.comment.text[:500]
    return out

sheets = []
for name in order:
    ws, wv = wbf[name], wbv[name]
    cells = {}
    maxr = maxc = 0
    for row in ws.iter_rows():
        for c in row:
            v = c.value
            st = style_of(c)
            has_val = v is not None and v != ""
            if not has_val and st is None:
                continue
            e = {}
            if isinstance(v, str) and v.startswith("="):
                e["f"] = v[1:]
                cv = val(wv[c.coordinate].value)
                if cv is not None: e["v"] = cv
            elif has_val:
                e["v"] = val(v)
            if st is not None: e["s"] = st
            if c.hyperlink:
                e["l"] = c.hyperlink.location or c.hyperlink.target
            # styled-only cells count for the extent only if they show something (fill / border)
            if has_val:
                maxr, maxc = max(maxr, c.row), max(maxc, c.column)
            cells[c.coordinate] = e
    merges = [str(r) for r in ws.merged_cells.ranges]
    for r in ws.merged_cells.ranges:
        maxr, maxc = max(maxr, r.max_row), max(maxc, r.max_col)
    imgs = []
    seen = set()
    for im in ws._images:
        a = im.anchor
        fr = getattr(a, "_from", None)
        if fr is None: continue
        data = im._data()
        key = (fr.col, fr.row, hashlib.md5(data).hexdigest())
        if key in seen: continue
        seen.add(key)
        if getattr(a, "ext", None) is not None:
            w, h = a.ext.width / 9525, a.ext.height / 9525
        else:
            w, h = im.width, im.height
        # shrink big photos: the web shows them at most this size
        from PIL import Image
        pi = Image.open(io.BytesIO(data))
        if pi.mode in ("P", "LA"): pi = pi.convert("RGBA")
        scale = min(1.0, 900 / max(pi.size))
        if scale < 1: pi = pi.resize((round(pi.size[0] * scale), round(pi.size[1] * scale)))
        buf = io.BytesIO()
        if pi.mode == "RGBA":
            pi.save(buf, "PNG", optimize=True); mime = "image/png"
        else:
            pi.convert("RGB").save(buf, "JPEG", quality=82); mime = "image/jpeg"
        imgs.append({"c": fr.col, "r": fr.row, "dx": fr.colOff / 9525, "dy": fr.rowOff / 9525, "w": w, "h": h, "src": f"data:{mime};base64," + base64.b64encode(buf.getvalue()).decode()})
        maxr = max(maxr, fr.row + 1); maxc = max(maxc, fr.col + 1)
    # trim: keep only cells inside the extent
    cells = {k: v for k, v in cells.items() if openpyxl.utils.cell.coordinate_from_string(k)[1] <= maxr + 1 and openpyxl.utils.column_index_from_string(openpyxl.utils.cell.coordinate_from_string(k)[0]) <= maxc + 1}
    defw = ws.sheet_format.defaultColWidth or 8.43
    cols = []
    hidden_cols = []
    for i in range(1, maxc + 2):
        L = get_column_letter(i)
        cd = ws.column_dimensions.get(L)
        w = cd.width if cd is not None and cd.width else defw
        if cd is not None and cd.hidden: hidden_cols.append(i)
        cols.append(round(w * 7 + 5))
    defh = ws.sheet_format.defaultRowHeight or 15
    rows = {}
    hidden_rows = []
    for i, rd in ws.row_dimensions.items():
        if i > maxr + 1: continue
        if rd.hidden: hidden_rows.append(i)
        if rd.ht: rows[i] = round(rd.ht * 4 / 3)
    sheets.append({
        "name": name, "show": name in SHOW, "hidden": ws.sheet_state != "visible",
        "maxr": maxr + 1, "maxc": maxc + 1, "cols": cols, "rowh": rows, "defh": round(defh * 4 / 3),
        "hr": hidden_rows, "hc": hidden_cols, "freeze": ws.freeze_panes, "merges": merges,
        "cells": cells, "notes": comments(ws), "imgs": imgs,
        "tab": (ws.sheet_properties.tabColor.rgb[-6:] if ws.sheet_properties.tabColor is not None and isinstance(ws.sheet_properties.tabColor.rgb, str) else None),
    })
    print(name, "cells", len(cells), "ext", maxr, maxc, "imgs", len(imgs), file=sys.stderr)

json.dump({"sheets": sheets, "styles": styles, "showOrder": SHOW}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("done", len(sheets), "sheets", len(styles), "styles", file=sys.stderr)
