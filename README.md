# 로또 노트
Private mobile-first Korean Lotto6/45 statistics and combination tool.

## Current generation: pattern-soft-v7
- Every proposal draws6 distinct main numbers from1–45 without an anchor. Uint32 bounded rejection removes modulo bias in integer selection. Every individually legal6-number set has a positive proposal/acceptance path.
- Hard single-ticket rules: no exact match to any prior historical6-number draw, and at most2 numbers from the latest draw. Bonus excluded.
- Additional hard patterns: maximum consecutive run2 (three or more consecutive numbers excluded); main-six sum80–200 inclusive; odd count1–5 (all-odd/all-even excluded). No low/high number mixing rule.
- No hard frequency upper/lower mixture requirement, repeated-group requirement, or recently-seen adjacent-pair ban. Two consecutive numbers are allowed whether recently seen or not.
- Recent50 frequency descending, ties number ascending, partitions upper ranks1–15, middle16–30, lower31–45. Having both upper and lower multiplies weight by1.20; missing either uses1.00.
- Existing integrated20/50/100 number scores remain: selected focus weight2, others1; `(count+20*p)/(window+20)/p`, averaged then clipped0.05–12 and multiplied by0.75+0.25*nonzero-window fraction. A candidate's mean number score divided by the45-number maximum gives a normalized factor; number-frequency multiplier is1+0.20*factor, at most1.20.
- Repeated2/3-number groups with count>=2 in the selected focus window can add a soft boost. The highest-scoring contained2/3-group uses1+0.20*min(1,score/12), at most1.20. No group uses1.00. Repeated4/5-group statistics may be displayed but never boost selection.
- Multiply these3 positive terms, total<=1.728. Rejection sampling accepts a hard-legal proposal against weight/1.728. These are selection preferences, not winning odds or final10-ticket inclusion probabilities.
- Exactly10 unique tickets; joint batch limits each number<=4 uses and each pair<=2. Bounded30x400 proposal attempts and a1200ms search deadline after profile calculation fail closed; no partial or relaxed fallback.
- Results retain frequency-group, weight and optional2/3-group provenance when saved. Legacy10-window andv3/v4/v6 saved records remain readable and unchanged.

## Data and safety
Bundled official data1–1245, latest draw2026-10-10. Full history remains unchanged from1–1244. Latest1245 matches its specific official endpoint and the latest5 match the official main endpoint. Dates, round continuity,6 distinct main numbers, and separate bonus validated.
Official source: https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do?srchLtEpsd=all
The app checks on open, visible return and manual refresh. Worker-memory cache limits upstream calls to once per15minutes; no closed-app scheduler. Historical corrections/regressions fail closed. New generation is disabled when the expected latest draw is missing.
Saved combinations are browser-local, maximum100; no account or purchase integration. All6-number combinations have the same first-prize probability1/8,145,060; no predictive advantage is claimed.

## Checks
node --test tests/engine.mjs
npx tsc --noEmit
npm run build

Engine regression covers750batches across1244/1245 and all3 focus periods, actual paths without mixture/anchor and with seen adjacent pairs, bounded failure, and prior-only rolling1196–1245 eligibility. With the added patterns, prior-only rolling eligibility is45/50 for1196–1245 and87/100 for1146–1245. This is not a10-ticket hit rate or predictive accuracy.
DOM checks use esbuild/JSDOM via LOTTO_TEST_JSDOM. tests/mixed-ui.jsx takes LOTTO_TEST_HISTORY for a validated1245 fixture used only in tests. They verify interactions/storage and future freshness behavior, not real-browser visual layout.

