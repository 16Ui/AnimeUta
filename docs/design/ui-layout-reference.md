# AnimeUta UI Layout Reference

## Purpose

This document records layout principles learned from mature desktop and mobile music clients. It is a structural reference, not a visual clone. AnimeUta keeps its own ACG language-learning identity and avoids copying NetEase Cloud Music assets, branding, or exact compositions.

## Reference Sources

- The locally installed NetEase Cloud Music Windows client.
- The official Microsoft Store listing for NetEase Cloud Music.
- Public Android and desktop product screenshots used only for layout comparison.

The Android package must come from an official download page or a trusted application store. Do not use modified APKs or third-party repackaged installers as design references.

## Shared Principles

1. Playback is persistent but does not dominate browsing pages.
2. Navigation, content, and playback controls occupy separate stable zones.
3. The current task has one obvious primary action; secondary operations stay in menus, drawers, or compact toolbars.
4. Album art carries visual identity. Borders, gradients, and panels remain subordinate to content.
5. Dense song lists use rows; square cards are reserved for discovery, playlists, albums, and works.
6. Empty states do not reserve the same space as active controls.
7. Mobile and desktop are separate compositions built from shared behavior, not scaled copies of one layout.

## Desktop Framework

- Left navigation: fixed, compact, and grouped by discovery, personal library, study, and administration.
- Top bar: search first, account and global settings second.
- Content: constrained reading width with page-specific density; avoid wrapping every section in a card.
- Bottom player: always stable while a song is active, with song identity on the left, transport in the center, and queue/volume on the right.
- Full player: artwork on the left and lyrics on the right. Metadata and learning tools open in side panels.

## Mobile Framework

- Top bar: brand/back navigation and only the most relevant page action.
- Bottom navigation: five or fewer primary destinations with fixed touch targets.
- Mini player: shown only when a song is selected; placed directly above bottom navigation.
- Full player: default to artwork. Tapping artwork switches to a dedicated lyrics view; an explicit icon returns to artwork.
- Lyrics: scroll inside their own viewport. The active line remains near the visual center without moving the document.
- Forms and administration: full-width pages, bottom sheets, or drawers; do not compress desktop side-by-side editors onto a phone.

## AnimeUta-Specific Adaptation

- Study is a primary destination, equal to discovery and library.
- A lyric line may contain original Japanese, ruby/furigana, translation, and romaji. Typography must keep the original line dominant.
- Vocabulary selection and annotations belong to a study drawer, not the main listening canvas.
- ACG metadata remains rich, but appears progressively: title and artist first, work/album second, detailed credits and version relations on demand.
- Administration uses denser lists than listener pages and clearly separates song, lyric, entity, and user management.

## Current Priority Audit

### P0: Global Framework

- Remove the large empty mobile player placeholder.
- Keep mobile mini player and bottom navigation at stable, non-overlapping heights.
- Make mobile navigation touch targets uniform.
- Prevent the language selector from truncating its selected label.

### P1: Core Listening

- Keep desktop artwork/lyrics split view.
- Keep mobile artwork/lyrics single-view switching.
- Normalize the player control hierarchy and progress feedback.
- Keep lyric auto-follow inside the lyric viewport.

### P2: Browsing Pages

- Use a shared song-row component for charts, history, favorites, playlists, and search.
- Standardize cover sizes, title/artist hierarchy, duration formatting, hover/pressed states, and row actions.
- Reduce repeated section headers and decorative containers on the home page.

### P3: Study And Administration

- Give vocabulary review a focused study surface with one decision per screen.
- Move song metadata, lyric upload, AI jobs, and annotations into task-specific drawers.
- Use cover-led management lists and open editing only after selecting an item.

## Acceptance Rules

- No overlap at 360x800, 412x915, 768x1024, 1280x800, and 1920x1080.
- No user-facing internal enum values.
- No clipped Chinese, Japanese, or English labels.
- Mobile primary touch targets are at least 44 CSS pixels.
- Every scrollable region has one clear scroll owner.
- Player state and controls remain consistent across web, desktop, and Android builds.
