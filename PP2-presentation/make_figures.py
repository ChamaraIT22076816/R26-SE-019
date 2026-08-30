"""
PP2 evaluation figures for the SSL Learn module (kvn / IT22552860).

Reads data/raw-metrics.json — written by
learn-ssl-module/web/src/scoring/evaluation.export.test.ts, which measures every
distance with the same scoreAttempt() the deployed app calls — and renders the
figures used in the PP2 slides and report.

This script does NO measurement of its own. It plots, labels and nothing else.
That separation is deliberate: the numbers must come out of the scorer under
test, so a chart can never quietly disagree with calibration-report.md.

Run:
    learn-ssl-module/tools/venv/Scripts/python.exe PP2-presentation/make_figures.py

Regenerate the input first if the scorer changed:
    cd learn-ssl-module/web
    $env:EVAL_EXPORT=1; npx vitest run evaluation.export
"""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.ticker import PercentFormatter

HERE = Path(__file__).resolve().parent
DATA = json.loads((HERE / "data" / "raw-metrics.json").read_text(encoding="utf-8"))
FIG = HERE / "figures"
FIG.mkdir(exist_ok=True)

# Suvana palette (learn-ssl-module/web/src/index.css)
TEAL = "#00776a"
TEAL_SOFT = "#00a693"
INK = "#04201d"
RUST = "#c2410c"
CAUTION = "#8a6410"
GREY = "#5a6b68"
GRID = "#dfe8e6"

plt.rcParams.update(
    {
        "figure.dpi": 200,
        "savefig.dpi": 200,
        "savefig.bbox": "tight",
        "savefig.facecolor": "white",
        "font.size": 11,
        "axes.titlesize": 13,
        "axes.titleweight": "bold",
        "axes.labelsize": 11,
        "axes.edgecolor": GREY,
        "axes.labelcolor": INK,
        "axes.titlecolor": INK,
        "text.color": INK,
        "xtick.color": GREY,
        "ytick.color": GREY,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "grid.color": GRID,
        "legend.frameon": False,
    }
)

pairs = DATA["pairs"]
pos = np.array([p["distance"] for p in pairs if p["label"] == 1])
neg = np.array([p["distance"] for p in pairs if p["label"] == 0])
CUT = DATA["separation"]["bestCut"]
ACC = DATA["separation"]["accuracy"]
D_PERFECT = DATA["scorer"]["anchors"]["dPerfect"]
D_ZERO = DATA["scorer"]["anchors"]["dZero"]
CORPUS = DATA["corpus"]

SOURCE = (
    f"{CORPUS['signsUsed']} signs / {CORPUS['takes']} takes, "
    f"{CORPUS['source']} (CC BY-NC-SA 4.0), one signer"
)


def caption(fig, text: str) -> None:
    """One line of provenance under every figure, so a slide can never be orphaned."""
    fig.text(0.5, -0.04, text, ha="center", va="top", fontsize=8, color=GREY, style="italic")


def save(fig, name: str) -> None:
    fig.savefig(FIG / name)
    plt.close(fig)
    print(f"  {name}")


# --------------------------------------------------------------------------
# Fig 1 — the money chart. Two distributions, one threshold.
# --------------------------------------------------------------------------
def _density(x: np.ndarray, grid: np.ndarray, bw: float = 0.045) -> np.ndarray:
    """Gaussian kernel density. Smoothing only — no distribution is assumed."""
    z = (grid[:, None] - x[None, :]) / bw
    return np.exp(-0.5 * z**2).sum(axis=1) / (len(x) * bw * np.sqrt(2 * np.pi))


