/**
 * SoundGuard — Mel-Spectrogram Feature Extraction
 * ─────────────────────────────────────────────────────────────────────────────
 * Parameters are locked to the Python training pipeline:
 *   sample rate 22 050 Hz · n_fft 2048 · hop 512 · n_mels 128 · clip 3.0 s
 *
 * ── The performance defect this file fixes ──────────────────────────────────
 *
 * The previous implementation projected the spectrogram onto the mel basis with
 * a dense triple loop:
 *
 *     for m in 128 mels:  for t in 126 frames:  for k in 1025 bins: sum += ...
 *
 * That is 16.5 million iterations per analysis window, over `number[][]` arrays
 * built with `push`. On a mid-range Android device it blocks the JS thread for
 * roughly one to two seconds — every single window, synchronously, inside the
 * audio callback. React had no opportunity to commit a render and no touch
 * event could be dispatched, which is precisely why detections appeared in the
 * terminal instantly while the UI lagged far behind: the thread was saturated,
 * so the scheduled render never got a slot.
 *
 * Two changes remove it:
 *
 *   1. SPARSE MEL BASIS. Every triangular mel filter is non-zero over a narrow
 *      contiguous bin span. Summed across all 128 filters that is ~2 × 1025
 *      non-zero weights, not 128 × 1025. Storing (start, length, weights) and
 *      iterating only the support cuts the projection by ~65×, to roughly
 *      260 000 multiply-adds. The numerical result is bit-identical: the sparse
 *      basis is built by compressing the exact same dense triangular filters.
 *
 *   2. COOPERATIVE YIELDING. Extraction is async and returns to the event loop
 *      via a macrotask every few STFT frames. Total wall-clock cost is a few
 *      milliseconds higher; the difference is that the JS thread is now
 *      interruptible, so React commits and touch handlers run *during* feature
 *      extraction rather than after it.
 *
 * Scratch buffers are module-level and reused. Concurrency is prevented by the
 * engine's single-flight mutex, which is asserted here rather than assumed.
 */

import { binCount, fftPowerSpectrum, frameCount, hannWindow } from './fft';

// ─── Parameters (must match training) ────────────────────────────────────────
export const SAMPLE_RATE = 22050;
export const N_FFT = 2048;
export const HOP_LENGTH = 512;
export const N_MELS = 128;
export const CLIP_DURATION = 3.0;
export const CLIP_SAMPLES = Math.floor(SAMPLE_RATE * CLIP_DURATION); // 66 150
export const MEL_SPEC_WIDTH = 128;

const N_BINS = binCount(N_FFT); // 1025
const MAX_FRAMES = frameCount(CLIP_SAMPLES, N_FFT, HOP_LENGTH); // 126

/**
 * Cooperative yielding is budgeted by elapsed time, not by a fixed slice count.
 *
 * A macrotask yield is not free — measured at roughly 9 ms each under Node and
 * up to a frame under React Native's timer module — so a fixed schedule either
 * over-yields on a fast device (pure overhead) or under-yields on a slow one
 * (visible jank). Checking the clock instead means a device that finishes the
 * whole window inside the budget yields zero times, while a slow device yields
 * exactly as often as it needs to keep every slice under ~24 ms.
 */
const YIELD_BUDGET_MS = 24;
/** How often to consult the clock. Cheap, but not free, so not every frame. */
const FRAMES_PER_CHECK = 8;
const MELS_PER_CHECK = 16;

// ─── Mel filterbank (sparse) ─────────────────────────────────────────────────

type SparseFilterbank = {
  /** First non-zero FFT bin for each mel band. */
  starts: Int32Array;
  /** Number of non-zero bins for each mel band. */
  lengths: Int32Array;
  /** Index into `weights` where each mel band's run begins. */
  offsets: Int32Array;
  /** Concatenated non-zero triangular weights. */
  weights: Float32Array;
};

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

/**
 * Build the mel basis, then compress each row to its non-zero support.
 *
 * The dense row is constructed with exactly the same expressions as the
 * original implementation, so the compressed basis reproduces its output
 * value-for-value.
 */
