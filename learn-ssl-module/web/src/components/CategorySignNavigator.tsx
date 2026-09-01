import { useMemo, useState } from 'react'
import type { RecordingMeta } from '../vision/types'
import { categoryOf, foldedCategoryOf, groupForPicker, orderSigns } from '../data/categories'
import { matchesSearch, translationOf } from '../data/translations'

export interface CategorySignNavigatorProps {
  references: RecordingMeta[]
  suggested?: string | null
  selectedId?: string | null
  mode?: 'practice' | 'record'
  onSelect: (sign: RecordingMeta) => void
  onCreateCustom?: (gloss: string) => void
  /** Fired as the pointer / focus moves over a sign card, for a live preview.
   *  Null when nothing is hovered. */
  onPreview?: (sign: RecordingMeta | null) => void
}

const CATEGORY_ICONS: Record<string, string> = {
  'A-Z': 'M4 7V4h16v3M9 20h6M12 4v16',
  'Numbers': 'M4 19V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14M8 12h8',
  '20-99': 'M4 19V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14M8 12h8',
  '100-1 million': 'M4 19V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14M8 12h8',
  'Days': 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  'Months': 'M3 4h18v18H3zM16 2v4M8 2v4M3 10h18',
  'Greetings': 'M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3',
  'People': 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  'Places': 'M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6z',
  'Verbs': 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  'Adjectives': 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  'Colors': 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  'Vehicles': 'M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2',
  'Food': 'M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8zM6 1v3M10 1v3M14 1v3',
  'Other': 'M4 6h16M4 12h16M4 18h16',
}