## Mobile app presentation (v8)
- Bottom navigation: 조회, 보관함, 통계; compact recommendation controls and expandable filter / per-ticket explanations. Original v7 engine, history API, saved key and persisted records unchanged.
- New vector lotto-ball icon with PNG 192/512, full-bleed maskable512 and Apple180 assets. Web manifest uses standalone display, same origin/start URL and same private audience. Versioned icon URLs refresh image caches. No service worker or offline data caching is introduced.
- Safe-area padding, 44px minimum interactive controls, narrow320px layout rules, reduced-motion support, and persistent privacy / equal-odds disclosure.
- UI tests use synthetic browser-local storage and cover refresh/failure, tab switching, generate10, storage mutation failures, cancel/confirm/select-all, legacy records and reload. Chromium subprocess unavailable; supported cloud browser reaches private-site sign-in, and local file preview is denied by URL policy. Real mobile layout / iOS installation is not yet verified.

## Automatic application updates (v9)
- Build/dev entrypoint generates one deterministic24-character source fingerprint in lib/app-version.ts. Both client and GET /api/version use it. The version response disables browser/CDN caching; the root layout is force-dynamic with revalidate0 so reload requests fresh application HTML.
- Initial mount, visible foreground return, and pageshow check for a changed version. Network/auth/invalid-response failures leave the current app untouched. No service worker, push permission or background scheduler is introduced.
- Application waits while history refresh, generation, clipboard or confirmation UI is active and for1.2seconds after interaction/scroll. Immediately before reload, latest unsaved10 results with metadata, analysis period, current tab, selection and scroll are atomically stored in a separate sessionStorage recovery journal. Saved-number localStorage is never written by this feature.
- Recovery is consumed after reload; valid unsaved numbers have no age expiry within that tab session. Storage denial/quota/readback failure prevents reload. A bounded attempted-version journal plus60-second reload guard prevents stale-response loops. An already-open v8 client needs one real reload to acquire this updater.
- Checks: tests/update-controller.mjs (bundled with esbuild) and tests/update-ui.jsx, in addition to existing engine/ui/saved-ui/mixed-ui checks. Tests simulate browser navigation and storage, not actual iOS installation or live iPhone foreground behavior.

## Compact top controls (v10)
The screenshot-marked area is reduced to a single56px brand/status row and a compact analysis/action card. Redundant large title, subtitle and English badges are removed; the semantic page heading remains accessible. Dates and batch-cap text stay in expandable filter details. Refresh/period/filter targets remain44px and the primary recommendation action48px. Generation, persistence and automatic-update logic are unchanged.

## iPhone top safe area (v11)
The compact header is preserved. Top content begins after one safe-area-inset-top value plus16px of breathing room; when Safari already reserves its system bar and reports0, only16px is added. A same-height opaque fixed strip covers scrolling content beneath the system edge without adding another layout inset. Viewport-fit cover and Apple default status-bar mode remain unchanged. tests/safe-area.mjs checks50 CSS cascade/formula combinations (2 modes,5 widths,5 inset values); this is not a physical iPhone rendering test.

## Single-row conditions (v12)
The redundant visible analysis heading is now screen-reader-only. Periods and the filter disclosure share one 44px row; the selected period is still exposed by aria-pressed and the group retains its recent-analysis label. Filter content expands above the 48px recommendation action in natural DOM focus order. The normal closed card is 122px by CSS calculation, down from 215.5px at narrow widths or 219.5px elsewhere. At 320px, period buttons are approximately54px wide, with a96px disclosure. Safe-area protection, engine, persistence and update logic are unchanged. Formula/DOM checks do not constitute physical iPhone layout verification.

## Pocket cartoon theme (v13)
Pastel lavender actions, cream paper, five readable number-ball colors and restrained ink outlines/sticker shadows give the existing compact app a 2D cartoon treatment. No extra hero or decoration rows are added. The theme override does not change layout dimensions: safe-area +16px,122px closed conditions,44px targets and48px recommendation button remain. All action/engine/storage/update code is unchanged. Matching vector and180/192/512/maskable icons use a versioned URL; an already installed iOS icon may remain cached by the OS. The icon raster was visually inspected; mobile app layout was checked via DOM/CSS, not on a physical iPhone.

