#!/usr/bin/env python3
"""
Typeset PP2-presentation/PANEL-QA.md as an A4 print PDF.

Layout and typesetting only — the markdown is the single source of truth and is
never rewritten here. Rebuild after editing PANEL-QA.md:

    python3 build_panelqa.py

Three render passes:
  1. measure each question's height  -> decide which fit whole on one page
  2. render with those keep-together rules, read back real page numbers
  3. render again with the index page numbers filled in

Requires: python3, node with playwright (chromium), and poppler's pdftotext /
pdfinfo. All three are present in the Cowork container this was built in; on a
bare Windows machine they are not, so rebuild there only after installing them
(or ask Cowork to rebuild it).
"""
import html as H
import json
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).parent
SRC = HERE / "PANEL-QA.md"
OUT_PDF = HERE / "Suvana-PP2-panel-qa.pdf"
WORK = HERE / "panelqa.build.html"
RENDER = HERE / "panelqa_render.js"

# ----------------------------------------------------------------- inline ---
CODE_TOKEN = "\x00CODE%d\x00"


def inline(text):
    """Markdown inline -> HTML. Code spans are protected from further passes."""
    codes = []

    def stash(m):
        codes.append(H.escape(m.group(1)))
        return CODE_TOKEN % (len(codes) - 1)

    text = re.sub(r"`([^`]+)`", stash, text)
    text = H.escape(text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)          # links -> label
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text, flags=re.S)
    text = re.sub(r"(?<![\w*])\*([^*\n]+)\*(?!\w)", r"<em>\1</em>", text)
    for i, c in enumerate(codes):
        text = text.replace(CODE_TOKEN % i, f"<code>{c}</code>")
    return text


# ------------------------------------------------------------------ parse ---
def is_table(l): return l.lstrip().startswith("|")
def is_fence(l): return l.lstrip().startswith("```")
def is_ul(l): return re.match(r"^\s*[-*]\s+", l) is not None
def is_ol(l): return re.match(r"^\s*\d+\.\s+", l) is not None
def is_quote(l): return l.startswith(">")


def parse_blocks(lines):
    """Parse a run of markdown lines into a list of block dicts."""
    blocks, i, n = [], 0, len(lines)
    while i < n:
        raw = lines[i]
        if not raw.strip():
            i += 1
            continue

        if is_quote(raw):
            buf = []
            while i < n and is_quote(lines[i]):
                buf.append(re.sub(r"^>\s?", "", lines[i]))
                i += 1
            paras, cur = [], []
            for l in buf:
                if l.strip():
                    cur.append(l.strip())
                elif cur:
                    paras.append(" ".join(cur)); cur = []
            if cur:
                paras.append(" ".join(cur))
            blocks.append({"t": "quote", "paras": paras})
            continue

        if is_fence(raw):
            i += 1
            buf = []
            while i < n and not is_fence(lines[i]):
                buf.append(lines[i]); i += 1
            i += 1
            blocks.append({"t": "code", "text": "\n".join(buf)})
            continue

        if is_table(raw):
            rows = []
            while i < n and is_table(lines[i]):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                rows.append(cells); i += 1
            sep = next((k for k, r in enumerate(rows)
                        if all(re.fullmatch(r":?-{2,}:?", c or "-") for c in r)), None)
            head = rows[0] if sep == 1 else None
            body = rows[sep + 1:] if sep is not None else rows
            blocks.append({"t": "table", "head": head, "body": body})
            continue

        if is_ul(raw) or is_ol(raw):
            ordered = is_ol(raw)
            items = []
            while i < n and (is_ul(lines[i]) if not ordered else is_ol(lines[i])):
                m = re.match(r"^(\s*)((?:[-*]|\d+\.)\s+)(.*)$", lines[i])
                # continuation lines are indented to the width of the marker
                # ("- " = 2, "1. " = 3, "10. " = 4)
                width = len(m.group(1)) + len(m.group(2))
                item_lines = [m.group(3)]
                i += 1

                def indented(l):
                    return bool(l.strip()) and (len(l) - len(l.lstrip(" \t"))) >= 2

                while i < n:
                    l = lines[i]
                    if not l.strip():
                        nxt = lines[i + 1] if i + 1 < n else ""
                        if indented(nxt) and not (is_ul(nxt) or is_ol(nxt)):
                            item_lines.append(""); i += 1; continue
                        break
                    if is_ul(l) or is_ol(l):
                        break
                    if indented(l):
                        cut = min(width, len(l) - len(l.lstrip(" \t")))
                        item_lines.append(l[cut:]); i += 1
                        continue
                    break
                items.append(parse_blocks(item_lines))
            blocks.append({"t": "ol" if ordered else "ul", "items": items})
            continue

        # plain paragraph
        buf = []
        while i < n and lines[i].strip() and not (
            is_quote(lines[i]) or is_table(lines[i]) or is_fence(lines[i])
            or is_ul(lines[i]) or is_ol(lines[i])
        ):
            buf.append(lines[i].strip()); i += 1
        text = " ".join(buf)
        kind = "warn" if text.lstrip().startswith("**⚠") else (
            "note" if text.lstrip().startswith("**") else "p")
        blocks.append({"t": kind, "text": text})
    return blocks


