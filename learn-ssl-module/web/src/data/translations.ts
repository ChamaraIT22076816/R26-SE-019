/**
 * English meanings for the Sinhala-transliterated dataset labels.
 *
 * The gloss itself is the dataset's own filename and is never invented. These
 * meanings are a *display aid* for hearing learners, who cannot practise a sign
 * whose meaning they do not know.
 *
 * ONLY human-verified meanings belong here. A missing entry simply shows the
 * gloss on its own, which is honest; a guessed entry would teach a learner the
 * wrong word. Do not fill these in from a dictionary or by inference — have a
 * Sinhala speaker confirm each one.
 *
 * Letters (A–Z), numbers and months carry their meaning already and need no
 * entry.
 *
 * Verified by kvn (native Sinhala speaker), Aug 2026.
 */
export const GLOSS_TRANSLATIONS: Record<string, string> = {
  KANAWA: 'eat',
  BONAWA: 'drink',
  BILPATHA: 'bill',
  'MILADII GANNAWA': 'buy',

  // --- awaiting confirmation -------------------------------------------------
  // Uncomment a line and fill in the meaning once you are sure of it. Anything
  // left commented simply displays as the bare gloss, which is the safe default.
  // '100 METERS': '',
  // '50 METERS': '',
  // ADINAWA: '',
  // 'ADUM SODANAWA': '',
  // AHANAWA: '',
  // AMBARANAWA: '',
  // ANDANAWA: '',
  // ANDINAWA: '',
  // ASNIIPAI: '',
  // 'ATHU GAANAWA': '',
  // AWIDINAWA: '',
  // 'BAG EKA': '',
  // BALANAWA: '',
  // DAKINAWA: '',
  // DAKUNATA: '',
  // 'DAKUNATA HARENNA': '',
  // DENAWA: '',
  // DUWANAWA: '',
  // ELLANAWA: '',
  // GANNAWA: '',
  // 'GAS KAPANAWA': '',
  // 'GEDARA ISSARAHA': '',
  // 'GEYAK HADANAWA': '',
  // HAARANAWA: '',
  // HADANAWA: '',
  // 'HATHARAMN HANDIYA': '',
  // HINAWENAWA: '',
  // IRANAWA: '',
  // 'KAAMAK HADANAWA': '',
  // KADANAWA: '',
  // KADAYA: '',
  // 'KANDA NAGALA BAHINNA': '',
  // KASANAWA: '',
  // KOTANAWA: '',
  // 'KUNU DAMANAWA': '',
  // 'LAPTOP EKA': '',
  // LIYANAWA: '',
  // MAKANAWA: '',
  // 'MAS MAALU KAPANAWA': '',
  // 'MUUNA KASANAWA': '',
  // 'MUUNA SOODANAWA': '',
  // NAANAWA: '',
  // NAGITINAWA: '',
  // NURSE: '',
  // 'OLUWA KASANAWA': '',
  // OSAWANAWA: '',
  // 'PAADAM KARANAWA': '',
  // 'PAAN KAPANAWA': '',
  // 'PAARE IDIRIYATA YANNA': '',
  // PANINAWA: '',
  // PEENAWA: '',
  // 'PHONE EKA': '',
  // 'PIGANA HODANAWA': '',
  // PIHINANAWA: '',
  // 'PITIPASSATA ENNA': '',
  // 'RANDU KARAGANNAWA': '',
  // SODANAWA: '',
  // SOYNAWA: '',
  // 'SUDU KOLAYAK': '',
  // 'THATTU KARANAWA': '',
  // 'THERUM GANNAWA': '',
  // THORANAWA: '',
  // 'UDAW KARANAWA': '',
  // UTHURANAWA: '',
  // 'WAADI WENAWA': '',
  // 'WADA KARANAWA': '',
  // WAMA: '',
  // 'WAMAATA HARENNA': '',
  // 'WAMATA U TURN EKEN HARENNA': '',
  // 'WIYADAM KARANAWA': '',
  // YANAWA: '',
}

/** Verified English meaning for a gloss, or undefined if nobody has confirmed one. */
export function translationOf(gloss: string): string | undefined {
  return GLOSS_TRANSLATIONS[gloss]
}

/** "KANAWA (eat)" when a meaning is known, otherwise just "KANAWA". */
export function glossLabel(gloss: string): string {
  const meaning = translationOf(gloss)
  return meaning ? `${gloss} (${meaning})` : gloss
}

/** True if the gloss matches a search term by name or by meaning. */
export function matchesSearch(gloss: string, needle: string): boolean {
  if (needle === '') return true
  const upper = needle.toUpperCase()
  if (gloss.includes(upper)) return true
  const meaning = translationOf(gloss)
  return meaning !== undefined && meaning.toUpperCase().includes(upper)
}
