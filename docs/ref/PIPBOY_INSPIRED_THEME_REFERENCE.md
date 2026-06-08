# Pip-Boy Inspired Theme Reference

Last updated: 2026-06-07

This document is a handoff note for future sessions that will implement a retro terminal theme for `Cowork Agents LAN`.

The visual direction should be **inspired by Fallout 4's Pip-Boy**, but the product must not ship as a Fallout, Pip-Boy, Vault-Tec, Vault Boy, or Bethesda-branded skin. Treat the listed Fallout resources as reference material only unless a later legal/license review explicitly approves direct use.

## Project Context

Current project path:

```text
D:\Projects\CoworkAgents
```

Current stack verified from `package.json`:

- Electron app with Vite renderer.
- React 18 + TypeScript.
- Main renderer UI: `src/renderer/App.tsx`.
- Existing stylesheet: `src/renderer/styles.css`.
- Shared app data types: `src/shared/types.ts`.
- Icons already use `lucide-react`.

Current UI shape from `src/renderer/App.tsx`:

- Main task app: `TaskApp`.
- Connection screen: `ConnectView`.
- Account/login screen: `AccountView`.
- Profile setup/edit screen: `ProfileSetupView`.
- Compact floating mode: `CompactIcon`.
- Task detail window: `TaskDetailView`.
- Settings/trash panel: `SettingsPanel`.
- Version management popover: `VersionPopover`.
- Assignment popover: `AssignmentPopover`.
- Task context menu: `TaskContextMenu`.

Current visual language from `src/renderer/styles.css`:

- Light translucent/glass UI.
- Rounded shell: `--radius-shell: 22px`, `--radius-panel: 14px`, `--radius-control: 8px`.
- Dominant colors: pale glass, blue, teal.
- Heavy use of `backdrop-filter`, gradients, soft shadows.

The theme work should initially be CSS-first. Avoid rewriting app behavior unless a theme switcher or preference persistence is explicitly added.

## Theme Goal

Create a usable desktop-app theme that feels like a worn monochrome field terminal:

- Dark display surface.
- Phosphor green primary color.
- Optional amber/blue/red alternate display colors.
- Compact dense information layout.
- Thin grid lines, bracket-like panels, technical labels, narrow controls.
- Subtle scanlines/noise/glow.
- Crisp operational UI suitable for repeated use by a small game-dev team.

Do **not** make it a novelty skin that hurts readability. This app is a task coordination tool, not a game inventory screen.

## IP And License Boundary

Safe direction:

- Use general ideas: monochrome CRT display, terminal typography, thin borders, scanlines, status tabs, dense data panels.
- Create original icons, original labels, original decorative marks.
- Rename the theme internally as `terminal`, `retro-terminal`, `field-terminal`, or `phosphor`.

Avoid direct use:

- Do not use the product-facing names `Fallout`, `Pip-Boy`, `Vault-Tec`, `Vault Boy`.
- Do not bundle Fallout screenshots, Pip-Boy UI captures, Vault Boy illustrations, Pip-Boy device models, or map icons.
- Do not copy Bethesda UI art, exact layout screenshots, exact icons, or replica model textures into the app.
- Do not create a theme name such as `Pip-Boy Theme` for shipped UI.

Important source note:

- The Fallout 4 manual lists `Pip-Boy`, `Vault-Tec`, `Fallout`, `Vault Boy`, and related marks as Bethesda/ZeniMax trademarks. Use this as a warning boundary, not as legal advice.
- GitHub repositories without a license are not automatically reusable. GitHub's own license guidance says public source code remains under copyright unless a license grants reuse rights.

## Reference Resources

### Official Or Near-Official References

Use these as visual and structural references only.

1. Bethesda support: Fallout 4 Pip-Boy App
   - URL: https://help.bethesda.net/app/answers/detail/a_id/31464/~/what-can-the-fallout-4-pip-boy-app-do%3F
   - Why useful: confirms the companion app mirrors much of the in-game Pip-Boy structure.
   - Reference value: information architecture, main modes, companion-screen behavior.

