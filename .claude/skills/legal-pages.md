---
disable-model-invocation: true
---

# Legal Pages (Terms & Privacy)

Reference for the standalone legal pages system — Terms of Service and Privacy Policy, with bilingual support and theme toggling.

## Architecture Overview

```
Browser
  │
  ▼
main.ts — app.use(createLegalRouter())
  │
  ▼
legal-routes.ts (Express Router)
  ├─ GET /terms  → serves terms.html
  └─ GET /privacy → serves privacy.html
```

Two standalone HTML pages with no server-side rendering — all content is inline JS/CSS with client-side i18n.

## Key Files

| File | Purpose |
|------|---------|
| `src/legal/terms.html` | Terms of Service page — 10 bilingual sections |
| `src/legal/privacy.html` | Privacy Policy page — 7 bilingual sections |
| `src/legal/legal-routes.ts` | Express Router with `GET /terms` and `GET /privacy` |
| `main.ts` | Mounts legal router via `app.use(createLegalRouter())` (line ~153) |

## Routing (`legal-routes.ts`)

- Express Router with `GET /terms` and `GET /privacy`
- Reads HTML files from disk with `fs.readFile()`, sets `Content-Type: text/html`
- Resolves HTML files relative to source, handling both `src/` and `dist/` directory structures (same pattern as subscription routes)
- No authentication required — public pages

## Page Structure (identical pattern in both files)

### FOUC Prevention
Inline `<script>` in `<head>` reads `tase-theme` and `tase-language` from `localStorage`, sets `data-theme`, `dir`, and `lang` attributes on `<html>` before paint.

### CSS
All inline in `<style>`, uses CSS custom properties for light/dark themes:
- `--t-bg-primary`, `--t-bg-secondary`, `--t-text-primary`, `--t-text-secondary`, `--t-accent`, etc.
- `[data-theme="dark"]` selector overrides for dark mode

### Layout
- `.container` — 768px max-width, centered
- `header` — page title + subtitle + language/theme toggle buttons
- `.last-updated` — "Last updated: March 2026"
- `#content` — JS-rendered sections (populated by `renderSections()`)
- `footer` — lobix.ai link + cross-links to other legal page + copyright

### Theme Toggle
- `getTheme()` / `setTheme()` functions
- Persists to `localStorage('tase-theme')`
- Sun/moon icon toggle button

### i18n System
- Bilingual EN/HE via `TEXTS` object with `en` and `he` keys
- `T(key)` helper function with EN fallback: `TEXTS[currentLang][key] || TEXTS['en'][key]`
- `setLanguage(lang)` — updates `dir`/`lang` attributes on `<html>`, persists to `localStorage('tase-language')`, dispatches `tase-language-change` CustomEvent for cross-page sync
- Language toggle button shows `עב` (when EN) or `EN` (when HE)

### Content Rendering
- Sections stored as `sections[]` array inside `TEXTS.en` and `TEXTS.he` — each entry has `title` (string) and `content` (raw HTML)
- `renderSections()` iterates the array, creates `<section>` elements with `<h2>` title and HTML content, appends to `#content` div
- `applyLanguage()` updates all translatable DOM elements + `document.title`, then calls `renderSections()`

### TEXTS Object Keys
Both pages use the same key structure:
- `pageTitle`, `pageSubtitle`, `lastUpdated`, `switchLang`
- `footerTerms`, `footerPrivacy`, `footerCopyright`
- `sections` — array of `{ title, content }` objects

## Footer Cross-Link Pattern

Each page has the current page as a `<span>` (non-clickable) and the other page as an `<a>` link:

| Page | Terms element | Privacy element |
|------|--------------|-----------------|
| `terms.html` | `<span id="footer-terms-text">` | `<a href="/privacy" id="footer-privacy-link">` |
| `privacy.html` | `<a href="/terms" id="footer-terms-link">` | `<span id="footer-privacy-text">` |

Both pages also include a lobix.ai link and copyright line.

## Key Differences Between the Two Files

| Aspect | `terms.html` | `privacy.html` |
|--------|-------------|----------------|
| Page title (EN) | Terms of Service | Privacy Policy |
| Page title (HE) | תנאי שימוש | מדיניות פרטיות |
| `<title>` tag | Terms of Service — Lobix TASE Market | Privacy Policy — Lobix TASE Market |
| Section count | 10 sections (EN + HE) | 7 sections (EN + HE) |
| Footer cross-link | Links to `/privacy` | Links to `/terms` |

### Terms Sections (EN)
1. Acceptance of Terms
2. Description of Service
3. Account and Subscription
4. Use of Services
5. Financial Data Disclaimer
6. Data Accuracy
7. Intellectual Property
8. Limitation of Liability
9. Changes to Terms
10. Contact

### Privacy Sections (EN)
1. Data We Collect
2. How We Use Your Data
3. Third-Party Services
4. Data Retention
5. User Controls
6. Security
7. Contact

## HTTP Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/terms` | Public | Serve Terms of Service page |
| GET | `/privacy` | Public | Serve Privacy Policy page |
