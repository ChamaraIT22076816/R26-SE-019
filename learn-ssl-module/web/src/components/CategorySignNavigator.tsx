import { useMemo, useState } from 'react'
import type { RecordingMeta } from '../vision/types'
import { categoriesIn, categoryOf } from '../data/categories'
import { glossLabel, matchesSearch, translationOf } from '../data/translations'

export interface CategorySignNavigatorProps {
  references: RecordingMeta[]
  suggested?: string | null
  selectedId?: string | null
  mode?: 'practice' | 'record'
  isModal?: boolean
  onSelect: (sign: RecordingMeta) => void
  onCreateCustom?: (gloss: string) => void
  onClose?: () => void
}

/** Category visual icon/glyph helper */
function categoryIcon(category: string): string {
  switch (category.toLowerCase()) {
    case 'greetings':
      return '👋'
    case 'verbs':
      return '⚡'
    case 'nouns':
      return '📦'
    case 'people':
      return '👥'
    case 'places':
      return '📍'
    case 'food & drink':
    case 'food':
      return '🍽️'
    case 'colors':
      return '🎨'
    case 'days':
    case 'months':
      return '📅'
    case 'numbers':
    case '20-99':
    case '100-1 million':
      return '🔢'
    case 'a-z':
      return '🔤'
    case 'vehicles':
      return '🚗'
    case 'adjectives':
    case 'adverb':
      return '✨'
    case 'my recordings':
      return '⭐'
    default:
      return '🏷️'
  }
}