2. Fallout 4 manual PDF
   - URL: https://assets.ctfassets.net/rporu91m20dc/1S0ucCLJvWISW46QkOwC0S/bf8e90962701acda5f785ee00663cefd/manual_fallout4_xbo_en-us.pdf
   - Why useful: contains trademark notices and general Pip-Boy UI/context references.
   - Reference value: legal caution, terminology boundary.

3. Bethesda Gear: Fallout Pip-Boy 3000 Replica
   - URL: https://gear.bethesda.net/products/fallout-pip-boy-3000-replica
   - Why useful: official product photos show device shape, screen framing, knobs, and rugged physical details.
   - Reference value: hardware-inspired framing, button density, worn-object feel.

4. The Wand Company: Fallout Pip-Boy
   - URL: https://www.thewandcompany.com/fallout-pip-boy/
   - Manual: https://www.thewandcompany.com/wp-content/uploads/2024/10/Pip-Boy-WEBPRINT-Manual-v5.pdf
   - Why useful: detailed product and operation manual.
   - Reference value: mode structure such as STAT/INV/DATA/MAP/RADIO, hardware controls, display modes.

### Wiki And Screenshot References

Use for study only. Do not bundle screenshots or game art.

1. Fallout Wiki: Pip-Boy 3000 Mark IV
   - URL: https://fallout.wiki/wiki/Pip-Boy_3000_Mark_IV
   - Why useful: Fallout 4 Pip-Boy feature summary.
   - Reference value: main sections, device functionality, control concepts.

2. Fallout Wiki: Fallout 4 Pip-Boy images
   - URL: https://fallout.wiki/wiki/Category%3AFallout_4_Pip-Boy_images
   - Why useful: includes image entries such as companion app stats/map/junk screens and device images.
   - Reference value: layout proportions, typography density, icon/list usage.
   - License caution: page may mention CC BY-SA 4.0 unless otherwise noted, but game screenshots/IP still need separate caution.

3. Fallout Fandom: Design and Development of the Pip-Boy model 3000
   - URL: https://fallout.fandom.com/wiki/Design_and_Development_of_the_Pip-Boy_model_3000
   - Why useful: design notes about monochrome screen constraints, text-heavy interface, brackets, scanlines, and old CRT/Apple II influence.
   - Reference value: best source for translating the style into original UI decisions.

4. Fallout Fandom: Fonts in the Fallout series
   - URL: https://fallout.fandom.com/wiki/Fonts_in_the_Fallout_series
   - Why useful: lists fonts used across Fallout titles.
   - Reference value: use `Share Tech Mono`-style typography for terminals; avoid blindly embedding proprietary or unclear fonts.

### Open Source Implementation References

These are implementation references. Check the current repository license before copying any code.

1. Pipboy.Avalonia
   - URL: https://github.com/NeverMorewd/Pipboy.Avalonia
   - License observed during research: MIT.
   - Why useful: desktop UI theme library inspired by Pip-Boy.
   - Reference value: design tokens, color generation, panel shapes, scanline effects.
   - Direct fit: not directly usable here because this project is React/Electron, not Avalonia.

2. Pipboy.Flutter
   - URL: https://github.com/NeverMorewd/Pipboy.Flutter
   - License observed during research: MIT.
   - Why useful: theme and component library with CRT effects and monochrome color presets.
   - Reference value: token naming, scanline/noise effect layering, panel/control set.
   - Direct fit: not directly usable here because this project is React/Electron, not Flutter.

3. React-pip-boy
   - URL: https://github.com/CosX/React-pip-boy
   - License observed during research: MIT.
   - Why useful: old React implementation of a Pip-Boy-like interface.
   - Reference value: React structure, tab/panel layout ideas.
   - Caution: old project; do not add it as a dependency without reviewing code and build compatibility.

4. react-pip-boy-ui
   - Package reference: https://www.skypack.dev/view/react-pip-boy-ui
   - License observed during research: ISC.
   - Why useful: small React UI package reference.
   - Caution: old package; prefer reading for ideas over direct dependency use.