export function CategorySignNavigator({
  references,
  suggested = null,
  selectedId = null,
  mode = 'practice',
  onSelect,
  onCreateCustom,
  onPreview,
}: CategorySignNavigatorProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [globalQuery, setGlobalQuery] = useState('')
  const [categoryQuery, setCategoryQuery] = useState('')

  // Display order and buckets in one pass — grouping and ordering have to
  // agree, or a folded category reappears as a stray bucket.
  const { order: categories, byCategory: signsByCategory } = useMemo(
    () => groupForPicker(references),
    [references],
  )

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
    const filtered = q ? list.filter((r) => matchesSearch(r.gloss, q)) : list
    return orderSigns(selectedCategory, filtered)
  }, [selectedCategory, signsByCategory, categoryQuery])

  // Suggested sign record
  const suggestedRec = useMemo(() => {
    if (!suggested) return null
    return references.find((r) => r.gloss === suggested) ?? null
  }, [references, suggested])

  const isSearchingGlobal = globalQuery.trim().length > 0

  return (
    <div className="cs-nav-container cs-nav-pane">
      {/* Header / Topbar */}
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
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
                <span>Categories</span>
              </button>
              <span className="cs-crumb-sep">/</span>
              <span className="cs-crumb-current">
                <strong>{selectedCategory}</strong>
                <span className="cs-crumb-count">
                  ({signsByCategory.get(selectedCategory)?.length ?? 0})
                </span>
              </span>
            </div>
          ) : (
            <div className="cs-nav-title-group">
              <h2 className="cs-nav-title">
                {mode === 'record' ? 'Select Sign' : 'Categories'}
              </h2>
              <p className="cs-nav-subtitle">
                {references.length} signs across {categories.length} categories
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Search Bar */}
      <div className="cs-search-row">
        {selectedCategory && !isSearchingGlobal ? (
          <div className="cs-search-input-wrap">
            <svg className="cs-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="cs-search-input"
              value={categoryQuery}
              onChange={(e) => setCategoryQuery(e.target.value)}
              placeholder={`Search within ${selectedCategory}...`}
              autoComplete="off"
              spellCheck={false}
            />
            {categoryQuery && (
              <button
                type="button"
                className="cs-search-clear"
                onClick={() => setCategoryQuery('')}
                aria-label="Clear filter"
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </div>
        ) : (
          <div className="cs-search-input-wrap">
            <svg className="cs-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="cs-search-input"
              value={globalQuery}
              onChange={(e) => setGlobalQuery(e.target.value)}
              placeholder={`Search ${references.length} signs (e.g. Ayubowan, Numbers)...`}
              autoComplete="off"
              spellCheck={false}
            />
            {globalQuery && (
              <button
                type="button"
                className="cs-search-clear"
                onClick={() => setGlobalQuery('')}
                aria-label="Clear search"
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Step 1: Categories Grid or Global Search Results */}
      {!selectedCategory && !isSearchingGlobal && (
        <div className="cs-category-view">
          {/* Suggested Sign Quick-Pick Banner */}
          {suggestedRec && mode === 'practice' && (
            <div className="cs-suggested-banner" onClick={() => onSelect(suggestedRec)} role="button" tabIndex={0}>
              <div className="cs-suggested-left">
                <div className="cs-suggested-tag-row">
                  <span className="cs-suggested-tag">
                    <span className="cs-suggested-dot" />
                    DAILY RECOMMENDATION
                  </span>
                  <span className="cs-suggested-cat">{categoryOf(suggestedRec)}</span>
                </div>
                <h3 className="cs-suggested-gloss">{suggestedRec.gloss}</h3>
                {translationOf(suggestedRec.gloss) && (
                  <span className="cs-suggested-sub" lang="si">
                    {translationOf(suggestedRec.gloss)}
                  </span>
                )}
              </div>
              <button type="button" className="btn small cs-suggested-btn">
                <span>Practise</span>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          )}

          {/* Author-only custom gloss card */}
          {mode === 'record' && onCreateCustom && (
            <div className="cs-custom-gloss-card">
              <div className="cs-custom-info">
                <h4>Not in the corpus?</h4>
                <p>Record a sign that has no reference yet.</p>
              </div>
              <button type="button" className="btn small" onClick={() => onCreateCustom('')}>
                Record a new sign
              </button>
            </div>
          )}

          {/* Categories Grid */}
          <div className="cs-categories-grid">
            {categories.map((catName) => {
              const catSigns = signsByCategory.get(catName) ?? []
              const iconPath = CATEGORY_ICONS[catName] || CATEGORY_ICONS['Other']
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
                  <div className="cs-cat-icon-wrap">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d={iconPath} />
                    </svg>
                  </div>
                  <div className="cs-cat-card-inner">
                    <span className="cs-cat-name" title={catName}>{catName}</span>
                    <span className="cs-cat-badge">{catSigns.length}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Global Search Results Grid */}
      {!selectedCategory && isSearchingGlobal && (
        <div className="cs-search-results-view">
          <div className="cs-results-bar">
            <span><strong>{globalSearchResults.length}</strong> matching signs</span>
          </div>

          {globalSearchResults.length === 0 ? (
            <div className="cs-empty-state">
              <p>No signs match "{globalQuery}".</p>
              {mode === 'record' && onCreateCustom && (
                <button
                  type="button"
                  className="btn small"
                  style={{ marginTop: '12px' }}
                  onClick={() => onCreateCustom(globalQuery.trim().toUpperCase())}
                >
                  Record "{globalQuery.trim().toUpperCase()}"
                </button>
              )}
            </div>
          ) : (
            <div className="cs-signs-grid" onMouseLeave={() => onPreview?.(null)}>
              {globalSearchResults.map((r) => {
                const meaning = translationOf(r.gloss)
                const isSelected = selectedId === r.id
                const isSuggested = suggested === r.gloss
                return (
                  <div
                    key={r.id}
                    className={`cs-sign-card ${isSelected ? 'selected' : ''} ${isSuggested ? 'suggested' : ''}`}
                    onClick={() => onSelect(r)}
                    onMouseEnter={() => onPreview?.(r)}
                    onFocus={() => onPreview?.(r)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') onSelect(r)
                    }}
                  >
                    <div className="cs-sign-top">
                      <span className="cs-sign-cat-tag">{categoryOf(r)}</span>
                      {isSuggested && <span className="badge cs-suggested-chip">Suggested</span>}
                      {r.source === 'team-recording' && <span className="badge cs-team-chip">Team</span>}
                    </div>

                    <h4 className="cs-sign-gloss">{r.gloss}</h4>
                    {meaning && (
                      <p className="cs-sign-meaning" lang="si">{meaning}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Step 2: Signs List/Grid for Selected Category */}
      {selectedCategory && (
        <div className="cs-category-signs-view">
          {categorySigns.length === 0 ? (
            <div className="cs-empty-state">
              <p>No signs found matching "{categoryQuery}".</p>
              <button
                type="button"
                className="btn btn-ghost small"
                onClick={() => setCategoryQuery('')}
              >
                Show all {signsByCategory.get(selectedCategory)?.length ?? 0}
              </button>
            </div>
          ) : (
            <div className="cs-signs-grid" onMouseLeave={() => onPreview?.(null)}>
              {categorySigns.map((r) => {
                const meaning = translationOf(r.gloss)
                const isSelected = selectedId === r.id
                const isSuggested = suggested === r.gloss
                return (
                  <div
                    key={r.id}
                    className={`cs-sign-card ${isSelected ? 'selected' : ''} ${isSuggested ? 'suggested' : ''}`}
                    onClick={() => onSelect(r)}
                    onMouseEnter={() => onPreview?.(r)}
                    onFocus={() => onPreview?.(r)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') onSelect(r)
                    }}
                  >
                    <div className="cs-sign-main">
                      {foldedCategoryOf(r) && foldedCategoryOf(r) !== selectedCategory && (
                        <span className="cs-sign-cat-tag">{foldedCategoryOf(r)}</span>
                      )}
                      <h4 className="cs-sign-gloss">{r.gloss}</h4>
                      {meaning && (
                        <p className="cs-sign-meaning" lang="si">{meaning}</p>
                      )}
                    </div>

                    {(isSuggested || r.source === 'team-recording') && (
                      <div className="cs-sign-badges">
                        {isSuggested && <span className="badge cs-suggested-chip">Suggested</span>}
                        {r.source === 'team-recording' && <span className="badge cs-team-chip">Team</span>}
                      </div>
                    )}
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