def fig_distributions() -> None:
    fig, ax = plt.subplots(figsize=(8.4, 4.8))
    grid = np.linspace(0, 1.5, 500)
    dp, dn = _density(pos, grid), _density(neg, grid)

    ax.fill_between(grid, dn, color=RUST, alpha=0.28, lw=0)
    ax.fill_between(grid, dp, color=TEAL, alpha=0.28, lw=0)
    ax.plot(grid, dn, color=RUST, lw=2.4, label=f"different sign  (n={len(neg)})")
    ax.plot(grid, dp, color=TEAL, lw=2.4, label=f"same sign, another take  (n={len(pos)})")

    # The overlap is the point of the chart: it is exactly the 25.4% that no
    # single threshold can resolve.
    ax.fill_between(grid, np.minimum(dp, dn), color=INK, alpha=0.22, lw=0,
                    label="overlap — no threshold can separate this")

    top = max(dp.max(), dn.max())
    ax.set_ylim(0, top * 1.34)
    ax.axvline(CUT, color=INK, lw=1.8, ls="--", ymax=0.72)
    ax.annotate(
        f"best threshold {CUT:.3f}\n→ {ACC * 100:.1f}% separation",
        xy=(CUT, top * 0.98), xytext=(0.015, top * 1.30),
        fontsize=10, color=INK, ha="left", va="top",
        arrowprops=dict(arrowstyle="->", color=INK, lw=1.0,
                        connectionstyle="angle,angleA=0,angleB=90,rad=4"),
    )
    ax.set_xlabel("normalised DTW distance  (hand-size units)")
    ax.set_ylabel("density")
    ax.set_xlim(0, 1.45)
    ax.set_title("Correct renditions sit closer than different signs — and the tails overlap")
    ax.legend(loc="upper right", fontsize=9.5, bbox_to_anchor=(1.0, 0.99))
    ax.grid(axis="y", alpha=0.5)
    caption(
        fig,
        f"{SOURCE}. Gaussian kernel smoothing for display; every statistic is computed "
        "on the raw distances.",
    )
    save(fig, "fig1-distance-distributions.png")


# --------------------------------------------------------------------------
# Fig 2 — ROC. Threshold-free, so it answers "why is accuracy the headline?"
# --------------------------------------------------------------------------
def fig_roc() -> None:
    thresholds = np.unique(np.concatenate([pos, neg]))
    tpr = np.array([(pos <= t).mean() for t in thresholds])
    fpr = np.array([(neg <= t).mean() for t in thresholds])
    order = np.argsort(fpr)
    fpr_s, tpr_s = np.r_[0, fpr[order], 1], np.r_[0, tpr[order], 1]
    auc = float(np.trapezoid(tpr_s, fpr_s))

    tpr_at_cut = (pos <= CUT).mean()
    fpr_at_cut = (neg <= CUT).mean()

    fig, ax = plt.subplots(figsize=(5.6, 5.2))
    ax.plot([0, 1], [0, 1], color=GREY, lw=1, ls="--")
    ax.plot(fpr_s, tpr_s, color=TEAL, lw=2.4)
    ax.fill_between(fpr_s, tpr_s, alpha=0.10, color=TEAL)
    ax.scatter([fpr_at_cut], [tpr_at_cut], s=70, color=INK, zorder=5)
    ax.annotate(
        f"shipped threshold {CUT:.3f}\nTPR {tpr_at_cut:.2f} / FPR {fpr_at_cut:.2f}",
        xy=(fpr_at_cut, tpr_at_cut), xytext=(fpr_at_cut + 0.10, tpr_at_cut - 0.22),
        fontsize=9, arrowprops=dict(arrowstyle="->", color=INK, lw=0.9),
    )
    ax.text(0.55, 0.16, f"AUC = {auc:.3f}", fontsize=15, fontweight="bold", color=TEAL)
    ax.text(0.55, 0.08, "chance = 0.500", fontsize=9, color=GREY)
    ax.set_xlabel("false positive rate")
    ax.set_ylabel("true positive rate")
    ax.set_title("Separation is threshold-free, not\na lucky cut-off")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1.02)
    ax.grid(alpha=0.5)
    caption(fig, f"{SOURCE}. Positive class = two takes of the same sign.")
    save(fig, "fig2-roc.png")
    return auc