def parse(md):
    lines = md.split("\n")
    title, intro_lines, sections, cur = None, [], [], None
    i = 0
    while i < len(lines):
        l = lines[i]
        if l.startswith("# ") and title is None:
            title = l[2:].strip(); i += 1; continue
        if l.strip() == "---":
            i += 1; continue
        if l.startswith("## "):
            head = l[3:].strip()
            m = re.match(r"^(\d+)\.\s+(.*)$", head)
            cur = {"num": m.group(1) if m else None,
                   "title": m.group(2) if m else head,
                   "lines": []}
            sections.append(cur); i += 1; continue
        (cur["lines"] if cur else intro_lines).append(l)
        i += 1

    for s in sections:
        s["blocks"] = parse_blocks(s["lines"])
        # a bold-lead paragraph that introduces a list is a sub-heading, not a note
        for k, b in enumerate(s["blocks"]):
            nxt = s["blocks"][k + 1] if k + 1 < len(s["blocks"]) else None
            if b["t"] == "note" and nxt and nxt["t"] in ("ul", "ol"):
                b["t"] = "subhead"
        s["warn"] = any(b["t"] == "warn" for b in s["blocks"])
    return title, parse_blocks(intro_lines), sections


# ----------------------------------------------------------------- render ---
def render_blocks(blocks, in_list=False):
    out = []
    for b in blocks:
        t = b["t"]
        if in_list and t in ("note", "subhead"):
            t = "p"
        if t == "p":
            out.append(f'<p>{inline(b["text"])}</p>')
        elif t == "note":
            out.append(f'<p class="note">{inline(b["text"])}</p>')
        elif t == "subhead":
            out.append(f'<p class="subhead">{inline(b["text"])}</p>')
        elif t == "warn":
            txt = inline(re.sub(r"^\s*\*\*⚠\s*", "**", b["text"]))
            out.append('<div class="warn"><span class="wtag">⚠</span>'
                       f'<div class="wbody">{txt}</div></div>')
        elif t == "quote":
            paras = "".join(f"<p>{inline(p)}</p>" for p in b["paras"])
            out.append(f'<blockquote class="say">{paras}</blockquote>')
        elif t == "code":
            out.append(f'<pre><code>{H.escape(b["text"])}</code></pre>')
        elif t == "table":
            head = ""
            if b["head"]:
                head = "<thead><tr>" + "".join(
                    f"<th>{inline(c)}</th>" for c in b["head"]) + "</tr></thead>"
            body = "<tbody>" + "".join(
                "<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>"
                for r in b["body"]) + "</tbody>"
            out.append(f'<div class="tbl"><table>{head}{body}</table></div>')
        elif t in ("ul", "ol"):
            tag = "ul" if t == "ul" else "ol"
            items = "".join(f"<li>{render_blocks(it, in_list=True)}</li>" for it in b["items"])
            out.append(f"<{tag}>{items}</{tag}>")
    return "".join(out)


