# Desktop lyrics 0.1.7

Date: 2026-10-25

## Delivered

- Long tracks pan horizontally inside a stable viewport. Short tracks stay centered. The background remains rectangular and optional.
- Hover controls send play/pause, previous/next, replay and sentence-loop commands to the existing main audio instance. Commands include song and playback-session identifiers; stale commands are ignored.
- Window position and width are saved locally. Placement is clamped to available monitor work areas. The main player's locate icon restores the lyrics window to its current monitor.
- `showTranslation` is an account-level preference, defaulting to true for existing accounts. Both the song page and desktop lyrics honor it. No database migration is necessary.
- Lyric request errors have a dedicated retry action, separate from empty lyrics. A heartbeat identifies a disconnected main player.
- Sentence replay/loop use timestamps plus the song timing offset; the last sentence uses the audio duration. Untimed lines cannot start a loop. Changing song/session or manually seeking clears the loop. Playback offers 0.75, 0.9 and 1 speed with pitch preservation.

## Verification

- Full existing suite plus new range/placement cases: 109 tests passed in 23 files.
- Additional command transport tests: 2 passed.
- TypeScript, Vite, Rust/Tauri and NSIS release builds succeeded.
- Browser preview: 520px width, 48px text, long Japanese and Chinese tracks; confirmed moving transforms, zero background radius and both toolbars inside the viewport.
- Cloud acceptance passed authentication, lyric preferences, songs, playlists, study, and three audio Range samples.
- Native multi-monitor removal, DPI transitions and locked click-through still require device-level verification; browser preview does not prove these behaviors.

## Deployment

- Desktop executable and installer: `artifacts/desktop`, version 0.1.7.
- Cloud backend auth module updated in the existing release; old module retained as `/opt/animeuta/backups/auth-before-017.js`.
- Web release: `/opt/animeuta/releases/lyrics-017/frontend/dist`; `/opt/animeuta/shared/web-current` switched atomically.
- No music files or user databases were replaced. Android APK was not rebuilt for this desktop-lyrics change.