# --------------------------------------------------------------------------
# Fig 3 — the judgement chart. We did not take the maximum, and why.
# --------------------------------------------------------------------------
def fig_weight_sweep() -> None:
    pts = DATA["weightSweep"]["points"]
    shape = np.array([p["shape"] for p in pts])
    acc = np.array([p["accuracy"] * 100 for p in pts])
    shipped = DATA["scorer"]["weights"]["shape"]
    i_ship = int(np.argmin(np.abs(shape - shipped)))
    i_best = int(np.argmax(acc))

    fig, ax = plt.subplots(figsize=(8, 4.6))
    ax.plot(shape, acc, color=TEAL, lw=2.2, marker="o", ms=5)
    ax.scatter([shape[i_best]], [acc[i_best]], s=150, facecolor="white",
               edgecolor=RUST, lw=2.2, zorder=5)
    ax.scatter([shape[i_ship]], [acc[i_ship]], s=150, facecolor="white",
               edgecolor=INK, lw=2.2, zorder=5)
    ax.annotate(
        f"maximum {acc[i_best]:.1f}%\nmovement discarded entirely\n— rejected",
        xy=(shape[i_best], acc[i_best]), xytext=(shape[i_best] - 0.30, acc[i_best] - 3.4),
        fontsize=9.5, color=RUST, ha="left",
        arrowprops=dict(arrowstyle="->", color=RUST, lw=1.1),
    )
    ax.annotate(
        f"shipped {acc[i_ship]:.1f}%\nkeeps movement in scope",
        xy=(shape[i_ship], acc[i_ship]), xytext=(shape[i_ship] - 0.42, acc[i_ship] + 1.6),
        fontsize=9.5, color=INK, ha="left",
        arrowprops=dict(arrowstyle="->", color=INK, lw=1.1),
    )
    ax.set_xlabel("W_SHAPE  (handshape weight; trajectory weight = 1 − W_SHAPE)")
    ax.set_ylabel("separation accuracy")
    ax.yaxis.set_major_formatter(PercentFormatter(decimals=0))
    ax.set_title("The best-scoring weighting is the wrong one for a tutor")
    ax.grid(alpha=0.5)
    caption(
        fig,
        f"Grid search, {DATA['weightSweep']['signs']} signs with "
        f"≥{DATA['weightSweep']['minTakes']} takes. The search optimises "
        "\"is this the same sign?\"; the scorer's job is to grade a known one.",
    )
    save(fig, "fig3-weight-sweep.png")


# --------------------------------------------------------------------------
# Fig 4 — the 0–100 scale a learner actually sees, over the real distribution.
# --------------------------------------------------------------------------
def fig_score_scale() -> None:
    fig, ax = plt.subplots(figsize=(8, 4.4))
    d = np.linspace(0, 1.05, 400)
    s = np.clip((1 - (d - D_PERFECT) / (D_ZERO - D_PERFECT)) * 100, 0, 100)
    ax.plot(d, s, color=TEAL, lw=2.6, zorder=4)

    ax2 = ax.twinx()
    bins = np.linspace(0, 1.05, 46)
    ax2.hist(pos, bins=bins, density=True, color=TEAL, alpha=0.16)
    ax2.hist(neg, bins=bins, density=True, color=RUST, alpha=0.16)
    ax2.set_yticks([])
    ax2.spines["right"].set_visible(False)
    ax2.set_ylabel("distribution of measured distances", fontsize=9, color=GREY)

    for x, lab in ((D_PERFECT, f"D_PERFECT {D_PERFECT}\ncorrect-rendition p10"),
                   (D_ZERO, f"D_ZERO {D_ZERO}\ncorrect-rendition p90")):
        ax.axvline(x, color=CAUTION, lw=1.2, ls=":", zorder=3)
        ax.text(x + 0.012, 52, lab, fontsize=8.5, color=CAUTION, va="center")

    med = float(np.median(pos))
    ax.scatter([med], [np.interp(med, d, s)], s=90, color=INK, zorder=6)
    ax.annotate(
        f"median correct rendition\nd={med:.3f} → {np.interp(med, d, s):.0f}/100",
        xy=(med, np.interp(med, d, s)), xytext=(med + 0.10, 78),
        fontsize=9, arrowprops=dict(arrowstyle="->", color=INK, lw=0.9),
    )
    ax.set_xlabel("normalised DTW distance")
    ax.set_ylabel("score shown to the learner")
    ax.set_ylim(-2, 104)
    ax.set_xlim(0, 1.05)
    ax.set_title("The 0–100 scale is fitted to measured data, not chosen")
    ax.grid(axis="y", alpha=0.5)
    caption(
        fig,
        "Previous anchors (0.05 / 0.35) predated any data: D_ZERO sat below the "
        "median correct rendition, so a correct attempt scored 0.",
    )
    save(fig, "fig4-score-scale.png")