function buildSparseFilterbank(nMels: number, nFft: number, sr: number): SparseFilterbank {
  const nFreqs = binCount(nFft);
  const melMin = hzToMel(0);
  const melMax = hzToMel(sr / 2);

  const bins = new Int32Array(nMels + 2);
  for (let i = 0; i < nMels + 2; i++) {
    const mel = melMin + (i * (melMax - melMin)) / (nMels + 1);
    bins[i] = Math.floor(((nFft + 1) * melToHz(mel)) / sr);
  }

  const starts = new Int32Array(nMels);
  const lengths = new Int32Array(nMels);
  const offsets = new Int32Array(nMels);
  const runs: number[][] = [];
  let total = 0;

  const dense = new Float32Array(nFreqs);

  for (let m = 0; m < nMels; m++) {
    dense.fill(0);

    const left = bins[m] as number;
    const center = bins[m + 1] as number;
    const right = bins[m + 2] as number;

    const lo = Math.max(0, Math.min(left, nFreqs - 1));
    const hi = Math.max(0, Math.min(right, nFreqs - 1));

    for (let k = lo; k <= hi; k++) {
      if (k >= left && k <= center && center > left) {
        dense[k] = (k - left) / (center - left);
      } else if (k >= center && k <= right && right > center) {
        dense[k] = (right - k) / (right - center);
      }
    }

    // Compress to the non-zero support.
    let first = -1;
    let last = -1;
    for (let k = lo; k <= hi; k++) {
      if ((dense[k] as number) !== 0) {
        if (first < 0) first = k;
        last = k;
      }
    }

    if (first < 0) {
      starts[m] = 0;
      lengths[m] = 0;
      offsets[m] = total;
      runs.push([]);
      continue;
    }

    const run: number[] = [];
    for (let k = first; k <= last; k++) run.push(dense[k] as number);

    starts[m] = first;
    lengths[m] = run.length;
    offsets[m] = total;
    total += run.length;
    runs.push(run);
  }

  const weights = new Float32Array(total);
  let w = 0;
  for (const run of runs) {
    for (let i = 0; i < run.length; i++) weights[w++] = run[i] as number;
  }

  return { starts, lengths, offsets, weights };
}

let _filterbank: SparseFilterbank | null = null;
function getFilterbank(): SparseFilterbank {
  if (!_filterbank) _filterbank = buildSparseFilterbank(N_MELS, N_FFT, SAMPLE_RATE);
  return _filterbank;
}

// ─── Reusable scratch ────────────────────────────────────────────────────────

const signalBuf = new Float32Array(CLIP_SAMPLES);
const frameBuf = new Float32Array(N_FFT);
const powerBuf = new Float32Array(MAX_FRAMES * N_BINS);
const logMelBuf = new Float32Array(N_MELS * MAX_FRAMES);

let _busy = false;
/** Timestamp of the last yield, used by the elapsed-time budget. */
let _sliceStart = 0;

/**
 * Hand the JS thread back to the event loop so React can commit and queued
 * touch events can be dispatched.
 *
 * `setTimeout(0)` specifically: a microtask (`Promise.resolve()`) drains before
 * the next macrotask and would never return control to the platform, so it
 * would not unblock rendering at all.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Yield only if this slice has already consumed its time budget. */
async function yieldIfOverBudget(): Promise<void> {
  if (Date.now() - _sliceStart < YIELD_BUDGET_MS) return;
  await yieldToEventLoop();
  _sliceStart = Date.now();
}

// ─── Extraction ──────────────────────────────────────────────────────────────

/**
 * Convert raw PCM at SAMPLE_RATE into the flattened, normalised mel-spectrogram
 * the CNN expects: Float32Array of length N_MELS × MEL_SPEC_WIDTH, laid out
 * row-major as `[mel * MEL_SPEC_WIDTH + frame]`.
 *
 * Yields to the event loop periodically; the returned promise resolves once the
 * full feature map is ready. The input array is not mutated.
 *
 * @throws if called re-entrantly — the shared scratch buffers make concurrent
 *         extraction unsafe, and the engine already serialises calls.
 */
