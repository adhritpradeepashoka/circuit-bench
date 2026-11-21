# Part Maker model (on-device, CPU only)

Turns "INA128 with gain 500" into a part: name | label | kind | pins in datasheet order | numbers. Same pure-JS transformer as the bench
tiny model (`src/sim/tiny-model.mjs`), about 2M parameters, 3.9 MB, no GPU and no key. `unknown` means "not mine": the Part Maker asks the AI.

Retrain (about 26 minutes on 2 CPU cores):

    node tools/dump-part-catalog.mjs                       # built-in templates the model can express -> templates.json
    python3 scripts/part-model/gen_part_data.py 60000 1500 1500 /tmp/pm
    TINY_D=160 TINY_H=4 TINY_FF=480 TINY_NE=3 TINY_ND=3 TINY_MAXIN=40 TINY_MAXOUT=100 TINY_NAME=part-model \
      python3 scripts/tiny/train.py /tmp/pm /tmp/pmout 26
    cp /tmp/pmout/part-model.{bin,json} public/

To teach it a new part, add a `P(...)` line to `EXTRA` in `gen_part_data.py` (pins exactly as the datasheet prints them) and retrain.
Roles are never written by the model: `src/core/part-model-decode.js` works them out from the pin names (test/part-model.test.mjs checks them against the templates).
Plain values (22k resistor, 100nF capacitor, 10 mH inductor, 5.1v zener) are read by rule in `valuePart`, not by the network.
