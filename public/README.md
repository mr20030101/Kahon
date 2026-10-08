# Kahon — logo assets

Every SVG has the wordmark converted to outlines, so nothing depends on
Plus Jakarta Sans being installed. Transparent backgrounds except icon tiles.

The mark is an isometric box — *kahon* — with a lit top face. Three flat tones
and no gradients, so it holds up at any size and in any print process.

## svg/
| File | Use |
| --- | --- |
| `logo-horizontal.svg` | Default. App header, docs, email signature. |
| `logo-horizontal-inverse.svg` | The same lockup on dark grounds. |
| `logo-horizontal-mono.svg` | One colour, inherits `currentColor` from CSS. |
| `logo-stacked.svg` | Narrow spaces, square placements. |
| `mark.svg` / `mark-inverse.svg` | Box alone, full colour. |
| `mark-mono.svg` | Box alone, one colour via `currentColor`. |
| `mark-small.svg` | Below 44 px: drops the shaded face. Use for favicons. |
| `wordmark.svg` / `wordmark-inverse.svg` | Type only. |

## icons/
PNG and SVG at 512, 192, 180, 32 and 16, plus a multi-resolution `favicon.ico`
(16/32/48). `icon-512-accent.svg` is the green-ground alternate.

Paste `favicon-snippet.html` into your `<head>`.

## print/
Vector PDF and EPS: full colour, one-ink, and reverse for dark stock. Reverse
artwork looks blank on a white screen — that is correct, not a fault.

## pattern/
Seamless 120x120 tiles of small isometric boxes on a half-drop lattice.

```css
background-color: var(--kahon-light);
background-image: url("/pattern/tile-light.svg");
background-size: 120px 120px;
```

Texture, not content: fine behind headers, empty states, login and 404 screens.
Never behind body copy.

## Colour

| Name | Token | HEX | CMYK (approx.) |
| --- | --- | --- | --- |
| Ink | `--kahon-ink` | #3b2a1d | 0 / 19 / 34 / 77 |
| Shade | `--kahon-shade` | #241711 | 0 / 27 / 31 / 85 |
| Sub | `--kahon-sub` | #7a5a49 | 0 / 24 / 35 / 48 |
| Sand | `--kahon-accent` | #b8885d | 0 / 18 / 33 / 46 |
| Sand Deep | `--kahon-accent-text` | #845c35 | 0 / 22 / 44 / 48 |
| Drift | `--kahon-mist` | #e8dfd8 | 2 / 5 / 10 / 9 |
| Paper | `--kahon-light` | #d1bfb0 | 0 / 8 / 19 / 18 |

Sand `#b8885d` is the primary fill; use Sand Deep `#845c35` for links and
coloured type on light grounds, and keep Sand for fills, the mark, and status
dots.

CMYK figures are arithmetic conversions, not press-matched. For spot work,
Pantone 7406 C is a close starting point for Sand — check it against a physical
swatch book first.

## Rules
- Clear space on all four sides = half the mark's height.
- Minimums: mark 24 px / 8 mm, full lockup 112 px wide / 30 mm.
- Don't stretch, recolour, tilt, or place the logo on a low-contrast ground.
- Don't rotate the box to a different isometric angle — the 30-degree
  projection is what makes it recognisable at 16 px.