CSS = r"""
@page { size: A4; margin: 13mm 18mm 15mm; }
*{ box-sizing:border-box; margin:0; padding:0 }
html{ -webkit-print-color-adjust:exact; print-color-adjust:exact }
body{
  font-family:"Helvetica Neue", Helvetica, Arial, sans-serif;
  font-size:9.4pt; line-height:1.42; color:#111;
}
h1,h2,.serif{ font-family:Cambria, Caladea, Georgia, "Times New Roman", serif }

/* ---------- page 1 ---------- */
.cover{ break-after:page }
header.card{
  display:flex; justify-content:space-between; align-items:flex-end;
  border-bottom:1.6pt solid #111; padding-bottom:2.4mm; margin-bottom:3.4mm;
}
header.card h1{ font-size:17pt; letter-spacing:-.2pt; margin-bottom:1.4mm }
header.card .sub{ font-size:8.4pt; color:#555; max-width:120mm }
header.card .right{ text-align:right; font-size:7.6pt; color:#444; line-height:1.5; white-space:nowrap }
.intro{ font-size:8.8pt; color:#333; max-width:150mm; margin-bottom:4mm }
.intro p + p{ margin-top:1.4mm }

h2.sec{
  font-family:"Helvetica Neue", Helvetica, Arial, sans-serif;
  font-size:8pt; font-weight:700; letter-spacing:.09em; text-transform:uppercase;
  border-bottom:.7pt solid #111; padding-bottom:.9mm; margin:5mm 0 2.4mm;
}

/* index */
table.toc{ width:100%; border-collapse:collapse }
table.toc td{ padding:.95mm 0; vertical-align:baseline }
table.toc td.n{ width:8mm; font-weight:700; font-variant-numeric:tabular-nums; color:#00695c }
table.toc td.w{ width:7mm; text-align:center }
table.toc td.q{ }
table.toc td.pg{ width:11mm; text-align:right; font-weight:700; font-variant-numeric:tabular-nums }
table.toc tr.flag td.q{ font-weight:700 }
table.toc .leader{
  display:inline-block; width:100%; border-bottom:.4pt dotted #999;
  margin:0 1.4mm -0.4mm .9mm; vertical-align:bottom;
}
table.toc td.q .row{ display:flex; align-items:baseline }
table.toc td.q .row span:first-child{ flex:none }
table.toc td.q .row .leader{ flex:1 }
.chip{
  display:inline-block; background:#111; color:#fff; font-size:6.6pt; font-weight:700;
  line-height:1; padding:.9mm .9mm .7mm; border-radius:1pt;
}
table.toc tr.close td{ padding-top:2.2mm; font-style:italic }

/* legend */
.legend{ display:grid; grid-template-columns:1fr 1fr 1fr; gap:0 5mm; margin-top:1.5mm }
.legend .lg{ font-size:8.2pt }
.legend .lg .h{ font-weight:700; margin-bottom:1mm }
.legend .sample{ font-size:7.8pt; color:#333 }
.legend .sample.say{
  border-left:2.4pt solid #111; background:#f0f0f0; padding:1.6mm 2mm;
  font-family:Cambria, Caladea, Georgia, serif;
}
.legend .sample.note{ border-left:.9pt solid #111; padding:1.2mm 0 1.2mm 2mm }
.legend .sample.warnx{ border:1.1pt solid #111; padding:1.2mm 2mm }

/* ---------- question sections ---------- */
section.q{ position:relative; padding-left:20mm; margin-bottom:6mm }
section.q.keep{ break-inside:avoid }
section.q h2{
  position:relative; font-size:13pt; font-weight:700; line-height:1.2;
  margin-bottom:2.2mm; break-after:avoid; letter-spacing:-.15pt;
}
section.q h2 .qn{
  position:absolute; left:-20mm; top:.2mm; width:16mm;
  font-size:13pt; font-weight:700; color:#00695c; font-variant-numeric:tabular-nums;
}
section.q h2 .qflag{
  position:absolute; left:-12.5mm; top:1.1mm;
  font-size:7pt; font-weight:700; color:#fff; background:#111;
  padding:.8mm 1.1mm .6mm; border-radius:1pt;
}
section.q > p, section.q > .tbl, section.q > ul, section.q > ol,
section.q > blockquote, section.q > .warn, section.q > pre{ margin-bottom:2.4mm }
section.q > :last-child{ margin-bottom:0 }
p{ orphans:3; widows:3 }

.subhead{ font-weight:700 }
.note{ border-left:.9pt solid #111; padding:.4mm 0 .4mm 2.6mm }

blockquote.say{
  border-left:2.4pt solid #111; background:#f0f0f0;
  padding:2.4mm 3mm; font-family:Cambria, Caladea, Georgia, "Times New Roman", serif;
  font-size:9.8pt; line-height:1.45;
}
blockquote.say p + p{ margin-top:1.8mm }

.warn{
  border:1.2pt solid #111; padding:2mm 2.6mm; display:flex; gap:2.4mm;
  break-inside:avoid;
}
.warn .wtag{
  flex:none; background:#111; color:#fff; font-size:8.4pt; font-weight:700;
  line-height:1; padding:1.3mm 1.5mm 1.1mm; border-radius:1pt;
}
.warn .wbody{ flex:1 }

ul, ol{ padding-left:5.4mm }
li{ margin-bottom:1.4mm; break-inside:avoid }
li > p{ margin-bottom:1.2mm }
li > :last-child{ margin-bottom:0 }
li::marker{ font-weight:700 }

.tbl{ overflow:visible; margin-left:-20mm; break-inside:avoid }
table:not(.toc){ width:100%; border-collapse:collapse; font-size:8.6pt }
table:not(.toc) th, table:not(.toc) td{
  text-align:left; vertical-align:top; padding:1.4mm 2.2mm 1.4mm 0;
  border-bottom:.4pt solid #ccc;
}
table:not(.toc) thead th{
  font-size:7.4pt; letter-spacing:.07em; text-transform:uppercase;
  border-bottom:.9pt solid #111; padding-bottom:1mm;
}
table:not(.toc) tbody tr:last-child td{ border-bottom:none }

pre{ background:#f0f0f0; padding:1.8mm 2.4mm; overflow:hidden }
code, pre{ font-family:"Courier New", Courier, monospace; font-size:8pt }
pre code{ font-size:7.6pt; white-space:pre-wrap; word-break:break-word }

.closing{ position:relative; padding-left:20mm }
.closing h2{ font-size:13pt; font-weight:700; margin-bottom:2.4mm; break-after:avoid }
.closing h2 .qn{ position:absolute; left:-20mm; font-size:13pt; color:#00695c }
"""