5. AviralMehrotra/Fallout4-Pip-Boy
   - URL: https://github.com/AviralMehrotra/Fallout4-Pip-Boy
   - License observed during research: MIT.
   - Why useful: web implementation using HTML/CSS/JS.
   - Reference value: CSS layout and screen effect ideas.
   - Caution: README indicates design/artwork is based on the original game. Do not copy bundled art.

6. Fallout.css
   - URL: https://github.com/zAlweNy26/fallout.css
   - Third-party article: https://www.cssscript.com/retro-futuristic-fallout/
   - License caution: third-party pages may say MIT, but the GitHub repository showed GPL-3.0 during research.
   - Recommendation: do not copy CSS into this app unless the license is rechecked and accepted.

7. GitHub pipboy topic
   - URL: https://github.com/topics/pipboy?o=asc&s=forks
   - Why useful: discovery hub for more community projects.
   - Caution: license varies per repository.

### Asset And Model References

Do not directly ship these assets without a separate review.

1. ArtStation: Fallout 4 Fanart - Pip-Boy 3000 Mark IV
   - URL: https://www.artstation.com/marketplace/p/6YMqa/fallout-4-fanart-pip-boy-3000-mark-iv
   - Why useful: high-quality 3D model reference.
   - License caution: author text indicates non-commercial fan project use, attribution, no redistribution/sale. Treat as reference only.

2. Sketchfab: Pip-Boy 3000 Mark 4 Blockbench Model
   - URL: https://sketchfab.com/3d-models/pip-boy-3000-mark-4-blockbench-model-5bdbee05f4bf4893b9162bb965355eba
   - Why useful: low-poly shape reference.
   - License caution: still based on a recognizable Pip-Boy device. Do not ship directly in a commercial app.

3. Ytec3D / 3D print coverage
   - URL: https://www.3printr.com/get-your-own-3d-printed-pip-boy-case-to-play-fallout-4-3532068/
   - Why useful: shows physical device assembly and proportions.
   - Reference value: frame, hinge, screen bezel, control clusters.

4. Fallout Wiki location map icon template
   - URL: https://fallout.wiki/wiki/Template%3ALocation_map/Icons
   - Why useful: examples of simple map/location icon vocabulary.
   - Caution: do not copy Fallout-specific map icons.

5. Wikimedia Commons: Fallout shelter symbol
   - URL: https://commons.wikimedia.org/wiki/File%3AFallout_shelter_symbol_Pinhead_icon.svg
   - Why useful: public-domain/CC0 civil-defense style symbol reference.
   - Safer use case: inspiration for generic warning/shelter signage, not game branding.

## Typography

Recommended stack:

```css
font-family:
  "Share Tech Mono",
  "IBM Plex Mono",
  "JetBrains Mono",
  Consolas,
  "Microsoft YaHei UI",
  monospace;
```

Practical notes:

- The app has Chinese UI. Pure Latin terminal fonts may not cover Chinese glyphs.
- Keep Chinese fallback readable. Do not force Chinese text into a decorative Latin-only font.
- Use uppercase technical labels for short English UI labels only.
- Keep letter spacing at `0`; do not use negative letter spacing.
- Avoid excessive glow on body text.

Possible font source:

- Google Fonts: Share Tech Mono
  - URL: https://fonts.google.com/specimen/Share%2BTech%2BMono
  - Recheck license before bundling.

Avoid:

- Do not embed `Monofonto` unless its current EULA is reviewed for desktop app/web embedding.
- DaFont page noted app/web embedding may need separate handling.

## Proposed Theme Names

Use one of these for implementation and product UI:

- `field-terminal`
- `phosphor`
- `retro-terminal`
- `wasteland-terminal` only if the product tone allows it

Avoid:

- `pipboy`
- `fallout`
- `vault`
- `vault-tec`

Internal file names can mention `pipboy-inspired` only for this planning document. Production theme code should use a generic name.

## Visual Tokens Draft

These are starting tokens, not final colors.

