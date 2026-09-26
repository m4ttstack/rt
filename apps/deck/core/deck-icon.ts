// The deck mark: a 2x2 tile grid on the mattstack pink squircle, drawn in the
// same family as the other app icons (board/chat/console). It is served as the
// board's favicon and used as deck's own row icon in the mattstack section, so
// the browser tab and the listing share one source rather than drifting apart.
export const DECK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" rx="7.2" fill="#ff84ad"/>
  <g fill="#1d1830">
    <rect x="10" y="10" width="5.2" height="5.2" rx="1.2"/>
    <rect x="16.8" y="10" width="5.2" height="5.2" rx="1.2"/>
    <rect x="10" y="16.8" width="5.2" height="5.2" rx="1.2"/>
    <rect x="16.8" y="16.8" width="5.2" height="5.2" rx="1.2"/>
  </g>
</svg>`;
