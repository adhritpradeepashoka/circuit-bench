// Board drawings from Arduino's docs (arduino/docs-content, CC BY-SA 4.0): flatten the CSS classes into fill attributes, round the numbers and merge
// runs of same-coloured shapes, so a drawing is small and every shape's colour is on the shape. Used by scripts/build-board-art.mjs.
import { optimize } from 'svgo';
export function optimizeSvg(svg, precision = 1) {
  return optimize(svg, {
    multipass: true,
    plugins: [
      { name: 'preset-default', params: { overrides: { removeViewBox: false, cleanupIds: false, mergePaths: false, inlineStyles: { onlyMatchedOnce: false } } } },
      { name: 'convertPathData', params: { floatPrecision: precision, transformPrecision: 4, applyTransforms: true } },
      'removeDimensions', 'removeTitle', 'removeDesc',
    ],
  }).data;
}