def render(title, intro_blocks, sections, page_map, keep_ids):
    def toc_row(s, idx):
        pg = page_map.get(s["key"], "—")
        flag = '<span class="chip">⚠</span>' if s["warn"] else ""
        cls = ' class="flag"' if s["warn"] else ""
        return (f'<tr{cls}><td class="n">{s["num"] or ""}</td>'
                f'<td class="w">{flag}</td>'
                f'<td class="q"><span class="row"><span>{inline(s["title"])}</span>'
                f'<span class="leader"></span></span></td>'
                f'<td class="pg">{pg}</td></tr>')

    numbered = [s for s in sections if s["num"]]
    closing = [s for s in sections if not s["num"]]

    toc = "".join(toc_row(s, i) for i, s in enumerate(numbered))
    for s in closing:
        pg = page_map.get(s["key"], "—")
        toc += (f'<tr class="close"><td class="n">—</td><td class="w"></td>'
                f'<td class="q"><span class="row"><span>{inline(s["title"])}</span>'
                f'<span class="leader"></span></span></td>'
                f'<td class="pg">{pg}</td></tr>')

    n_flag = sum(1 for s in sections if s["warn"])

    body = []
    for s in sections:
        keep = " keep" if s["key"] in keep_ids else ""
        if s["num"]:
            qn = f'<span class="qn">{s["num"]}</span>'
            fl = '<span class="qflag">⚠</span>' if s["warn"] else ""
            body.append(
                f'<section class="q{keep}" id="{s["key"]}">'
                f'<h2>{qn}{fl}{inline(s["title"])}</h2>'
                f'{render_blocks(s["blocks"])}</section>')
        else:
            body.append(
                f'<section class="q closing{keep}" id="{s["key"]}">'
                f'<h2><span class="qn">◆</span>{inline(s["title"])}</h2>'
                f'{render_blocks(s["blocks"])}</section>')

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Suvana PP2 — panel Q&amp;A</title>
<style>{CSS}</style></head><body>