```css
:root[data-theme="field-terminal"] {
  --text: #9cffb1;
  --text-strong: #d7ffe0;
  --text-soft: #66d886;
  --text-muted: #3f935a;

  --surface: #020604;
  --surface-strong: #06140b;
  --surface-soft: #0a1d10;
  --surface-faint: rgba(21, 255, 82, 0.06);
  --surface-hover: rgba(21, 255, 82, 0.12);

  --stroke: rgba(21, 255, 82, 0.48);
  --stroke-soft: rgba(21, 255, 82, 0.24);
  --stroke-raised: rgba(21, 255, 82, 0.34);
  --stroke-strong: rgba(156, 255, 177, 0.78);

  --shell-outline: rgba(21, 255, 82, 0.66);
  --shell-outline-inner: rgba(156, 255, 177, 0.18);

  --accent: #15ff52;
  --accent-soft: rgba(21, 255, 82, 0.16);
  --teal: #00cfff;
  --teal-soft: rgba(0, 207, 255, 0.12);
  --success: #15ff52;
  --danger: #ff4a4a;
  --danger-soft: rgba(255, 74, 74, 0.14);

  --radius-shell: 10px;
  --radius-panel: 6px;
  --radius-control: 3px;

  --shadow-panel:
    0 0 0 1px rgba(21, 255, 82, 0.2),
    0 0 24px rgba(21, 255, 82, 0.18);
  --shadow-control:
    0 0 0 1px rgba(21, 255, 82, 0.18),
    inset 0 0 14px rgba(21, 255, 82, 0.05);
  --shadow-raised:
    0 0 0 1px rgba(21, 255, 82, 0.2),
    inset 0 0 18px rgba(21, 255, 82, 0.06);
  --highlight: inset 0 0 0 1px rgba(156, 255, 177, 0.08);
  --blur: none;
}
```

Optional alternate display colors:

```css
:root[data-terminal-color="green"] {
  --accent: #15ff52;
}

:root[data-terminal-color="amber"] {
  --accent: #ffb300;
}

:root[data-terminal-color="blue"] {
  --accent: #00cfff;
}
```

If alternate colors are implemented, derive text/stroke variables from the selected accent instead of hardcoding every state.

## CSS Effect Drafts

### Scanline Overlay

Add as a pseudo-element on `.app-panel` and `.detail-window`. Keep opacity low.

```css
:root[data-theme="field-terminal"] .app-panel::after,
:root[data-theme="field-terminal"] .detail-window::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  background:
    repeating-linear-gradient(
      to bottom,
      rgba(156, 255, 177, 0.08) 0,
      rgba(156, 255, 177, 0.08) 1px,
      transparent 1px,
      transparent 4px
    );
  mix-blend-mode: screen;
  opacity: 0.24;
}
```

Current CSS already uses `.app-panel::before` and `.detail-window::before`. If adding `::after`, verify z-index does not cover interactive controls. Keep direct children above base layers, or put the effect below with `z-index` control.

### Vignette / CRT Glass

```css
:root[data-theme="field-terminal"] .app-panel::before,
:root[data-theme="field-terminal"] .detail-window::before {
  background:
    radial-gradient(circle at 50% 40%, transparent 0 52%, rgba(0, 0, 0, 0.34) 100%),
    linear-gradient(180deg, rgba(156, 255, 177, 0.08), transparent 26%);
  opacity: 1;
}
```

### Text Glow

Use only for labels and high-signal elements:

```css
:root[data-theme="field-terminal"] .status-pill,
:root[data-theme="field-terminal"] .version-button,
:root[data-theme="field-terminal"] .task-title-button {
  text-shadow: 0 0 6px rgba(21, 255, 82, 0.32);
}
```

Do not apply strong glow globally to all text.

## Component Mapping

### App Shell

Current selectors:

- `.app-panel`
- `.detail-window`
- `.task-panel`
- `.task-surface`

Theme changes:

- Replace translucent glass with near-black terminal surface.
- Use smaller radii.
- Use thin green border instead of white glass outline.
- Keep `-webkit-app-region: drag` behavior intact.
- Avoid adding large decorative images or gradients.

### Top Bar

Current selectors:

- `.drag-bar`
- `.task-drag`
- `.window-controls`
- `.status-pill`
- `.version-button`

Theme changes:

- Make `status-pill` read like a terminal status segment: `HOST`, `CLIENT`, `LAN`, `SYNC`.
- Keep compact dimensions; no hero-style header.
- Consider replacing rounded pills with rectangular segmented controls in a later pass.

