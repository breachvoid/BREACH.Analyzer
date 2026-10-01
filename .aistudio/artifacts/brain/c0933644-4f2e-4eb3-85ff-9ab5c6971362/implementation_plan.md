# Floating Waveform Zoom Cluster Industrial Restyling

Restyle the floating zoom and timebase navigation overlay (`#waveform-canvas-zoom-cluster`) in the DJ Waveform Deck into an industrial instrumentation cluster with dark charcoal surfaces, sharp square controls, high-contrast states, and tactile alignment.

## User Review & Critical Decisions

> [!IMPORTANT]
> The visual styling and layout preferences were confirmed through interactive clarification:

- **Confirmed Decision (Visual Style)**: Industrial square buttons with dark charcoal surface (`#181818`), crisp `#4a4a4a` borders, and high-contrast `#F2F2F2` / `#B8B8B8` text and icons.
- **Confirmed Decision (Positioning)**: Vertically centered on the left canvas edge (`absolute left-3 top-1/2 -translate-y-1/2`) to maximize visibility over the scrolling multi-band waveform while maintaining clear tactile thumb/mouse access.
- **Scope Enhancement**: Include symmetrical **Nudge Left (`‹`)** and **Nudge Right (`›`)** beatgrid buttons alongside Zoom In (`+`), Zoom Reset (`RST`), and Zoom Out (`-`) for a complete, balanced calibration toolbar.

---

## 1. Overview & Core Concept

- **What It Does**: Upgrades the floating canvas zoom and beatgrid toolbar (`#waveform-canvas-zoom-cluster`) located within the primary DJ Waveform Deck (`#dj-detail-canvas-stage`).
- **Target Audience**: Audio engineers, DJs, and sound designers who demand immediate, tactile micro-controls over the waveform magnification and transient beatgrid alignment without breaking visual focus.
- **Key Value**: Replaces rounded generic button styles with BREACH's strict industrial instrumentation aesthetic—sharp 90-degree square buttons, distinct charcoal surface layering, and clear hover/active feedback.

---

## 2. User Experience & Visual Design

### Key User Interactions
1. **Zoom In (`+`)**: Sharp square 26×26px industrial button increases horizontal timebase zoom by `+0.5x` (up to `12.0x`).
2. **Zoom Reset (`RST`)**: Compact rectangular badge button (`28×26px`) restores zoom to the default reference level (`3.5x`) with 10px monospace uppercase typography.
3. **Zoom Out (`-`)**: Symmetrical square button decreases horizontal zoom by `-0.5x` (down to `1.0x`).
4. **Beatgrid Calibration (`‹` & `›`)**: Paired nudge controls separated by an internal vertical divider (`border-l border-[#383838]`), enabling immediate fractional transient alignment in both directions.

### Visual Identity & Design Tokens
- **Container Surface**: `#141414` solid background with 95% opacity (`backdrop-blur-sm`), sharp 0px radius (`rounded-none`), and thin `#3a3a3a` perimeter border.
- **Button Surfaces**:
  - *Idle*: `#181818` background, `#383838` subtle border, `#B8B8B8` icon/text.
  - *Hover*: `#242424` background, `#F2F2F2` icon/text, `#4a4a4a` border.
  - *Active / Pressed*: `#b20000` accent border or `#303030` depression state.
- **Zero-Pill Discipline**: Strictly square (`rounded-none`), thin borders (1px solid), flush internal spacing (`gap-1`), and zero rounded pills or decorative glow effects.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Full-Featured Beatgrid Nudge Pair (Left + Right)**
  - *Chosen Approach*: Add the matching `Nudge Right` (`›`) button alongside `Nudge Left` (`‹`) inside the cluster.
  - *Why*: The original floating cluster only had `Nudge Left`, forcing users to seek the bottom deck strip for `Nudge Right`. Providing both in the floating cluster makes quick waveform calibration self-contained.
  - *Alternatives Considered*: Retaining only zoom buttons or only left-nudge was asymmetrical and functionally incomplete.

- **Decision 2: Square Instrumentation Geometry**
  - *Chosen Approach*: Replace `rounded-sm` container and `rounded` buttons with `rounded-none` square blocks.
  - *Why*: Conforms strictly to the BREACH industrial design language established across the audio engine meters and transport panels.

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│ #dj-detail-canvas-stage (Canvas Viewport)                              │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ #waveform-canvas-zoom-cluster (left-3, top-1/2, -translate-y-1/2)│  │
│  │ ┌───────┐ ┌─────────┐ ┌───────┐ ┆ ┌───────┐ ┌───────┐            │  │
│  │ │ +     │ │ RST     │ │ -     │ ┆ │ ‹     │ │ ›     │            │  │
│  │ │ Zoom+ │ │ (3.5x)  │ │ Zoom- │ ┆ │ NudgeL│ │ NudgeR│            │  │
│  │ └───────┘ └─────────┘ └───────┘ ┆ └───────┘ └───────┘            │  │
│  │ Industrial Charcoal Surface (#141414), 1px Border (#3a3a3a)      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  [ Multi-band 3-way Scrolling RGB / Void Waveform Canvas ]             │
└────────────────────────────────────────────────────────────────────────┘
```

### Component State Mapping (`src/components/DJWaveformDeck.tsx`)
- `zoomLevel` state (bounded between `1.0` and `12.0`): Controlled via `setZoomLevel`.
- `handleNudgeGrid(direction: 'left' | 'right')`: Fires beatgrid transient offset adjustment by `±5ms` with active feedback.
- Accessible ARIA labels and tooltips (`title`) indicating key shortcuts and current zoom context.
