/**
 * SoundGuard — Pure JavaScript FFT Implementation
 * ────────────────────────────────────────────────
 * Radix-2 Cooley-Tukey FFT for on-device audio feature extraction.
 * No native dependencies — runs in the Hermes JS engine.
 *
 * Used to compute Short-Time Fourier Transform (STFT) frames,
 * which are then mapped to Mel-frequency bands for CNN input.
 */

/**
 * Compute the radix-2 FFT of a real-valued signal.
 *
 * @param signal - Input signal (length must be a power of 2)
 * @returns Magnitude spectrum (length = N/2 + 1)
 */
export function fftMagnitude(signal: Float32Array): Float32Array {
  const N = signal.length;
  if (N & (N - 1)) {
    throw new Error(`FFT length must be power of 2, got ${N}`);
  }

  // Perform in-place FFT on interleaved [real, imag] pairs
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  re.set(signal);

  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < N; i++) {
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
    let m = N >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }

  // Cooley-Tukey butterfly
  for (let size = 2; size <= N; size *= 2) {
    const half = size >> 1;
    const angle = (-2 * Math.PI) / size;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);

    for (let i = 0; i < N; i += size) {
      let curRe = 1;
      let curIm = 0;

      for (let k = 0; k < half; k++) {
        const evenIdx = i + k;
        const oddIdx = i + k + half;

        const tRe = curRe * re[oddIdx] - curIm * im[oddIdx];
        const tIm = curRe * im[oddIdx] + curIm * re[oddIdx];

        re[oddIdx] = re[evenIdx] - tRe;
        im[oddIdx] = im[evenIdx] - tIm;
        re[evenIdx] += tRe;
        im[evenIdx] += tIm;

        const newRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = newRe;
      }
    }
  }

  // Compute magnitude spectrum (only positive frequencies)
  const halfN = (N >> 1) + 1;
  const mags = new Float32Array(halfN);
  for (let i = 0; i < halfN; i++) {
    mags[i] = re[i] * re[i] + im[i] * im[i]; // power spectrum
  }
  return mags;
}

/**
 * Apply a Hann window to a signal frame.
 * Reduces spectral leakage in STFT.
 */
export function hannWindow(length: number): Float32Array {
  const window = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (length - 1)));
  }
  return window;
}

/**
 * Compute the Short-Time Fourier Transform (STFT) power spectrogram.
 *
 * @param signal   - Raw audio samples
 * @param nFft     - FFT window size
 * @param hopLength - Hop between frames
 * @returns 2D power spectrogram [nFreqs x nFrames]
 */
export function stft(
  signal: Float32Array,
  nFft: number,
  hopLength: number,
): Float32Array[] {
  const window = hannWindow(nFft);
  const nFreqs = (nFft >> 1) + 1;
  const nFrames = Math.floor((signal.length - nFft) / hopLength) + 1;
  const frames: Float32Array[] = [];

  const frame = new Float32Array(nFft);

  for (let t = 0; t < nFrames; t++) {
    const offset = t * hopLength;
    // Apply window to frame
    for (let i = 0; i < nFft; i++) {
      frame[i] = (offset + i < signal.length ? signal[offset + i] : 0) * window[i];
    }
    frames.push(fftMagnitude(new Float32Array(frame)));
  }

  return frames;
}