### Side Rail

Current selectors:

- `.side-rail`
- `.current-user`
- `.scope-button`

Theme changes:

- Make the side rail feel like hardware controls: darker strip, thin separators.
- Keep avatar support, but lower decorative colorfulness if the theme is active.
- `scope-button` can become a two-line terminal toggle.

### Task Rows

Current selectors:

- `.task-list`
- `.task-row`
- `.task-check`
- `.task-title-button`
- `.assignment-avatar-button`

Theme changes:

- Rows should become dense terminal list entries.
- Completion can use dimmed text and a left marker rather than heavy opacity only.
- Hover should use subtle phosphor fill, not bright blue/teal glass.
- Keep hit areas large enough for desktop use.

### Popovers And Menus

Current selectors:

- `.assignment-popover`
- `.version-popover`
- `.task-context-menu`
- `.settings-panel`
- `.image-preview-panel`

Theme changes:

- Convert glass panels to black/green framed overlays.
- Keep content readable; screenshots should not be tinted.
- Keep menu positioning logic unchanged.

### Detail Window

Current selectors:

- `.detail-window`
- `.detail-header`
- `.detail-content`
- `.detail-field`
- `.detail-screenshot-block`
- `.detail-footer`

Theme changes:

- Use the same terminal shell.
- Keep form fields readable for long Chinese descriptions.
- Do not put scanlines over screenshot previews or image preview modal if it makes images hard to inspect.

### Compact Mode

Current selectors:

- `.compact-panel`
- `.compact-icon`
- `.compact-icon-art`
- `.compact-avatar-face`
- `.compact-badge`

Theme options:

- Minimal first pass: preserve compact art, adjust badge colors to terminal palette.
- More thematic later pass: create a small monochrome terminal tile with user initials, task count, and change count.
- Do not break dragging behavior in `CompactIcon`.

## Suggested Implementation Plan

### Phase 1: CSS-Only Static Theme

Goal: ship one hardcoded terminal theme quickly without settings UI.

Tasks:

1. Add a theme attribute in `App.tsx`, for example on the returned top-level elements or by setting `document.documentElement.dataset.theme = "field-terminal"` in an effect.
2. Add theme-specific CSS under `:root[data-theme="field-terminal"]`.
3. Override existing glass gradients, shadows, borders, radii, and colors.
4. Add scanline/vignette effects with low opacity.
5. Verify all screens:
   - loading
   - connect
   - account login
   - profile setup
   - main task list
   - version popover
   - assignment popover
   - settings/trash panel
   - task detail window
   - compact mode

Acceptance:

- `npm run typecheck` passes.
- `npm run build` passes.
- UI remains readable in Chinese.
- No text overlaps inside buttons, rows, tabs, or popovers.
- Screenshot preview remains visually inspectable.

### Phase 2: Theme Toggle And Persistence

Goal: allow switching between current glass theme and terminal theme.

Likely data changes:

- Extend `AppPreferences` in `src/shared/types.ts`:

```ts
export interface AppPreferences {
  lastJoinAddress?: string;
  lastAccountId?: string;
  theme?: "glass" | "field-terminal";
  terminalColor?: "green" | "amber" | "blue";
}
```

Implementation notes:

- Check existing preference read/write behavior in Electron main/preload before changing types.
- Add a settings control rather than a new landing page.
- Use a segmented control or icon buttons, not long explanatory text.
- Persist locally; theme should not need LAN host sync unless explicitly requested.

Acceptance:

- Existing preferences migrate without data loss.
- Theme applies on first render after preferences load.
- Default remains current glass UI unless user asks to change default.

### Phase 3: Component Polish

Goal: make the theme feel intentional instead of a color swap.

Tasks:

- Replace rounded pills with rectangular segmented controls where appropriate.
- Add bracket-style panel borders to `.task-surface`, `.version-popover`, `.settings-panel`.
- Add small terminal metadata labels:
  - `HOST`
  - `CLIENT`
  - `VER`
  - `TASKS`
  - `USER`
