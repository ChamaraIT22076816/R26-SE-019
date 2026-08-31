"""
Builds the standalone evidence dossier by inlining the figures as data URIs.

The dossier is a single self-contained HTML file: no network, no external
assets, opens from disk on any machine. That matters because the hosted copy
needs a login and a demo room may not have one.

Run after make_figures.py:
    learn-ssl-module/tools/venv/Scripts/python.exe PP2-presentation/build_dossier.py

Input:  dossier.template.html  (with __FIGn__ placeholders)
Output: evidence-dossier.html  (~1.5 MB, fully self-contained)
"""

from __future__ import annotations

import base64
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEMPLATE = HERE / "dossier.template.html"
OUT = HERE / "evidence-dossier.html"
FIGURES = HERE / "figures"

FIGURE_FOR = {
    "__FIG1__": "fig1-distance-distributions.png",
    "__FIG2__": "fig2-roc.png",
    "__FIG3__": "fig3-weight-sweep.png",
    "__FIG4__": "fig4-score-scale.png",
    "__FIG5__": "fig5-per-sign-separation.png",
    "__FIG6__": "fig6-scoring-cost.png",
    "__FIG7__": "fig7-confusable-pairs.png",
    "__FIG8__": "fig8-score-separation.png",
    "__FIG9__": "fig9-baseline-comparison.png",
}


def main() -> int:
    if not TEMPLATE.exists():
        print(f"missing template: {TEMPLATE}", file=sys.stderr)
        return 1

    html = TEMPLATE.read_text(encoding="utf-8")

    for token, name in FIGURE_FOR.items():
        path = FIGURES / name
        if not path.exists():
            print(f"missing figure: {path} — run make_figures.py first", file=sys.stderr)
            return 1
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        html = html.replace(token, f"data:image/png;base64,{encoded}")

    leftover = [t for t in FIGURE_FOR if t in html]
    if leftover:
        print(f"unreplaced placeholders: {leftover}", file=sys.stderr)
        return 1

    OUT.write_text(html, encoding="utf-8")
    print(f"wrote {OUT.name}  ({OUT.stat().st_size / 1024 / 1024:.2f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