# --------------------------------------------------------------------------
# Fig 5 — per-sign. Where the corpus serves the learner worst.
# --------------------------------------------------------------------------
def fig_per_sign() -> None:
    rows = sorted(DATA["perSign"], key=lambda r: r["accuracyAtGlobalCut"])
    glosses = [r["gloss"].replace("_", " ") for r in rows]
    accs = np.array([r["accuracyAtGlobalCut"] * 100 for r in rows])
    colors = [RUST if a < ACC * 100 else TEAL for a in accs]

    fig, ax = plt.subplots(figsize=(8, 7.4))
    ax.barh(glosses, accs, color=colors, height=0.72)
    ax.axvline(ACC * 100, color=INK, lw=1.6, ls="--")
    ax.text(ACC * 100 + 0.8, -0.9, f"corpus mean {ACC * 100:.1f}%",
            fontsize=9, color=INK, va="center")
    ax.set_xlabel("separation accuracy at the single global threshold")
    ax.xaxis.set_major_formatter(PercentFormatter(decimals=0))
    ax.set_xlim(0, 102)
    ax.set_title("Per-sign separation — one threshold does not fit every sign")
    ax.grid(axis="x", alpha=0.5)
    ax.tick_params(axis="y", labelsize=8.5)
    caption(
        fig,
        f"{SOURCE}. Signs below the mean are candidates for a per-sign threshold "
        "or a better reference recording.",
    )
    save(fig, "fig5-per-sign-separation.png")


# --------------------------------------------------------------------------
# Fig 6 — scoring cost against the 300 ms budget.
# --------------------------------------------------------------------------
def fig_scoring_cost() -> None:
    samples = DATA["scoringCost"]["samples"]
    ms = np.array([s["ms"] for s in samples])
    two = np.array([s["twoHanded"] for s in samples])

    fig, (ax, ax2) = plt.subplots(
        1, 2, figsize=(9.6, 4.3), gridspec_kw={"width_ratios": [1.55, 1]}
    )

    ax.scatter(
        [s["attemptFrames"] * s["referenceFrames"] for s in np.array(samples)[~two]],
        ms[~two], s=42, color=TEAL, alpha=0.85, label="one-handed",
    )
    ax.scatter(
        [s["attemptFrames"] * s["referenceFrames"] for s in np.array(samples)[two]],
        ms[two], s=42, color=RUST, alpha=0.85, label="two-handed (2 alignments)",
    )
    ax.set_xlabel("DTW matrix cells  (attempt frames × reference frames)")
    ax.set_ylabel("scoring cost (ms)")
    ax.set_title("Cost tracks the DTW matrix, as O(n·m) predicts")
    ax.legend(loc="upper left", fontsize=9)
    ax.grid(alpha=0.5)

    med, p95 = float(np.median(ms)), float(np.percentile(ms, 95))
    ax2.grid(axis="y", alpha=0.5)
    ax2.set_axisbelow(True)
    ax2.bar([0], [med], color=TEAL, width=0.42, zorder=3)
    ax2.bar([1], [p95], color=TEAL_SOFT, width=0.42, zorder=3)
    ax2.axhline(300, color=RUST, lw=2.2, zorder=4)
    ax2.text(-0.62, 340, "300 ms proposal budget", color=RUST, fontsize=9.5,
             va="bottom", ha="left", fontweight="bold")
    for x, v, lab in ((0, med, "median"), (1, p95, "p95")):
        ax2.text(x, v * 1.45, f"{v:.1f} ms", ha="center", fontsize=10.5,
                 fontweight="bold", color=INK)
        pass
    ax2.set_xticks([0, 1])
    ax2.set_xticklabels(["median", "p95"], fontsize=9.5, color=GREY)
    ax2.annotate(
        "", xy=(1.62, 300), xytext=(1.62, med),
        arrowprops=dict(arrowstyle="<->", color=GREY, lw=1.2),
    )
    ax2.text(1.70, 26, f"~{300 / med:.0f}×\nheadroom", fontsize=9.5, color=GREY, va="center")
    ax2.set_yscale("log")
    ax2.set_ylim(0.5, 1500)
    ax2.set_ylabel("ms (log scale)")
    ax2.set_title("Scoring stage vs the budget")
    ax2.set_xlim(-0.7, 2.5)

    caption(
        fig,
        f"n={len(ms)} references, median of {DATA['scoringCost']['repeats']} runs after warm-up, "
        "in Node on a development machine. This is the SCORING STAGE ONLY — "
        "not end-to-end feedback latency, which is measured live in the browser.",
    )
    save(fig, "fig6-scoring-cost.png")