## Calm rounded theme (v14)
The cartoon direction is superseded: ink outlines and offset sticker shadows are removed. The app returns to a quiet green and near-white palette, softly rounded controls and very subtle blurred shadows. Number colors remain distinguishable and readable. The matching two-ball icon has no cartoon outline or sparkle. Geometry, safe-area, engine, storage and updater are unchanged; the installed icon may still be cached by the OS. tests/soft-theme.mjs replaces the superseded cartoon palette test.

## Streamlined recommendation results (v15)
Remove the screenshot-marked recommendation title/count/copy row and repeated card index/history rows from the generate view. Batch copy remains available under the clearly named '추천 기준·전체 복사' disclosure, and history comparison text moves into each card's existing details. Articles retain accessible sequence labels. Saved-view headings, selection controls and their focus target are unchanged. No action/engine/storage/update semantics change; card numbers now appear without the redundant header spacing.

## Brand update (v16)
The visible app, browser title, PWA/Apple names and Sites display title are now 로또 6/45. All icon variants use an original quiet green 6/45 mark; the favicon has a larger text-only adaptation for tiny sizes. URLs are versioned, including the in-app SVG. The site URL, manifest identity/scope/start URL and both browser storage keys are unchanged. Existing installed OS names/icons may remain cached. This is a personal record-based tool, not an official lottery app.

## Selected visuals (v17)
The owner's option04 coral-ticket PNG is used unchanged apart from standard resizing for all icon surfaces. Legacy SVG URLs embed the same raster rather than a reinterpretation. The numbers use option03's rounded/flat style with locally bundled Nunito900 (Fontsource5.3.0, SIL OFL); live1–45 values and established10-number bands remain. Five band fills and a charcoal bonus fill are darkened for at least4.5:1 cream-digit contrast. No controls/background/theme geometry changes. Original icon RGB corners are preserved; OS maskable cropping may crop decorative ticket edges, not the central6/45 mark. Existing installed icons may remain OS-cached.

## Closer reference numerals (v18)
Reference03 compared directly with the user's iPhone screenshot: the prior Nunito900 digits were much smaller relative to each ball, with different1/4 shapes and overly dark fills. The app now self-hosts Fredoka700 (Fontsource5.3.0, SIL OFL), uses larger live digits (21–30px bold) inside unchanged circles, and brighter reference-inspired fills with at least3:1 large-text contrast. The generated concept has no recoverable font identity, so this is a closer reproduction, not an identical font claim. Icon04 is unchanged. No control layout, data or behavior changes.

## Public prize-results menu (v31)
- Add a fourth bottom tab, 당첨내역, without changing generation, saved-number storage, visitor logging or administrator functionality. Load its component and prize data only when opened.
- Official snapshot covers all 1–1249 draws, through 2026-11-07. Every rank uses actual historical winning-game counts and per-game amounts; no-winner ranks show no payable prize. Old variable 4th/5th prizes are retained.
- Source: https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do?srchLtEpsd=all . Latest row was verified against srchLtEpsd=1249 and all 1–1245 number/date/bonus records match the existing canonical history. Snapshot includes source URL, retrieval time and raw SHA-256. No personal winner identities are used.
- /api/prizes refreshes the official public source with a 15-minute per-Worker cache, on opening/foreground/manual refresh. A failed fetch, malformed data, regression or historical correction preserves the validated snapshot with a visible status. There is no closed-app schedule.
- Current-rate estimated net per game: up to KRW 2 million is exempt; above that, 22% applies to the amount up to KRW 300 million and 33% to its excess. The KRW 2 million threshold is not deducted. All historical rounds are explicitly marked as current-rate estimates, not actual historical receipts. Ticket purchase expense and paying-bank won-level settlement are excluded. https://www.dhlottery.co.kr/guide/wnrGuide
- Tests cover all historical ranks, latest values, zero-winner cases, tax boundaries, invalid/missing data, concurrent fetches, cache/fallback, tab/select/previous/latest interactions, error retention, untouched saved numbers and update recovery. Desktop browser verification covers latest/first round and rendered amounts. Responsive CSS supports 320px and larger; physical iPhone rendering was not tested.
