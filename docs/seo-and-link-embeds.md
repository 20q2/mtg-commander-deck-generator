# SEO & Link Embeds

*Shipped 2026-08-27. This doc explains every SEO/embed piece in the repo, in plain English: what it is, why it exists, and when you'd ever touch it.*

## The one-paragraph version

When you paste a link into Discord (or Slack, Twitter, iMessage...), their server fetches the page's raw HTML and reads special `<meta>` tags out of the `<head>` to build the preview card — title, description, big image, accent color. Those crawlers **do not run JavaScript**, so nothing our React app does at runtime counts; the tags have to be baked into the static `index.html`. Search engines read the same file plus a couple of helper files (`robots.txt`, `sitemap.xml`). Everything below exists to feed one of those two audiences.

## Why this works for every URL, not just the homepage

manafoundry.gg is served by CloudFront in front of a private S3 bucket ([infra/lib/site-stack.ts](../infra/lib/site-stack.ts)). When someone requests a path that isn't a real file in the bucket — `/analyze`, `/spellchroma`, anything the SPA router owns — S3 says "not found" and CloudFront is configured to respond with `/index.html` **and an HTTP 200 status**. So from a crawler's point of view, every manafoundry.gg URL is a real page with our meta tags in it. That's why one static tag block covers the whole site and we didn't need any per-route infrastructure.

The GitHub Pages deploy (the `/mtg-commander-deck-generator/` mirror) can't do that trick — deep links there genuinely return 404 and serve `public/404.html`. That's why the same meta block is duplicated into `404.html`.

## Inventory — every piece and what it does

All of the tag work lives in [index.html](../index.html) (mirrored in [public/404.html](../public/404.html)).

### Link-preview tags (the Discord embed)

| Tag | What it controls |
|---|---|
| `og:title`, `og:description`, `og:site_name` | The text on the embed card. "OG" = Open Graph, the standard Facebook invented that everyone now uses. |
| `og:image` (+ `:width`, `:height`, `:alt`) | The banner picture. **Must be an absolute URL** (`https://manafoundry.gg/og-banner.png`) — relative paths silently fail. |
| `og:url`, `og:type` | Canonical address and page category (`website`). |
| `twitter:card = summary_large_image` | Despite the name, this is also what tells **Discord** to render the image full-width instead of as a small square thumbnail. The other `twitter:*` tags are fallbacks for Twitter/X itself. |
| `theme-color` | The colored accent stripe on the left edge of a Discord embed. Ours is logo-blue (`#2b7bce`). |

### The banner image — `public/og-banner.png`

1200×630 (the standard OG size; Discord/Twitter crop anything else). It's not exported from a design tool — it was rendered from a throwaway HTML page (dark background, `logo.png`, wordmark, tagline in the site's Google Fonts) opened in a browser at exactly 1200×630 and screenshotted. To change it, rebuild that scratch page and re-screenshot; keep the filename so the meta tags don't need touching.

### Search-engine pieces

- **`<meta name="description">`** — the blurb Google usually shows under the result title. Not a ranking factor, but it's the ad copy for the click.
- **`<link rel="canonical">`** — tells Google "this is the one true URL for this page." Ours always points at `https://manafoundry.gg/<route>`, even on the GitHub Pages mirror — that stops the two deploys competing with each other in search results (a "duplicate content" problem). The static tag in `index.html` points at the root; `syncCanonical()` in [src/services/title/index.ts](../src/services/title/index.ts) rewrites it per-route at runtime, called from `usePageTitle` (which every page already uses). Google *does* run JavaScript, so it sees the corrected value; Discord doesn't need it.
- **[public/robots.txt](../public/robots.txt)** — polite instructions for crawlers. We allow everything except in-development/internal routes: `/brew`, `/metrics`, `/theme-lab`, `/migrate`, `/community-poll/admin`. Note it's advisory, not access control.
- **[public/sitemap.xml](../public/sitemap.xml)** — the list of pages we *want* indexed, with rough priorities: `/`, `/analyze`, `/decks`, `/spellchroma`, `/collection`. Google finds it via the `Sitemap:` line in robots.txt.
- **JSON-LD structured data** — the `<script type="application/ld+json">` block in `index.html`. Machine-readable "this site is a free web application called ManaFoundry" statement in schema.org vocabulary. Helps Google understand what the site *is*; can earn richer search listings. Harmless if ignored.

## Gotchas / things to remember

- **Discord caches embeds per-URL** for hours-to-days. After changing any OG tag or the banner, a previously-posted link will show the *old* embed. Test with a query string it hasn't seen (`manafoundry.gg/?v=2`) or in a channel where the link is fresh.
- **Everything embed-related must be static HTML.** Setting meta tags from React does nothing for Discord/Slack.
- **`og:image` breaks silently** if the URL isn't absolute or the image 404s — you just get a text-only embed.
- The `og:*` block, banner, and descriptions are duplicated between `index.html` and `404.html`. If you edit copy in one, update the other.

## Checklist: adding a new public route

1. Page calls `usePageTitle(...)` (canonical comes free with it).
2. Add a `<url>` entry to `public/sitemap.xml`.
3. If it should *not* be indexed yet (dev/hidden feature), add a `Disallow:` line to `public/robots.txt` instead.

## Not done yet / ideas parked

- **Google Search Console** — someone with the Google account should verify `manafoundry.gg` there and submit the sitemap. It's the only way to see indexing status and search-query data. One-time, ~10 minutes, free.
- **Per-deck embeds** — a shared `/analyze/<id>` link showing that deck's name + commander art in the embed. Impossible with static tags (Discord doesn't run JS); would need a small edge function (Lambda@Edge / CloudFront Function can't fetch data, so realistically Lambda@Edge or a Cloudflare Worker) serving bot-specific HTML. New moving part — only worth it if deck links in Discord become a real sharing pattern.
