# LE Studio Source-of-Truth Fixtures

`meta.numbers` is the single source of truth for final export payloads.

## Source-of-truth contract

Final export must include:

- `dryRun: false`
- `productionWrite: false`
- `wordpressPostId: null`
- `sourceOfTruth: "meta.numbers"`
- `schemaVersion: "1.0.0"`
- `project`
- `wordpress.main`
- `wordpress.post`
- `wordpress.services`
- `wordpress.products`
- `wordpress.media`
- `seo`
- `faq`
- `compliance`
- `technicalRecommendations`
- `securityRecommendations`
- `antiPatterns`
- `wordpressImportNotes`

## WordPress metabox mapping

### `wordpress.main`
- `title`
- `slug`
- `tagline`
- `context`
- `editor`
- `label`
- `link`

### `wordpress.post`
- `section[]`
- `topic[]`
- `source`

### `wordpress.services[]`
- `type[]`
- `category[]`
- `badge[]`
- `price`
- `duration`
- `datetime`

### `wordpress.products[]`
- `type[]`
- `category[]`
- `badge[]`
- `brand[]`
- `stock`
- `regular_price`
- `reseller_price`
- `sale_price`
- `paylink`

### `wordpress.media`
- `video`
- `icon`
- `image`
- `gallery[]`
- `files[]`

## Dry-run safety rules

- LE Studio runs in live generation mode, but WordPress writes stay server-guarded.
- Import button prepares payload preview only unless an explicit server-side production guard is enabled.
- `dryRun: false` means the generated content is live user input/output, not mock data.
- `wordpressPostId` always stays `null`.
- `wordpress.postStatus` must be `draft`.

## Content format policy

- LE Studio generates **content payload only**, not final frontend layout.
- WordPress import route maps the payload into metabox fields.
- WordPress theme/templates render the final UI.
- Plain-text fields must stay plain text (no HTML tags).
- Array fields must remain arrays of clean strings.
- `wordpress.main.editor` may contain Markdown or safe basic HTML only.
- Forbidden in editor: `script`, `style`, `iframe`, `object`, `embed`, `form`, `input`, `button`, `svg`, inline styles, event handlers, and layout wrappers.
- Layout-only properties are forbidden in export payload (`className`, `style`, `components`, `blocks`, `jsx`, `css`, tailwind-style keys).
- Never invent media URLs, prices, paylinks, stock, or fake business claims.

## Forbidden placeholder phrases

- `Krátke vysvetlenie`
- `Hlavné prínosy`
- `Tri až štyri kroky`
- `Balíky alebo varianty`
- `Najčastejšie otázky`
- `Tu bude`
- `Placeholder`
- `Lorem ipsum`

## Compliance rules

- no fake testimonials
- no fake customer counts
- no fake revenue
- no guaranteed income or ranking claims
- no fake urgency
- no gambling/lottery mechanics
- no unsafe bypass advice

## Fixtures

- `web-do-24h-source-of-truth.valid.json`
- `web-do-24h-source-of-truth.invalid.json`
- `web-do-24h-launch-pack.legacy-invalid.json` is an old pre-`meta.numbers` fixture and must fail the current validator.
- `launch-studio-dry-run-export.json` is retained only as a legacy dry-run sample and must not be used as the current valid export contract.

## Validator

```bash
node scripts/validate-launch-studio-fixture.mjs docs/samples/web-do-24h-source-of-truth.valid.json
```

Exit code:
- `0` valid
- `1` invalid
