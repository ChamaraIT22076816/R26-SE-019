"""
Convert soundguard_multi_model_colab.py -> soundguard_multi_model.ipynb
Splits on '# Cell N' comment lines using a line-by-line state machine.
"""
import re, json, sys

with open("soundguard_multi_model_colab.py", "r", encoding="utf-8") as f:
    lines = f.readlines()

CELL_RE = re.compile(r"^# Cell \d+")

cells = []
current = []

for line in lines:
    stripped = line.strip()
    if CELL_RE.match(stripped):
        # Drop trailing separator lines (pure dashes/em-dashes) from previous cell
        while current and re.match(r"^# [=\-\u2500\u2014]{10,}\s*$", current[-1].strip()):
            current.pop()
        if current:
            cells.append("".join(current).strip())
        current = []
    current.append(line)

if current:
    cells.append("".join(current).strip())

cells = [c for c in cells if c]

nb = {
    "nbformat": 4,
    "nbformat_minor": 5,
    "metadata": {
        "colab": {"provenance": [], "gpuType": "T4"},
        "kernelspec": {
            "display_name": "Python 3",
            "language": "python",
            "name": "python3"
        },
        "language_info": {"name": "python", "version": "3.10.12"},
        "accelerator": "GPU"
    },
    "cells": []
}

for idx, src in enumerate(cells):
    nb["cells"].append({
        "cell_type": "code",
        "execution_count": None,
        "id": f"sg-cell-{idx:02d}",
        "metadata": {},
        "outputs": [],
        "source": src
    })

out_path = "soundguard_multi_model.ipynb"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(nb, f, indent=1, ensure_ascii=False)

sys.stdout.buffer.write(f"Done! {len(cells)} cells written to {out_path}\n".encode("utf-8"))
for i, c in enumerate(cells):
    first = c.splitlines()[0][:65] if c.splitlines() else ""
    sys.stdout.buffer.write(f"  Cell {i+1:02d}: {first}\n".encode("utf-8"))