export function CategorySignNavigator({
  references,
  suggested = null,
  selectedId = null,
  mode = 'practice',
  isModal = false,
  onSelect,
  onCreateCustom,
  onClose,
}: CategorySignNavigatorProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [globalQuery, setGlobalQuery] = useState('')
  const [categoryQuery, setCategoryQuery] = useState('')

  // Unique categories list
  const categories = useMemo(() => categoriesIn(references), [references])

  // Signs grouped by category for quick lookup and previews
  const signsByCategory = useMemo(() => {
    const map = new Map<string, RecordingMeta[]>()
    for (const cat of categories) {
      map.set(cat, [])
    }
    for (const ref of references) {
      const cat = categoryOf(ref)
      const list = map.get(cat)
      if (list) {
        list.push(ref)
      } else {
        map.set(cat, [ref])
      }
    }
    return map
  }, [categories, references])

  // Global search results across all categories
  const globalSearchResults = useMemo(() => {
    const q = globalQuery.trim()
    if (!q) return []
    return references.filter((r) => matchesSearch(r.gloss, q))
  }, [references, globalQuery])

  // Scoped search results in selected category
  const categorySigns = useMemo(() => {
    if (!selectedCategory) return []
    const list = signsByCategory.get(selectedCategory) ?? []
    const q = categoryQuery.trim()
    if (!q) return list
    return list.filter((r) => matchesSearch(r.gloss, q))
  }, [selectedCategory, signsByCategory, categoryQuery])

  // Suggested sign record
  const suggestedRec = useMemo(() => {
    if (!suggested) return null
    return references.find((r) => r.gloss === suggested) ?? null
  }, [references, suggested])

  const isSearchingGlobal = globalQuery.trim().length > 0

  return (
    <div className={`cs-nav-container ${isModal ? 'cs-nav-modal' : 'cs-nav-page'}`}>
      {/* -------------------------------------------------------------
          Header / Topbar
         ------------------------------------------------------------- */}
      <div className="cs-nav-header">
        <div className="cs-nav-header-left">
          {selectedCategory && !isSearchingGlobal ? (
            <div className="cs-nav-breadcrumbs">
              <button
                type="button"
                className="cs-back-btn"
                onClick={() => {
                  setSelectedCategory(null)
                  setCategoryQuery('')
                }}
                aria-label="Back to all categories"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
                <span>Categories</span>
              </button>
              <span className="cs-crumb-sep">/</span>
              <span className="cs-crumb-current">
                <span className="cs-crumb-icon">{categoryIcon(selectedCategory)}</span>
                <strong>{selectedCategory}</strong>
                <span className="cs-crumb-count">
                  ({signsByCategory.get(selectedCategory)?.length ?? 0})
                </span>
              </span>
            </div>
          ) : (
            <div className="cs-nav-title-group">
              <h2 className="cs-nav-title">
                {mode === 'record' ? 'Select Sign to Record' : 'Choose a Category to Practice'}
              </h2>
              <p className="cs-nav-subtitle">
                {references.length} vocabulary signs across {categories.length} categories
              </p>
            </div>
          )}
        </div>

        {isModal && onClose && (
          <button type="button" className="btn btn-ghost cs-close-btn" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        )}
      </div>

      {/* -------------------------------------------------------------
          Search Bar
         ------------------------------------------------------------- */}
      <div className="cs-search-row">
        {selectedCategory && !isSearchingGlobal ? (
          <div className="cs-search-input-wrap">
            <svg className="cs-search-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="search"
              className="cs-search-input"
              value={categoryQuery}
              onChange={(e) => setCategoryQuery(e.target.value)}
              placeholder={`Search within ${selectedCategory} (${categorySigns.length} signs)...`}
              autoFocus
            />
            {categoryQuery && (
              <button
                type="button"
                className="cs-search-clear"
                onClick={() => setCategoryQuery('')}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>
        ) : (
          <div className="cs-search-input-wrap">
            <svg className="cs-search-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="search"
              className="cs-search-input"
              value={globalQuery}
              onChange={(e) => setGlobalQuery(e.target.value)}
              placeholder={`Search all ${references.length} signs (e.g., eat, thank you, ayubowan)...`}
            />
            {globalQuery && (
              <button
                type="button"
                className="cs-search-clear"
                onClick={() => setGlobalQuery('')}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>

      {/* -------------------------------------------------------------
          Step 1 (Main View): Categories Grid or Global Search Results
         ------------------------------------------------------------- */}
      {!selectedCategory && !isSearchingGlobal && (
        <div className="cs-category-view">
          {/* Suggested Sign Quick-Pick Banner */}
          {suggestedRec && mode === 'practice' && (
            <div className="cs-suggested-banner" onClick={() => onSelect(suggestedRec)} role="button" tabIndex={0}>
              <div className="cs-suggested-left">
                <span className="cs-suggested-tag">★ RECOMMENDED FOR YOU</span>
                <h3 className="cs-suggested-gloss">{glossLabel(suggestedRec.gloss)}</h3>
                {translationOf(suggestedRec.gloss) && (
                  <p className="cs-suggested-sub">Meaning: "{translationOf(suggestedRec.gloss)}"</p>
                )}
              </div>
              <div className="cs-suggested-right">
                <button type="button" className="btn cs-suggested-btn">
                  Start Practice →
                </button>
              </div>
            </div>
          )}

          {/* Admin Custom Mode Action Card */}
          {mode === 'record' && onCreateCustom && (
            <div className="cs-custom-gloss-card">
              <div className="cs-custom-info">
                <span className="cs-custom-icon">✨</span>
                <div>
                  <h4>Custom or New Vocabulary Sign</h4>
                  <p>Record a new sign not currently in the bundled corpus.</p>
                </div>
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const input = window.prompt('Enter new uppercase gloss name (e.g., HELLO_WORLD):')
                  if (input && input.trim()) {
                    onCreateCustom(input.trim().toUpperCase())
                  }
                }}
              >
                + Create Custom Gloss
              </button>
            </div>
          )}

          {/* Categories Grid */}
          <div className="cs-categories-grid">
            {categories.map((catName) => {
              const catSigns = signsByCategory.get(catName) ?? []
              const sampleSigns = catSigns.slice(0, 3).map((s) => glossLabel(s.gloss))
              return (
                <div
                  key={catName}
                  className="cs-category-card"
                  onClick={() => {
                    setSelectedCategory(catName)
                    setCategoryQuery('')
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setSelectedCategory(catName)
                      setCategoryQuery('')
                    }
                  }}
                >
                  <div className="cs-cat-top">
                    <span className="cs-cat-icon">{categoryIcon(catName)}</span>
                    <span className="cs-cat-badge">{catSigns.length} {catSigns.length === 1 ? 'sign' : 'signs'}</span>
                  </div>

                  <h3 className="cs-cat-name">{catName}</h3>

                  {sampleSigns.length > 0 && (
                    <div className="cs-cat-samples">
                      {sampleSigns.map((g, idx) => (
                        <span key={idx} className="cs-sample-pill">
                          {g}
                        </span>
                      ))}
                      {catSigns.length > 3 && (
                        <span className="cs-sample-more">+{catSigns.length - 3}</span>
                      )}
                    </div>
                  )}

                  <div className="cs-cat-footer">
                    <span className="cs-cat-action">Explore signs</span>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
          Global Search Results Grid (when user types in global search)
         ------------------------------------------------------------- */}
      {!selectedCategory && isSearchingGlobal && (
        <div className="cs-search-results-view">
          <div className="cs-results-bar">
            <span>Found <strong>{globalSearchResults.length}</strong> matching signs for "{globalQuery}"</span>
            <button
              type="button"
              className="btn btn-ghost small"
              onClick={() => setGlobalQuery('')}
            >
              Clear Search
            </button>
          </div>

          {globalSearchResults.length === 0 ? (
            <div className="cs-empty-state">
              <p>No signs match "{globalQuery}".</p>
              {mode === 'record' && onCreateCustom && (
                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: '12px' }}
                  onClick={() => onCreateCustom(globalQuery.trim().toUpperCase())}
                >
                  + Record new custom sign "{globalQuery.trim().toUpperCase()}"
                </button>
              )}
            </div>
          ) : (
            <div className="cs-signs-grid">
              {globalSearchResults.map((r) => {
                const meaning = translationOf(r.gloss)
                const isSelected = selectedId === r.id
                const isSuggested = suggested === r.gloss
                return (
                  <div
                    key={r.id}
                    className={`cs-sign-card ${isSelected ? 'selected' : ''} ${isSuggested ? 'suggested' : ''}`}
                    onClick={() => onSelect(r)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') onSelect(r)
                    }}
                  >
                    <div className="cs-sign-top">
                      <span className="cs-sign-cat-tag">{categoryOf(r)}</span>
                      {isSuggested && <span className="badge cs-suggested-chip">★ Suggested</span>}
                      {r.source === 'team-recording' && <span className="badge cs-team-chip">Team Take</span>}
                    </div>

                    <h4 className="cs-sign-gloss">{glossLabel(r.gloss)}</h4>
                    {meaning && <p className="cs-sign-meaning">"{meaning}"</p>}

                    <div className="cs-sign-arrow">
                      <span>{mode === 'record' ? 'Record' : 'Practice'}</span>
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* -------------------------------------------------------------
          Step 2: Signs List/Grid for Selected Category
         ------------------------------------------------------------- */}
      {selectedCategory && (
        <div className="cs-category-signs-view">
          {categorySigns.length === 0 ? (
            <div className="cs-empty-state">
              <p>No signs found matching "{categoryQuery}" in {selectedCategory}.</p>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setCategoryQuery('')}
              >
                Show all {signsByCategory.get(selectedCategory)?.length ?? 0} signs
              </button>
            </div>
          ) : (
            <div className="cs-signs-grid">
              {categorySigns.map((r) => {
                const meaning = translationOf(r.gloss)
                const isSelected = selectedId === r.id
                const isSuggested = suggested === r.gloss
                return (
                  <div
                    key={r.id}
                    className={`cs-sign-card ${isSelected ? 'selected' : ''} ${isSuggested ? 'suggested' : ''}`}
                    onClick={() => onSelect(r)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') onSelect(r)
                    }}
                  >
                    <div className="cs-sign-top">
                      <span className="cs-sign-cat-tag">{categoryOf(r)}</span>
                      {isSuggested && <span className="badge cs-suggested-chip">★ Suggested</span>}
                      {r.source === 'team-recording' && <span className="badge cs-team-chip">Team Take</span>}
                    </div>

                    <h4 className="cs-sign-gloss">{glossLabel(r.gloss)}</h4>
                    {meaning && <p className="cs-sign-meaning">"{meaning}"</p>}

                    <div className="cs-sign-arrow">
                      <span>{mode === 'record' ? 'Record' : 'Practice'}</span>
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
