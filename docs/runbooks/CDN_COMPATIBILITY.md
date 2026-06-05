# CDN Compatibility Notes

The default generation prompt allows only a small whitelist of browser CDN libraries.
This keeps preview and published artifacts predictable: generated pages are static HTML,
CSS, and JS served by nginx, with no build step and no npm runtime.

## Current Verified CDN Set

These URLs were checked from the development environment with HTTP HEAD/GET requests:

| Purpose | Library | URL |
| --- | --- | --- |
| Utility CSS | Tailwind CSS 3.4.17 | `https://cdn.tailwindcss.com/3.4.17` |
| Reactive UI | Alpine.js 3.15.12 | `https://cdn.jsdelivr.net/npm/alpinejs@3.15.12/dist/cdn.min.js` |
| Animation | GSAP 3.15.0 | `https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js` |
| Charts | Chart.js 4.5.1 | `https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js` |
| Icons | Lucide 0.468.0 | `https://cdn.jsdelivr.net/npm/lucide@0.468.0/dist/umd/lucide.min.js` |
| Scroll reveal | AOS 2.3.4 | `https://cdn.jsdelivr.net/npm/aos@2.3.4/dist/aos.css` + `https://cdn.jsdelivr.net/npm/aos@2.3.4/dist/aos.js` |
| Carousel | Swiper 12.2.0 | `https://cdn.jsdelivr.net/npm/swiper@12.2.0/swiper-bundle.min.css` + `https://cdn.jsdelivr.net/npm/swiper@12.2.0/swiper-bundle.min.js` |
| Lightbox | GLightbox 3.3.1 | `https://cdn.jsdelivr.net/npm/glightbox@3.3.1/dist/css/glightbox.min.css` + `https://cdn.jsdelivr.net/npm/glightbox@3.3.1/dist/js/glightbox.min.js` |
| 2D games | Phaser 3.90.0 | `https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js` |
| 2D physics | Matter.js 0.20.0 | `https://cdn.jsdelivr.net/npm/matter-js@0.20.0/build/matter.min.js` |
| Canvas sketches | p5.js 2.3.0 | `https://cdn.jsdelivr.net/npm/p5@2.3.0/lib/p5.min.js` |
| 3D global build | Three.js 0.160.0 | `https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js` |
| WebXR / VR | A-Frame 1.7.1 | `https://aframe.io/releases/1.7.1/aframe.min.js` |

## Three.js Version Pin

Three.js is intentionally pinned to `0.160.0` for generated artifacts.
Newer versions are module-first and do not provide the same global `THREE`
UMD/minified build path. The platform prompt currently forbids `type="module"`
scripts and npm imports, so `0.160.0` is the compatible static-page choice.

If the platform later permits ES modules in generated artifacts, update Layer A,
Layer E, tests, and this runbook together.

## Pairing Rules

Libraries with CSS and JS halves must ship both halves together:

- AOS: CSS + JS + `AOS.init()`
- Swiper: CSS + JS + `new Swiper(...)`
- GLightbox: CSS + JS + `GLightbox(...)`

If the generated HTML contains the marker class/attribute but omits the matching
script or init call, preview and publication can render blank or broken UI.

## Verification Command

From the repository root on Windows PowerShell:

```powershell
$urls = @(
  'https://cdn.tailwindcss.com/3.4.17',
  'https://cdn.jsdelivr.net/npm/alpinejs@3.15.12/dist/cdn.min.js',
  'https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/lucide@0.468.0/dist/umd/lucide.min.js',
  'https://cdn.jsdelivr.net/npm/aos@2.3.4/dist/aos.css',
  'https://cdn.jsdelivr.net/npm/aos@2.3.4/dist/aos.js',
  'https://cdn.jsdelivr.net/npm/swiper@12.2.0/swiper-bundle.min.css',
  'https://cdn.jsdelivr.net/npm/swiper@12.2.0/swiper-bundle.min.js',
  'https://cdn.jsdelivr.net/npm/glightbox@3.3.1/dist/css/glightbox.min.css',
  'https://cdn.jsdelivr.net/npm/glightbox@3.3.1/dist/js/glightbox.min.js',
  'https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js',
  'https://cdn.jsdelivr.net/npm/matter-js@0.20.0/build/matter.min.js',
  'https://cdn.jsdelivr.net/npm/p5@2.3.0/lib/p5.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js',
  'https://aframe.io/releases/1.7.1/aframe.min.js'
)
foreach ($url in $urls) {
  try {
    $response = Invoke-WebRequest -Uri $url -Method Head -UseBasicParsing -TimeoutSec 15
    "$([int]$response.StatusCode) $url"
  } catch {
    "FAIL $url :: $($_.Exception.Message)"
  }
}
```