- Use lucide icons but keep strokes aligned with theme color.
- Adjust avatar presentation so user images remain visible but less visually loud.
- Add `prefers-reduced-motion` handling for any flicker/noise animation.

Acceptance:

- Theme reads as a field terminal from the first viewport.
- It still feels like a professional task tool.
- Effects are subtle enough for daily use.

### Phase 4: Original Assets Only

Goal: if assets are needed, create original app-specific assets.

Allowed:

- Original monochrome line icons.
- Generic warning/sync/network/task glyphs.
- Original terminal frame texture generated or drawn for this app.
- Generic civil-defense-inspired shapes if not copied from Fallout.

Avoid:

- Vault Boy mascot.
- Pip-Boy casing silhouettes that are too exact.
- Fallout map markers.
- Fallout screenshots.
- Bethesda product images.

## Files To Start With

Start in this order:

1. `src/renderer/styles.css`
   - Add token overrides and theme selectors.
   - This should handle most of Phase 1.

2. `src/renderer/App.tsx`
   - Add theme attribute setup.
   - Later, add theme toggle UI if Phase 2 is requested.

3. `src/shared/types.ts`
   - Only needed for persisted theme preference.

4. Electron main/preload files
   - Only needed after checking how preferences are stored and exposed through `window.coWorkApi`.

## Proposed Minimal Code Shape

For Phase 1 only, a minimal approach is:

```tsx
useEffect(() => {
  document.documentElement.dataset.theme = "field-terminal";

  return () => {
    delete document.documentElement.dataset.theme;
  };
}, []);
```

Place this near the top of `App()` after state declarations, or create a small `useThemeAttribute` helper if a toggle is planned.

For Phase 2, use preferences instead:

```tsx
useEffect(() => {
  document.documentElement.dataset.theme = preferences.theme ?? "glass";
  document.documentElement.dataset.terminalColor = preferences.terminalColor ?? "green";
}, [preferences.theme, preferences.terminalColor]);
```

Do not commit to this exact code before inspecting current preference persistence.

## Accessibility And Usability Requirements

Minimum requirements:

- Body text contrast must remain high.
- Inputs, textareas, task titles, and menu items must be readable without relying on glow.
- Focus states must remain visible.
- Disabled states must remain distinguishable.
- Error red must stand apart from phosphor green.
- Screenshots/images must not be tinted by overlays.
- Motion should be minimal; add `prefers-reduced-motion` if flicker/noise is animated.
- Chinese labels must fit existing compact containers.

Suggested CSS safety:

```css
@media (prefers-reduced-motion: reduce) {
  :root[data-theme="field-terminal"] * {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}
```

Use carefully; broad overrides can affect useful micro-interactions. Prefer targeted animation removal if possible.

## Development Verification

Run:

```powershell
npm run typecheck
npm run build
```

Manual checks:

- Start dev app with `npm run dev`.
- Check main window at normal and narrow sizes.
- Check detail window.
- Check compact mode drag/restore.
- Open version popover and drag versions.
- Open task context menu near right/bottom edges.
- Open settings/trash panel.
- Paste/select screenshot in detail view and confirm image preview is not obscured by CRT effects.

If using screenshots for visual verification, capture:

- Main task list.
- Empty task list.
- Version popover.
- Settings/trash panel.
- Detail window with screenshots.
- Compact mode.

## Non-Goals For First Pass

Do not do these in the first implementation unless explicitly requested:

- Do not add 3D Pip-Boy model rendering.
- Do not add Bethesda/Fallout branding.
- Do not add a mascot.
- Do not import third-party Fallout CSS wholesale.
- Do not redesign data model or LAN protocol for theme work.
- Do not make a marketing/landing page.
- Do not rewrite `App.tsx` into many components as part of the theme pass unless necessary.

## Handoff Summary

The safest implementation path is:

1. Build an original `field-terminal` CSS theme based on the current app classes.
2. Use Pip-Boy references only for visual principles:
   - monochrome CRT display
   - dense terminal typography
   - thin panel borders
   - hardware-like compact controls
   - scanline/vignette texture
3. Keep all app labels and assets original to `Cowork Agents LAN`.
4. Add preference persistence only after a CSS-only prototype is visually accepted.

