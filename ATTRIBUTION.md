# Attribution

## Head model (`src/assets/head.glb`)

"3D human head scan" by **celer** on Thingiverse, https://www.thingiverse.com/thing:4245056,
licensed under Creative Commons Attribution (CC BY).

Changes made by CircuitBench: cropped below the neck, rotated into the app's axes (x right, y nose, z up),
reduced from about 458,000 to 36,000 triangles, and recentred and scaled to units of 100 mm.
The electrode positions in `src/core/head-sites.generated.js` were computed on that mesh.

## Full-body model (`src/assets/body.glb`)

The base mesh of **MakeHuman** (hm08), https://github.com/makehumancommunity/makehuman, released by its copyright holders
(Data Collection AB, Joel Palmius, Jonas Hauquier) as **CC0** (public domain) in September 2020. `scripts/body/bake-body.mjs`
keeps only the skin, converts it to 1 unit = 100 mm (x right, y front, z up) and writes the joint centres and electrode sites in
`src/core/body-model.generated.js`. The elbow bend in `src/core/arm-rig.js` is our own.