# --------------------------------------------------------------------------
# Fig 7 — the honest counterweight: a grader, not a classifier.
# --------------------------------------------------------------------------
def fig_confusable() -> None:
    closest = DATA["confusable"]["closest"][:10][::-1]
    labels = [f"{c['a']} vs {c['b']}".replace("_", " ") for c in closest]
    dists = [c["distance"] for c in closest]
    med_pos = float(np.median(pos))

    fig, ax = plt.subplots(figsize=(8, 4.6))
    ax.barh(labels, dists, color=RUST, alpha=0.8, height=0.68)
    ax.axvline(med_pos, color=TEAL, lw=2)
    ax.text(med_pos + 0.008, -0.85, f"median distance between two takes\nof the SAME sign ({med_pos:.3f})",
            fontsize=9, color=TEAL, va="center")
    ax.set_xlabel("normalised DTW distance between two DIFFERENT signs")
    ax.set_xlim(0, max(med_pos * 1.25, max(dists) * 1.15))
    ax.set_title("Why this grades a known sign and never classifies one")
    ax.grid(axis="x", alpha=0.5)
    ax.tick_params(axis="y", labelsize=9)
    caption(
        fig,
        f"Closest 10 of {DATA['confusable']['pairs']:,} distinct-sign pairs over "
        f"{DATA['confusable']['referencesSampled']} bundled references. Some distinct signs sit "
        "closer than two correct takes of one sign — so a high score is not proof of the right sign.",
    )
    save(fig, "fig7-confusable-pairs.png")


# --------------------------------------------------------------------------
# Fig 8 — what the learner actually experiences. The app applies no threshold;
# it shows a graded score. This is the separation that matters operationally.
# --------------------------------------------------------------------------
def fig_score_separation() -> None:
    sp = np.array([p["score"] for p in pairs if p["label"] == 1], dtype=float)
    sn = np.array([p["score"] for p in pairs if p["label"] == 0], dtype=float)

    fig, ax = plt.subplots(figsize=(8.4, 4.8))
    bins = np.arange(-2.5, 106, 5)
    ax.hist(sn, bins=bins, density=True, color=RUST, alpha=0.55,
            label=f"different sign — mean {sn.mean():.1f}")
    ax.hist(sp, bins=bins, density=True, color=TEAL, alpha=0.62,
            label=f"correct rendition — mean {sp.mean():.1f}")

    top = ax.get_ylim()[1]
    ax.set_ylim(0, top * 1.46)
    for m, c in ((sn.mean(), RUST), (sp.mean(), TEAL)):
        ax.axvline(m, color=c, lw=2.4, ymax=0.62)
    ax.annotate(
        "", xy=(sp.mean(), top * 0.92), xytext=(sn.mean(), top * 0.92),
        arrowprops=dict(arrowstyle="<->", color=INK, lw=1.6),
    )
    ax.text((sp.mean() + sn.mean()) / 2, top * 0.98,
            f"{sp.mean() - sn.mean():.1f}-point gap",
            ha="center", fontsize=12.5, fontweight="bold", color=INK)
    ax.set_xlabel("score shown to the learner  (0–100)")
    ax.set_ylabel("density")
    ax.set_xlim(-3, 103)
    ax.set_title("The module grades on a continuous scale — it never applies a threshold")
    ax.legend(loc="upper left", fontsize=9.5, bbox_to_anchor=(0.02, 1.0))
    ax.grid(axis="y", alpha=0.5)
    caption(
        fig,
        f"{SOURCE}. {(sp >= 50).mean() * 100:.0f}% of correct renditions score ≥ 50 "
        f"against {(sn >= 50).mean() * 100:.0f}% of different signs. The 0 and 100 spikes "
        "are the anchors saturating by design.",
    )
    save(fig, "fig8-score-separation.png")


