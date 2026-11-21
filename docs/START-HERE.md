# Start here: making CircuitBench yours

This guide is for someone who can read code well and knows how a program is structured, but does not yet write JavaScript fluently. The plan is to let you do the part you are good at (deciding what should change and checking that it did) and to give you a short list of patterns for the part you are not (typing the syntax), until typing it yourself stops being scary.

## The idea in one paragraph

You do not need to memorise syntax to change this project. You need to (1) find the right file, (2) say what should change in plain words or pseudocode, (3) get the exact code written, by you or by an AI, and (4) prove it works with a test or by looking at the screen. Step 3 is the only place syntax matters, and this codebase uses a small, repeating set of patterns. Learn those patterns (below) and you can read and write almost all of it.

## Part 0: Work on your own copy

Do your experiments on a clone, not on the live code. The live site deploys from the `main` branch, so anything pushed there goes out to users.

```
git clone https://github.com/adhritpradeepashoka/circuit-bench.git circuit-bench-play
cd circuit-bench-play
npm install
git checkout -b my-experiments     # a branch: your changes stay here until you decide otherwise
npm run dev                        # opens the app locally, reloads when you save a file
```

- Everything you break stays on your computer. Throw the whole folder away and clone again if you want a clean start.
- Commit often on your branch (`git add -A`, `git commit -m "what and why"`). When a change is good, push the branch (`git push -u origin my-experiments`) and merge it into `main` yourself or ask for a review first.
- Pull other people's (or an AI's) changes into your clone with `git pull origin main`.
- Without a server, the compile service and accounts do not work on your clone. The simulator, the parts, the tests and the tiny models do. To run everything, use `npm start` (it needs the server's own settings).

## Part 1: The map

| Folder | What lives there | How hard to change |
|---|---|---|
| `src/core/` | The rules: circuit maths, parts, boards, workspaces, the AI prompt, the ML maths. No screen code. | Easiest. Plain Node runs it, so tests are quick. |
| `src/sim/` | The chip emulators (`mcu.js` runs real Arduino firmware), the compile client, the AI client, the tiny models. | Medium. |
| `src/parts/elements.js` | The drawing of every part (the sprites). | Easy to read, fiddly to draw. |
| `src/ui/` | Everything you see, one file per feature (`simulation.js`, `assembly.js`, `robot-test.js`, `classroom.js`, `ml.js`, `ai-panel.js`). | Medium. `assembly.js` is huge, so leave it for last. |
| `src/main.js` | Starts everything and hands pieces to each other. Read this first. | Small and clear. |
| `server/` | Accounts, classes, feedback, the AI proxy, the compile service. | Medium. Needs care (it holds user data). |
| `test/` | About 650 tests. Each one shows a feature being used. | Read them like documentation. |
| `scripts/`, `tools/` | Builders, the tiny-model trainer, fixture builders. | Rarely touched. |

How a feature is usually laid out: the rule lives in `src/core/` (so it can be tested), the screen part lives in `src/ui/`, and `src/main.js` connects them. When you find a feature, look for those three pieces.

## Part 2: The syntax you actually need

You will see the same ten patterns again and again. Each one below has the plain-English meaning.

**1. Constants and functions**
```js
const total = 5;                       // a value that is not reassigned
let count = 0;                         // a value that changes
function add(a, b) { return a + b; }   // a normal function
const add2 = (a, b) => a + b;          // the same thing, short form ("arrow function")
```
`=>` just means "a small function". Most of the code uses it.

**2. Template strings** (text with values dropped in)
```js
const label = `Servo ${index + 1} is at ${angle} degrees`;
```
Backticks, and `${ ... }` holds any expression.

**3. Objects and arrays**
```js
const part = { id: 'led-1', type: 'led', x: 40, y: 80 };   // an object: named fields
const list = ['a', 'b', 'c'];                                // an array: ordered items
part.x            // 40
list[0]           // 'a'
```

**4. Destructuring** (pulling pieces out in one line)
```js
const { id, type } = part;          // id = 'led-1', type = 'led'
const [first, second] = list;       // first = 'a', second = 'b'
function show({ id, x }) { ... }    // a function that takes an object and uses two of its fields
```

**5. Spread** (copy, then change)
```js
const moved = { ...part, x: 100 };   // a copy of part with x replaced
const more = [...list, 'd'];         // a copy of list with 'd' added
```
This is how the code changes things without editing the original.

**6. The array tools** (these replace most loops)
```js
list.map(x => x.toUpperCase())        // a new array: each item changed
list.filter(x => x !== 'b')           // a new array: only items that pass
list.find(x => x.startsWith('c'))     // the first item that passes, or undefined
list.some(x => x === 'a')             // true if any item passes
list.every(x => x.length === 1)       // true if all items pass
list.reduce((sum, x) => sum + x.length, 0)   // fold the list down to one value
for (const item of list) { ... }      // a plain loop over the items
```

**7. Optional chaining and defaults** (safe access)
```js
part?.pins?.length        // undefined instead of an error if part or pins is missing
const n = value ?? 10     // 10 only if value is null or undefined
const m = value || 10     // 10 if value is falsy (0, '', null, undefined, false)
```
`??` and `||` look alike. `??` only replaces "missing", `||` also replaces `0` and empty text.

**8. Ternary** (a one-line if)
```js
const side = x < 0 ? 'left' : 'right';
```

**9. Imports and exports** (how files connect)
```js
import { buildPrompt } from './ai-prompt.js';   // bring a thing in from another file
export function buildPrompt() { ... }            // let other files use this
```
If you add a function that another file needs, put `export` in front and add an `import` where it is used.

**10. async and await** (waiting for something slow)
```js
async function load() {
  const res = await fetch('/api/thing');   // wait for the network
  const data = await res.json();
  return data;
}
```
`await` only works inside an `async` function. You will see it wherever the code talks to the server, the AI, or loads a model.

Two more you will meet: `?.` before a call (`fn?.()` means "call it only if it exists"), and regular expressions like `/^mix-[a-z-]+$/`, which are patterns for matching text (look them up at regex101.com when you need to read one).

## Part 3: The loop that makes it safe to change things

Do the same five steps every time.

1. **Say it in words.** "When the servo angle is over 170, show it in red." Write it as a comment or in the chat.
2. **Find it.** Search the project for a word near the feature (for example `servoAngles`). In a terminal: `grep -rn "servoAngles" src`. In an editor: search all files.
3. **Get the code written.** Ask an AI: "Here is the function (paste it). Change it so that [your sentence]. Keep the style of the surrounding code and change as little as possible." Ask for a diff, not a rewritten file.
4. **Read it back to yourself.** You read code well, so check it: does every line do what you meant? If a line confuses you, ask the AI to explain that single line.
5. **Prove it.** Run the matching test: `node --test test/mix.test.mjs`. Then run all of them: `npm test`. Then look at it in the browser: `npm run dev`.

If a test fails after your change, that is information, not a failure. Read the failing line; it tells you what the code was protecting.

Then commit small: one change, one commit, so any change can be undone.

## Part 4: Writing your own code from your own plan

Because you can design structure, write the structure first and let the syntax fill in:

1. Write the function as **pseudocode comments**:
   ```js
   // function mapAngle(angle, low, high)
   //   clamp angle between 0 and 180
   //   return low + (angle / 180) * (high - low)
   ```
2. Replace each comment with real code one at a time. Use the ten patterns above. When stuck on one line, ask for only that line.
3. Write the test first when you can. A test says what should be true; the code then has a clear target:
   ```js
   import test from 'node:test';
   import assert from 'node:assert/strict';
   import { mapAngle } from '../src/core/example.js';
   test('0 degrees is the low end, 180 the high end', () => {
     assert.equal(mapAngle(0, -45, 45), -45);
     assert.equal(mapAngle(180, -45, 45), 45);
   });
   ```
   Then add the file to the `test` script in `package.json` so `npm test` runs it.

## Part 5: A ladder of changes, easiest first

Each rung teaches one more pattern. Do them in order.

1. **Change text.** Edit a label in `index.html` or a hint in `src/core/workspaces.js`. Run `npm run dev` and see it. (Teaches: where things show up.)
2. **Change a number.** In `src/core/boards.js`, change a board's `flash` or `ram` and see the effect. (Teaches: objects and fields.)
3. **Change a colour or font.** In `src/theme-forge.css`, change `--blue`. (Teaches: CSS variables.)
4. **Add a starter project.** In `src/sim/examples.js`, copy `'xiao-blink'`, rename it, change the sketch text. (Teaches: copy a working pattern, then edit.)
5. **Fix a pin label.** Find a part in `src/core/parts.js`, correct a pin name, and run `node --test test/boards.test.mjs`. (Teaches: reading tests.)
6. **Add a workspace tip.** Add a `hint` to a workspace in `src/core/workspaces.js`. (Teaches: manifests.)
7. **Add a test for something that already works.** Pick any small function in `src/core/` and write two asserts for it. (Teaches: the test pattern; zero risk.)
8. **Add a new example action.** Copy how an existing feature in `src/ui/` is hooked up in `src/main.js` and add a tiny one. (Teaches: wiring.)
9. **Add a part.** Follow how the XIAO ESP32-S3 was added: `parts.js` (pins and size), `elements.js` (the drawing), `boards.js` (if it is a board), `packs.js` (which pack it belongs to), plus a test. This is the biggest rung. Every part needs an accurate drawing and a real pin map.

## Part 6: When something breaks

- **A red error in the browser console:** read the first line. It names a file and a line number. Open that file at that line.
- **`x is not a function` or `undefined`:** something you expected to exist does not. Check the spelling of the name, and check that it was imported.
- **A test fails:** read the "expected" and "actual" lines; they say exactly what differed.
- **The page is blank:** run `npx vite build`. It prints syntax errors with line numbers.
- **You changed something and now other things break:** `git diff` shows exactly what you changed; `git checkout <file>` throws your change away.

## Part 7: Habits

- One change per commit, with a message that says why.
- Run `npm test` before you push.
- Do not start in `src/ui/assembly.js`. It is over a thousand lines; start in `src/core/` and the tests.
- When you do not understand a line, copy it to an AI and ask "what does this line do, and why would it be written this way?" Then check the answer against the code, not the other way round.
- Keep a short notes file of patterns you have learned. After a month, you will find you are typing most of them without help.