<div class="cover">
  <header class="card">
    <div>
      <h1>{H.escape(title)}</h1>
      <div class="sub">The deep version — all {len(numbered)} questions, to read the night before
      and keep in the bag. The two-page presenter card is the in-room cheat sheet; this is not a
      replacement for it.</div>
    </div>
    <div class="right">R26-SE-019 · Suvana<br>IT22552860<br>1 September 2026</div>
  </header>

  <div class="intro">{render_blocks(intro_blocks)}</div>

  <h2 class="sec">Find an answer — {len(numbered)} questions</h2>
  <table class="toc">{toc}</table>

  <h2 class="sec">How this page is marked up</h2>
  <div class="legend">
    <div class="lg"><div class="h">Read this out loud</div>
      <div class="sample say">Grey panel, heavy rule, serif type. These are the answers as spoken sentences.</div></div>
    <div class="lg"><div class="h">Guidance to you</div>
      <div class="sample note">Thin rule. How to handle the question — not something to say verbatim.</div></div>
    <div class="lg"><div class="h">Weak spot — {n_flag} of them</div>
      <div class="sample warnx">Boxed and flagged in the margin. Honesty is the strategy here; name it before the panel does.</div></div>
  </div>
</div>

{''.join(body)}

</body></html>"""


# ------------------------------------------------------------------- pass ---
def run_render(html_path, pdf_path, measure=False):
    cmd = ["node", str(RENDER), str(html_path), str(pdf_path)]
    if measure:
        cmd.append("--measure")
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("render failed:\n" + r.stdout + r.stderr)
    return json.loads(r.stdout) if measure else None


def page_of(pdf, needles):
    """Map each section key to the 1-based PDF page its title appears on."""
    n = int(subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True)
            .stdout.split("Pages:")[1].split()[0])
    found = {}
    for pg in range(1, n + 1):
        txt = subprocess.run(["pdftotext", "-f", str(pg), "-l", str(pg), str(pdf), "-"],
                             capture_output=True, text=True).stdout
        flat = re.sub(r"\s+", " ", txt)
        for key, title in needles.items():
            if key in found or pg == 1:
                continue
            if re.sub(r"\s+", " ", title)[:46] in flat:
                found[key] = pg
    return found, n


def main():
    md = SRC.read_text(encoding="utf-8")
    title, intro, sections = parse(md)
    for i, s in enumerate(sections):
        s["key"] = f"q{s['num']}" if s["num"] else "qclose"

    needles = {s["key"]: s["title"] for s in sections}

    # pass 1 — measure
    WORK.write_text(render(title, intro, sections, {}, set()), encoding="utf-8")
    heights = run_render(WORK, OUT_PDF, measure=True)
    # A4 content height at 13/15mm margins, in CSS px (1mm = 3.7795px)
    page_px = (297 - 13 - 15) * 3.7795
    keep = {k for k, v in heights.items() if v < page_px * 0.86}

    # pass 2 — real layout, read page numbers back
    WORK.write_text(render(title, intro, sections, {}, keep), encoding="utf-8")
    run_render(WORK, OUT_PDF)
    pages, total = page_of(OUT_PDF, needles)

    # pass 3 — index filled in; confirm nothing moved
    WORK.write_text(render(title, intro, sections, pages, keep), encoding="utf-8")
    run_render(WORK, OUT_PDF)
    check, total2 = page_of(OUT_PDF, needles)
    if check != pages:
        WORK.write_text(render(title, intro, sections, check, keep), encoding="utf-8")
        run_render(WORK, OUT_PDF)
        check2, total2 = page_of(OUT_PDF, needles)
        if check2 != check:
            print("WARNING: index page numbers did not settle", file=sys.stderr)

    missing = [k for k in needles if k not in check]
    print(f"wrote {OUT_PDF.name}  ·  {total2} pages  ·  "
          f"{len([s for s in sections if s['num']])} questions  ·  "
          f"{len(keep)} kept whole on one page"
          + (f"  ·  UNRESOLVED: {missing}" if missing else ""))


if __name__ == "__main__":
    main()