# --------------------------------------------------------------------------
# Fig 9 — the headline figure against the baseline that makes it meaningful.
# Stated up front rather than waited for.
# --------------------------------------------------------------------------
def fig_baseline() -> None:
    n_pos, n_neg = len(pos), len(neg)
    baseline = n_neg / (n_pos + n_neg)
    tpr, fpr = (pos <= CUT).mean(), (neg <= CUT).mean()
    bal = (tpr + (1 - fpr)) / 2

    thresholds = np.unique(np.concatenate([pos, neg]))
    t_ = np.array([(pos <= t).mean() for t in thresholds])
    f_ = np.array([(neg <= t).mean() for t in thresholds])
    o = np.argsort(f_)
    auc = float(np.trapezoid(np.r_[0, t_[o], 1], np.r_[0, f_[o], 1]))

    labels = [
        "always guess\n“different sign”\n(majority baseline)",
        "DTW scorer\nbest single\nthreshold",
        "DTW scorer\nbalanced\naccuracy",
        "DTW scorer\nROC AUC\n(threshold-free)",
    ]
    values = [baseline * 100, ACC * 100, bal * 100, auc * 100]

    fig, ax = plt.subplots(figsize=(8.4, 4.6))
    ax.grid(axis="y", alpha=0.5)
    ax.set_axisbelow(True)
    bars = ax.bar(labels, values, color=[GREY, TEAL, TEAL_SOFT, TEAL], width=0.58, zorder=3)
    for b, v in zip(bars, values):
        ax.text(b.get_x() + b.get_width() / 2, v + 1.6, f"{v:.1f}%",
                ha="center", fontsize=12, fontweight="bold", color=INK)
    ax.axhline(baseline * 100, color=GREY, lw=1.4, ls="--", zorder=4)
    ax.axhline(50, color=RUST, lw=1.2, ls=":", zorder=4)
    ax.text(3.42, 50, "chance", fontsize=9, color=RUST, va="center")
    ax.set_ylim(0, 92)
    ax.set_ylabel("accuracy")
    ax.yaxis.set_major_formatter(PercentFormatter(decimals=0))
    ax.set_title(
        f"Stated against its baseline: +{(ACC - baseline) * 100:.1f} points, "
        f"not {ACC * 100:.1f} from nothing"
    )
    ax.tick_params(axis="x", labelsize=9)
    caption(
        fig,
        f"{SOURCE}. Classes are imbalanced ({n_pos} positive / {n_neg} negative), so raw "
        "accuracy flatters. AUC and balanced accuracy are the imbalance-free readings.",
    )
    save(fig, "fig9-baseline-comparison.png")


if __name__ == "__main__":
    print("Rendering figures from data/raw-metrics.json")
    print(f"  corpus: {SOURCE}")
    fig_distributions()
    auc = fig_roc()
    fig_weight_sweep()
    fig_score_scale()
    fig_per_sign()
    fig_scoring_cost()
    fig_confusable()
    fig_score_separation()
    fig_baseline()
    print(f"\nHeadline figures")
    print(f"  separation      {ACC * 100:.1f}%  at threshold {CUT:.3f}")
    print(f"  ROC AUC         {auc:.3f}")
    print(f"  median correct  {np.median(pos):.3f}   median different  {np.median(neg):.3f}")
    print(f"  scoring cost    median {np.median([s['ms'] for s in DATA['scoringCost']['samples']]):.1f} ms")
    print(f"\n  -> {FIG}")