export async function extractMelSpectrogramAsync(pcm: Float32Array): Promise<Float32Array> {
  if (_busy) {
    throw new Error('extractMelSpectrogramAsync is not re-entrant');
  }
  _busy = true;
  _sliceStart = Date.now();

  try {
    // ── 1. Copy into the fixed-length window, padding or centre-cropping ──
    signalBuf.fill(0);
    if (pcm.length >= CLIP_SAMPLES) {
      const start = Math.floor((pcm.length - CLIP_SAMPLES) / 2);
      signalBuf.set(pcm.subarray(start, start + CLIP_SAMPLES));
    } else {
      signalBuf.set(pcm);
    }

    // ── 2. Peak-normalise amplitude (matches the training preprocessing) ──
    let peak = 0;
    for (let i = 0; i < CLIP_SAMPLES; i++) {
      const a = Math.abs(signalBuf[i] as number);
      if (a > peak) peak = a;
    }
    if (peak > 0) {
      const inv = 1 / peak;
      for (let i = 0; i < CLIP_SAMPLES; i++) {
        signalBuf[i] = (signalBuf[i] as number) * inv;
      }
    }

    // ── 3. STFT power spectrogram, sliced so the UI stays responsive ──
    const window = hannWindow(N_FFT);
    const nFrames = MAX_FRAMES;

    for (let t = 0; t < nFrames; t++) {
      const offset = t * HOP_LENGTH;
      for (let i = 0; i < N_FFT; i++) {
        const idx = offset + i;
        frameBuf[i] = (idx < CLIP_SAMPLES ? (signalBuf[idx] as number) : 0) * (window[i] as number);
      }
      fftPowerSpectrum(frameBuf, powerBuf.subarray(t * N_BINS, t * N_BINS + N_BINS));

      if ((t + 1) % FRAMES_PER_CHECK === 0 && t + 1 < nFrames) {
        await yieldIfOverBudget();
      }
    }

    // ── 4. Sparse mel projection + log scaling ──
    const { starts, lengths, offsets, weights } = getFilterbank();
    let globalMax = -Infinity;
    let globalMin = Infinity;

    for (let m = 0; m < N_MELS; m++) {
      const start = starts[m] as number;
      const len = lengths[m] as number;
      const off = offsets[m] as number;
      const rowBase = m * nFrames;

      for (let t = 0; t < nFrames; t++) {
        const frameBase = t * N_BINS + start;
        let sum = 0;
        for (let j = 0; j < len; j++) {
          sum += (weights[off + j] as number) * (powerBuf[frameBase + j] as number);
        }
        const db = 10 * Math.log10(sum > 1e-10 ? sum : 1e-10);
        logMelBuf[rowBase + t] = db;
        if (db > globalMax) globalMax = db;
        if (db < globalMin) globalMin = db;
      }

      if ((m + 1) % MELS_PER_CHECK === 0 && m + 1 < N_MELS) {
        await yieldIfOverBudget();
      }
    }

    // ── 5. Normalise to [0, 1] and flatten to the model's input layout ──
    // A fresh buffer is returned each call: the ONNX Tensor keeps a reference
    // to it for the duration of the native run, so it must not be recycled.
    const out = new Float32Array(N_MELS * MEL_SPEC_WIDTH);
    const range = globalMax - globalMin || 1;
    const invRange = 1 / range;
    const usable = Math.min(nFrames, MEL_SPEC_WIDTH);

    for (let m = 0; m < N_MELS; m++) {
      const rowBase = m * nFrames;
      const outBase = m * MEL_SPEC_WIDTH;
      for (let t = 0; t < usable; t++) {
        out[outBase + t] = ((logMelBuf[rowBase + t] as number) - globalMin) * invRange;
      }
      // Frames beyond `usable` stay zero-padded, as in the training pipeline.
    }

    return out;
  } finally {
    _busy = false;
  }
}

/** Root-mean-square energy of a PCM buffer. O(n), synchronous. */
export function computeRMS(samples: Float32Array, length = samples.length): number {
  if (length <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < length; i++) {
    const s = samples[i] as number;
    sum += s * s;
  }
  return Math.sqrt(sum / length);
}
