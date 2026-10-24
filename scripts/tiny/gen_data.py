#!/usr/bin/env python3
"""Synthetic training data for the CircuitBench tiny model.
Each example: (request, state, program) where program is Bench-language (see src/core/bench-lang.js).
Phrasings are split into TRAIN and HELD-OUT pools so we can measure generalisation to wordings the model never saw."""
import json, random, sys

# ───────── vocabulary of the bench ─────────
TYPES = {  # type → (names people use, can take counts)
  'led': ['led', 'leds', 'light', 'lights', 'lamp', 'diode', 'light emitting diode'],
  'resistor': ['resistor', 'resistors', 'resistance', 'res'],
  'pushbutton': ['button', 'pushbutton', 'push button', 'buttons', 'switch button', 'tact switch'],
  'slide-switch': ['slide switch', 'switch', 'toggle switch', 'slider switch'],
  'potentiometer': ['potentiometer', 'pot', 'knob', 'dial', 'variable resistor', 'trimmer'],
  'ldr-module': ['ldr', 'photoresistor', 'light sensor', 'photo resistor', 'brightness sensor'],
  'ntc-sensor': ['ntc', 'thermistor', 'temperature sensor', 'temp sensor', 'heat sensor'],
  'pir-sensor': ['pir', 'motion sensor', 'pir sensor', 'movement sensor'],
  'mpu6050': ['mpu6050', 'mpu 6050', 'accelerometer', 'gyro', 'gyroscope', 'imu', 'motion tracker'],
  'ssd1306': ['oled', 'oled display', 'ssd1306', 'screen', 'small display'],
  'lcd1602': ['lcd', 'lcd display', 'lcd1602', '16x2 display', 'character display'],
  'dht': ['dht', 'dht22', 'dht11', 'humidity sensor', 'humidity and temperature sensor'],
  'seven-segment': ['7 segment', 'seven segment', '7-segment display', 'digit display'],
  'dc-motor': ['motor', 'dc motor', 'small motor'],
  'l298n': ['l298n', 'motor driver', 'motor controller'],
  'battery': ['battery', '9v battery', 'power cell', 'cell'],
  'rgb-led': ['rgb led', 'rgb', 'colour led', 'color changing led'],
  'breadboard': ['breadboard', 'solderless board'],
  'arduino-nano': ['arduino nano', 'nano'], 'arduino-mega': ['arduino mega', 'mega'],
}
COLORS = ['red', 'green', 'blue', 'yellow', 'orange', 'white']
NUMW = {1: ['a', 'an', 'one', '1'], 2: ['two', '2', 'a couple of', 'a pair of'], 3: ['three', '3'], 4: ['four', '4'], 5: ['five', '5'], 6: ['six', '6']}
OHM = [100, 220, 330, 470, 680, 1000, 2200, 4700, 10000, 22000, 47000, 100000]
DIGI = [str(i) for i in range(2, 14)]; ANA = ['A0', 'A1', 'A2', 'A3']

def ohm_words(v):
    forms = []
    if v >= 1000 and v % 1000 == 0: k = v // 1000; forms += [f'{k}k', f'{k} k', f'{k}k ohm', f'{k} kilo ohm', f'{k} kohm', f'{k}kΩ']
    elif v >= 1000: k = v / 1000; forms += [f'{k:g}k', f'{k:g}k ohm', f'{str(v // 1000)}k{str(v % 1000)[:1]}']
    forms += [f'{v} ohm', f'{v}Ω', f'{v} ohms', f'{v}']
    return forms

# ───────── phrasing pools: first part TRAIN, last part HELD-OUT (never trained on) ─────────
ADD_V = ['add', 'put', 'place', 'insert', 'drop in', 'give me', 'i need', 'i want', 'get me', 'lets add', 'throw in', 'attach', 'bring in', 'can you add', 'please add', 'could you put', 'would you add', 'i would like',
         'stick in', 'whack in', 'pop in', 'include', 'set down', 'fetch me', 'chuck in', 'add in', 'i d like', 'we need', 'lets have', 'plug in', 'hook in', 'drag in', 'show me', 'create', 'make me', 'spawn', 'put in', 'add another', 'one more',
         # held-out ↓ (never trained)
         'stick on', 'pop on', 'slot in', 'plonk', 'bung in', 'summon', 'deposit']
DEL_V = ['remove', 'delete', 'get rid of', 'take away', 'take out', 'scrap', 'erase', 'trash', 'clear', 'dump', 'please remove', 'can you delete',
         'ditch', 'bin', 'yank out', 'wipe out', 'drop', 'lose', 'unplug', 'take off', 'pull out', 'i dont need', 'i dont want', 'cut', 'discard', 'kill',
         'rip out', 'banish', 'junk', 'axe']
SET_V = ['set', 'change', 'make', 'turn', 'adjust', 'update', 'switch', 'can you make', 'please set', 'i want', 'lets make',
         'tweak', 'swap', 'convert', 'alter', 'modify', 'put', 'give', 'configure', 'use', 'lets use', 'edit', 'bump', 'dial',
         'fix', 'reset', 'recalibrate']
SUFFIX = ['', '', '', 'please', 'for me', 'now', 'real quick', 'on the board', 'on the bench', 'onto the breadboard', 'thanks', 'asap', 'if you can',
          'right now', 'to my circuit', 'quickly']
SUFFIX = SUFFIX + ['when you get a chance', 'to the workspace', 'pls', 'ty', 'thank you', 'ok', 'if possible', 'for the project', 'in my circuit', 'there', 'again', 'too']
SUFFIX_HO = ['whenever', 'at your leisure', 'for me please', 'okay thanks', 'in this sketch']
DEFER = ['my led is too dim why', 'how do i wire a button properly', 'what does analogwrite do', 'is this resistor value ok', 'can you review my circuit', 'make a clock', 'make a thermostat', 'build a calculator', 'make the motor speed follow the pot', 'program a countdown timer', 'how many leds can one pin drive', 'what is a breadboard rail', 'why is my led not lighting up', 'why does my circuit not work', 'how does a resistor work', 'what does this code do', 'explain ohms law', 'how do i read a button',
  'is my circuit correct', 'debug my sketch', 'it is not working', 'help me fix this', 'what is pwm', 'how do i use the oled', 'why is pin 9 always high', 'what resistor should i use for an led',
  'make a traffic light', 'build a temperature alarm', 'make a slime mold circuit', 'code a pong game', 'read the ntc and show it on the oled', 'write code that fades an led',
  'make an automatic night light', 'build a line following robot', 'design a burglar alarm', 'create a lock with a keypad', 'make the led fade with the potentiometer', 'show the temperature on the lcd',
  'make a morse code sender', 'how do i make a motor spin both ways', 'what is the difference between an led and a diode', 'can you check my wiring', 'why is the temperature wrong',
  'make a reaction time game', 'drive the motor with the potentiometer', 'whats wrong with my code', 'optimise my sketch', 'explain this sketch', 'teach me about pull up resistors',
  'make a metronome', 'build a voltmeter', 'make a dimmer', 'simulate a heart rate monitor', 'wire up the oled', 'connect the mpu6050 and print roll and pitch']
DEFER_HO = ['i cant get the led to turn on', 'what happens if i remove the resistor', 'how come the light stays off', 'can you tell me how a potentiometer works', 'make a door alarm', 'program a fading effect', 'what is a pull down resistor']
OFF = ['whats the date today', 'who made you', 'tell me about dogs', 'what is the tallest building', 'whos the best footballer', 'make me a sandwich', 'explain photosynthesis', 'say something funny', 'what is the speed of light', 'how old is the earth', 'whats the weather today', 'tell me a joke', 'who is the prime minister', 'write my essay on world war 2', 'what is the capital of france', 'play some music', 'what is 5 plus 7',
  'translate hello to french', 'recommend a movie', 'who won the cricket match', 'write a poem about cats', 'how do i cook pasta', 'tell me about the moon', 'what time is it', 'solve my maths homework',
  'give me a recipe', 'how tall is mount everest', 'hello', 'hi there', 'hey', 'good morning', 'thanks', 'ok', 'who are you', 'what can you do', 'sing a song', 'what is the meaning of life']
OFF_HO = ['whats the news', 'tell me a fun fact', 'how far is the sun', 'draw me a cat', 'what is your name']


# ───────── vague, everyday wording: what people actually type ("i want a light", "make it blink", "something to measure temperature") ─────────
# Each intent: (programs by whether an LED is already on the board, phrasings). The LAST phrasing of each is held out (never trained on).
WANT = ['i want', 'i need', 'i would like', 'get me', 'give me', 'can i have', 'lets have', 'how about', 'could i get', 'put in', 'add', 'make me', 'show me', 'i wanna have', 'we need', 'set me up with']
THING = {  # part type → everyday ways to ask for it without naming it
  'ntc-sensor': ['something that measures temperature', 'a way to measure temperature', 'something to tell how hot it is', 'a temperature thing', 'something to read the temperature', 'a thing that senses heat', 'something to check how warm it is', 'a sensor for temperature', 'a thermometer', 'something that feels hot and cold', 'a thing that knows the temperature'],
  'dht': ['something that measures humidity', 'a way to measure how humid it is', 'a humidity thing', 'something to check the air moisture', 'a sensor for humidity', 'something for humidity and temperature', 'a thing that knows how damp the air is'],
  'pir-sensor': ['something that detects motion', 'a way to know if someone walks by', 'something to detect movement', 'a motion thing', 'something that sees people moving', 'a sensor for movement', 'something to catch someone walking past', 'a thing that notices when somebody moves'],
  'ldr-module': ['something that measures how bright it is', 'a way to tell if its day or night', 'something to detect light', 'a light level thing', 'something that senses brightness', 'a sensor for light', 'a thing that knows when its dark', 'something to check how sunny it is'],
  'mpu6050': ['something that detects tilt', 'a way to know if its shaking', 'something that measures movement and rotation', 'a tilt thing', 'something to sense orientation', 'a thing that feels when its turned', 'something to measure acceleration', 'a sensor for tilting'],
  'lcd1602': ['something to show text', 'a way to show a message', 'a screen for words', 'something to write words on', 'a thing that displays letters', 'a text display', 'something that can print a message', 'a display for sentences'],
  'ssd1306': ['something to show pictures', 'a small screen for graphics', 'a tiny screen', 'something that can draw on a screen', 'a screen for images', 'a graphic display', 'a mini monitor'],
  'seven-segment': ['something to show a number', 'a way to display digits', 'a number display', 'something that counts on a screen', 'a thing to show numbers', 'a counter display', 'something to display a score'],
  'dc-motor': ['something that spins', 'a thing to make wheels turn', 'something that moves', 'a way to make something rotate', 'a spinning thing', 'something to drive a wheel', 'a thing that whirs'],
  'pushbutton': ['something to press', 'a way to switch it on with my finger', 'a thing i can click', 'something to push', 'a way to control it by pressing', 'a clicky thing', 'something i can tap'],
  'potentiometer': ['something to turn up and down', 'a dial', 'a way to adjust it smoothly', 'a volume control', 'something to twist', 'a thing to dim with', 'a smooth control'],
  'battery': ['some power', 'a way to power it', 'a power source', 'something to run it on', 'a thing that gives electricity', 'something to supply power'],
  'rgb-led': ['a light that changes colour', 'a colourful light', 'a light with many colours', 'a multicolour light', 'a lamp that can be any colour', 'a rainbow light'],
  'led': ['a light', 'a bulb', 'a lamp', 'some light', 'a little light', 'something that glows', 'a thing that lights up', 'a small bulb', 'a glowing thing', 'a tiny lamp', 'a shiny thing'],
}
QTY = [(1, ['a', 'one', '']), (2, ['a couple of', 'two', 'a pair of']), (3, ['a few', 'some', 'three', 'a handful of']), (4, ['several', 'four']), (5, ['a bunch of', 'lots of', 'five', 'loads of'])]
BLINK_P = {  # phrasing → ms
  500: ['make it blink', 'blink', 'make the light blink', 'i want it to blink', 'can you make it flash', 'make it go on and off', 'make the light flash', 'turn it on and off', 'make it flicker', 'make the led blink', 'make my led flash', 'make it pulse', 'switch it on and off over and over', 'make it twinkle', 'blink it', 'flash it', 'get it blinking', 'make it flash on and off', 'start blinking', 'i want it flashing'],
  100: ['make it blink faster', 'make it flash quickly', 'speed it up', 'make it faster', 'blink faster', 'flash faster', 'make it go quicker', 'hurry it up', 'much faster please', 'make it blink really quickly'],
  1000: ['make it blink slower', 'slow it down', 'make it slower', 'blink slower', 'make it flash slowly', 'make it go slower', 'blink more slowly', 'make it calmer', 'much slower please', 'make it blink gently'],
}
BLINK_HO = {500: ['get the light going on and off', 'could it strobe'], 100: ['crank up the speed'], 1000: ['ease off the speed']}
BUILD_P = ['make a circuit', 'make something', 'build something', 'set something up', 'get me started', 'make me a circuit', 'do something with the led', 'lets build something', 'i want to try something', 'show me a circuit', 'start a circuit', 'make a simple circuit', 'build me a simple circuit', 'help me start', 'create a circuit for me', 'make an easy circuit', 'i am new, make something simple', 'set up something simple']
BUILD_HO = ['whip up a circuit', 'give me a starter circuit']
COLOR_P = ['make it', 'turn it', 'change it to', 'i want it', 'can it be', 'colour it', 'paint it', 'it should be', 'switch it to', 'lets have it']
COLOR_HO = ['recolour it']
SENSORISH = ['i need a sensor', 'add a sensor', 'get me a sensor', 'i want a sensor', 'put a sensor', 'add something', 'add a thing', 'i need a part', 'give me a part', 'add some stuff', 'i want a component', 'add a component', 'any sensor', 'pick a sensor for me', 'add whatever']

def gen_vague(rng, held, suf):
    def fin(req, state, prog): return {'request': (req + ' ' + suf).strip(), 'state': state, 'program': prog}
    r = rng.random()
    if r < 0.40:                                              # name-free request for a part
        t = rng.choice(list(THING)); k = rng.random()
        n, qw = rng.choice(QTY) if t in ('led', 'pushbutton', 'potentiometer', 'dc-motor') and rng.random() < 0.3 else (1, [''])
        ph = THING[t]; ph = ph[-1:] if held else ph[:-1]
        thing = rng.choice(ph)
        if n > 1: thing = thing.replace('a ', f'{rng.choice(qw)} ', 1).replace('some light', 'some lights') if thing.startswith('a ') else f'{rng.choice(qw)} {thing}'
        _, st = make_state(rng)
        req = f'{rng.choice(WANT)} {thing}'.replace('  ', ' ')
        if rng.random() < 0.3: req = thing if thing.startswith(('something', 'a way', 'a ')) else req
        return fin(req, st, f'add {t}' + (f' x{n}' if n > 1 else ''))
    if r < 0.62:                                              # make it blink / faster / slower
        ms = rng.choices([500, 100, 1000], [55, 25, 20])[0]
        pool = BLINK_HO[ms] if held else BLINK_P[ms]
        has_led = rng.random() < 0.5
        parts, st = make_state(rng, {'led': 1} if has_led else None)
        if not has_led:
            parts2 = [(t, i) for t, i in parts if t != 'led']; st = ' '.join(i for _, i in parts2)
        req = rng.choice(pool)
        if ms == 500 and not has_led:
            if rng.random() < 0.6: req = rng.choice(['i want a light that blinks', 'i want a blinking light', 'a blinking led', 'make a light blink', 'lets make a light blink', 'a flashing light please', 'i want to blink an led', 'blink a light', 'make a led that flashes', 'make something blink'])
            return fin(req, st, 'build led auto; blink auto 500')
        return fin(req, st, f'blink auto {ms}')
    if r < 0.72:                                              # "make a circuit"
        _, st = make_state(rng); return fin(rng.choice(BUILD_HO if held else BUILD_P), st, 'build led auto')
    if r < 0.82:                                              # "make it red" with exactly one LED on the board
        parts, st = make_state(rng, {'led': 1}); n = sum(1 for t, _ in parts if t == 'led')
        c = rng.choice(COLORS)
        if n == 1: return fin(f'{rng.choice(COLOR_HO if held else COLOR_P)} {c}', st, f'set led color={c}')
        return fin(f'make it {c}', st, 'defer')
    if r < 0.92:                                              # truly vague: needs a question back, so hand it to a bigger AI / the chooser
        _, st = make_state(rng); return fin(rng.choice(SENSORISH), st, 'defer')
    _, st = make_state(rng)                                   # cannot do (brightness, power off) → defer
    return fin(rng.choice(['make it brighter', 'make it dimmer', 'turn it off', 'turn it on', 'make it stronger', 'make it louder', 'fix it', 'do it again', 'undo that', 'make it better', 'that is wrong', 'try again']), st, 'defer')

def typo(s, rng):
    w = s.split(' '); out = []
    for t in w:
        if len(t) > 4 and rng.random() < 0.18 and not any(c.isdigit() for c in t):
            i = rng.randrange(1, len(t) - 1); m = rng.choice(['swap', 'drop', 'dup'])
            t = t[:i] + t[i + 1] + t[i] + t[i + 2:] if m == 'swap' else t[:i] + t[i + 1:] if m == 'drop' else t[:i] + t[i] + t[i:]
        out.append(t)
    return ' '.join(out)

def make_state(rng, need=None):
    """A random board: the main board plus some parts. `need` = {type: count} that must exist."""
    parts = [('arduino-uno', 'uno-1')]
    if rng.random() < 0.4: parts.append(('breadboard', 'bb-1'))
    counts = {}
    for t in rng.sample(list(TYPES), rng.randint(0, 4)):
        if t not in ('arduino-nano', 'arduino-mega', 'breadboard'): counts[t] = rng.choice([1, 1, 1, 2, 3])
    for t, n in (need or {}).items(): counts[t] = max(counts.get(t, 0), n)
    for t, n in counts.items():
        for i in range(1, n + 1): parts.append((t, f'{t}-{i}'))
    rng.shuffle(parts)
    return parts, ' '.join(i for _, i in parts)

def tname(t, rng, plural=False):
    names = TYPES[t]
    n = rng.choice(names)
    return n

def gen_one(rng, held):
    ADD = ADD_V[:-7]; DEL = DEL_V[:-4]; SET = SET_V[:-4]
    SUF = SUFFIX + (SUFFIX_HO if held else [])
    if held:  # held-out set only uses the held-out phrasings (plus unseen combinations)
        ADD = ADD_V[-7:]; DEL = DEL_V[-4:]; SET = SET_V[-4:]; SUF = SUFFIX_HO
    kind = rng.choices(['add', 'del', 'set', 'blink', 'build', 'multi', 'defer', 'off', 'vague'], [20, 10, 12, 7, 12, 6, 8, 5, 34])[0]
    suf = rng.choice(SUF)
    if kind == 'vague': return gen_vague(rng, held, suf)
    def finish(req, state, prog): return {'request': (req + ' ' + suf).strip(), 'state': state, 'program': prog}

    if kind == 'add':
        t = rng.choice([x for x in TYPES if x not in ('arduino-nano', 'arduino-mega') or rng.random() < 0.15])
        n = rng.choices([1, 2, 3, 4, 5], [70, 14, 8, 5, 3])[0]
        props, words = [], []
        if t == 'led' and rng.random() < 0.5: c = rng.choice(COLORS); props.append(f'color={c}'); words.append(c)
        if t == 'resistor' and rng.random() < 0.55:
            v = rng.choice(OHM); props.append(f'ohms={v}'); words.append(rng.choice(ohm_words(v)))
        name = tname(t, rng); noun = ' '.join(words + [name]) if t != 'resistor' else ' '.join(words + [name])
        if t == 'resistor' and words and rng.random() < 0.5: noun = f'{name} of {words[0]}'
        det = rng.choice(NUMW[n]) if n > 1 or rng.random() < 0.8 else ''
        if n == 1 and det in ('1',): det = 'a'
        if n > 1 and name.endswith(('r', 'd', 'n', 'e', 'o', 'y', 'm')) and not name.endswith('s'): noun = noun + 's' if not noun.endswith('s') else noun
        prog = f'add {t}' + (f' x{n}' if n > 1 else '') + ''.join(' ' + p for p in props)
        if not held and rng.random() < 0.08: return finish(f"{det} {noun}".replace('  ', ' ').strip(), make_state(rng)[1], prog)
        if not held and rng.random() < 0.05: return finish(f'another {name}', make_state(rng)[1], f'add {t}')
        _, st = make_state(rng)
        req = f'{rng.choice(ADD)} {det} {noun}'.replace('  ', ' ')
        return finish(req, st, prog)

    if kind == 'del':
        t = rng.choice([x for x in TYPES if x not in ('arduino-nano', 'arduino-mega', 'breadboard')])
        n = rng.choices([1, 2, 3], [50, 30, 20])[0]
        parts, st = make_state(rng, {t: n})
        have = sorted((i for ty, i in parts if ty == t), key=lambda i: int(i.rsplit('-', 1)[1]))
        name = tname(t, rng)
        if len(have) == 1: req, prog = f'{rng.choice(DEL)} the {name}', f'del {t}'
        else:
            r = rng.random()
            if r < 0.4: req, prog = f'{rng.choice(DEL)} all {name}s'.replace('ss', 's'), f'del {t} all'
            elif r < 0.7:
                k = rng.randrange(len(have)); ordw = ['first', 'second', 'third'][k] if k < 3 else str(k + 1)
                req, prog = f'{rng.choice(DEL)} the {ordw} {name}', f'del {have[k]}'
            elif r < 0.85:
                k = rng.randrange(len(have)); req, prog = f'{rng.choice(DEL)} {have[k]}', f'del {have[k]}'
            else: req, prog = f'{rng.choice(DEL)} the {name}', 'defer'
        return finish(req, st, prog)

    if kind == 'set':
        t = rng.choice(['resistor', 'led', 'battery', 'ntc-sensor', 'dht'])
        n = rng.choices([1, 2], [75, 25])[0]; parts, st = make_state(rng, {t: n}); have = sorted((i for ty, i in parts if ty == t), key=lambda i: int(i.rsplit('-', 1)[1]))
        name = tname(t, rng)
        if t == 'resistor': v = rng.choice(OHM); key, val, vw = 'ohms', v, rng.choice(ohm_words(v))
        elif t == 'led': c = rng.choice(COLORS); key, val, vw = 'color', c, c
        elif t == 'battery': v = rng.choice([3, 5, 6, 9, 12]); key, val, vw = 'volts', v, rng.choice([f'{v}v', f'{v} volts', f'{v}V'])
        else: v = rng.choice([-10, 0, 15, 20, 25, 30, 40, 60]); key, val, vw = 'temp', v, rng.choice([f'{v} degrees', f'{v}c', f'{v} c', f'{v}°C'])
        target, tail = (f'the {name}', 'all') if len(have) > 1 and rng.random() < 0.4 else (None, '')
        if len(have) > 1:
            if target:  # "set all resistors to 1k"
                req = f'{rng.choice(SET)} all {name}s'.replace('ss', 's') + f' to {vw}' ; prog = f'set {t} {key}={val} all'
            else:
                k = rng.randrange(len(have)); req = f'{rng.choice(SET)} {have[k]} to {vw}'; prog = f'set {have[k]} {key}={val}'
        else:
            form = rng.random()
            req = f'{rng.choice(SET)} the {name} to {vw}' if form < 0.6 else f'{rng.choice(SET)} the {name} {vw}' if form < 0.8 else f'the {name} should be {vw}'
            prog = f'set {t} {key}={val}'
        return finish(req, st, prog)

    if kind == 'blink':
        pin = rng.choice(DIGI)
        ms, words = rng.choice([(500, ['half a second', '500 ms', '0.5 seconds', 'every half second', '500ms']), (1000, ['1 second', 'every second', '1 sec', 'once a second', '1000 ms']),
                                (250, ['250 ms', 'quarter of a second', '250ms']), (100, ['100 ms', 'fast', 'really fast']), (2000, ['2 seconds', 'every 2 seconds', '2 sec']), (1500, ['1.5 seconds', '1500 ms'])])
        w = rng.choice(words); w = w if w.startswith('every') else f'every {w}' if not w in ('fast', 'really fast') else w
        _, st = make_state(rng)
        if w == 'fast' or w == 'really fast': ms = 100
        req = rng.choice([f'blink pin {pin} {w}', f'make pin {pin} blink {w}', f'blink the led on pin {pin} {w}', f'flash the led on {pin} {w}', f'toggle pin {pin} {w}', f'make the led on pin {pin} flash {w}', f'blink an led on {pin}', f'make pin {pin} blink'])
        if not any(x in req for x in ['every', 'fast']): ms = 500
        return finish(req, st, f'blink {pin} {ms}')

    if kind == 'build':
        what = rng.choice(['led', 'led', 'button', 'pot'])
        _, st = make_state(rng)
        if rng.random() < 0.5:      # no pin named: the bench picks a free one (and can blink it)
            if what == 'led':
                if rng.random() < 0.4:
                    ms, w = rng.choice([(500, ''), (500, ' every half second'), (1000, ' every second'), (250, ' every 250 ms'), (2000, ' every 2 seconds')])
                    req = rng.choice(['add an led and make it blink', 'make an led blink', 'build a blinking led circuit', 'set up a blinking led', 'add a led and make it flash', 'make a circuit with a blinking led', 'wire up an led and blink it']) + w
                    return finish(req, st, f'build led auto; blink auto {ms}')
                req = rng.choice(['add an led and make a circuit', 'add a led and make a circuit', 'add an led and wire it up', 'make an led circuit', 'make a circuit with an led', 'set up an led', 'wire up an led', 'add an led and connect it', 'add a working led', 'build an led circuit', 'add an led with a resistor and wire it', 'make me a circuit with a led', 'put an led on the board and wire it up', 'add a led and make a circuit please', 'create an led circuit'])
                return finish(req, st, 'build led auto')
            if what == 'button':
                req = rng.choice(['add a button and make a circuit', 'add a button and wire it up', 'make a button circuit', 'set up a button', 'wire up a button', 'add a pushbutton and connect it', 'add a working button', 'build a button circuit'])
                return finish(req, st, 'build button auto')
            req = rng.choice(['add a potentiometer and make a circuit', 'add a pot and wire it up', 'make a potentiometer circuit', 'set up a pot', 'wire up a knob', 'add a potentiometer and connect it', 'add a working pot', 'build a pot circuit'])
            return finish(req, st, 'build pot auto')
        if what == 'led':
            pin = rng.choice(DIGI)
            req = rng.choice([f'wire up an led on pin {pin}', f'hook up an led to pin {pin}', f'build an led circuit on pin {pin}', f'connect an led to pin {pin} with a resistor', f'set up an led on {pin}', f'put an led on pin {pin} with its resistor and wire it', f'make an led circuit on {pin}'])
            return finish(req, st, f'build led {pin}')
        if what == 'button':
            pin = rng.choice(DIGI)
            req = rng.choice([f'wire up a button on pin {pin}', f'connect a button to pin {pin}', f'set up a pushbutton on {pin}', f'hook a button to pin {pin} and read it', f'add a button wired to pin {pin}', f'build a button circuit on pin {pin}'])
            return finish(req, st, f'build button {pin}')
        pin = rng.choice(ANA)
        req = rng.choice([f'wire up a potentiometer on {pin}', f'connect a pot to {pin}', f'set up a knob on {pin} and read it', f'hook a potentiometer to {pin}', f'add a pot wired to {pin}', f'build a potentiometer circuit on {pin}'])
        return finish(req, st, f'build pot {pin}')

    if kind == 'multi':
        a, b = gen_one(rng, held), gen_one(rng, held)
        for x in (a, b):
            if x['program'] in ('defer', 'off') or x['program'].startswith('del') and ' all' not in x['program'] and 'led-' not in x['program'] and 'resistor-' not in x['program'] and x['program'].count('-') == 0: pass
        if any(x['program'] in ('defer', 'off') for x in (a, b)) or a['state'] != b['state'] and rng.random() < 0.0: return gen_one(rng, held)
        if any(x['program'].startswith(('del', 'set')) for x in (a, b)): return gen_one(rng, held)     # keep multi-step to additions/blinks: ids may change between steps
        joiner = rng.choice([' and ', ' and also ', ' then ', ', ', ' plus '])
        ra = a['request'].rstrip(); rb = b['request'].lstrip()
        return {'request': ra + joiner + rb, 'state': a['state'], 'program': a['program'] + '; ' + b['program']}

    if kind == 'defer': return {'request': rng.choice(DEFER_HO if held else DEFER), 'state': make_state(rng)[1], 'program': 'defer'}
    return {'request': rng.choice(OFF_HO if held else OFF), 'state': make_state(rng)[1], 'program': 'off'}

OUT = sys.argv[4] if len(sys.argv) > 4 else '/tmp/tiny'

def main():
    n_train, n_val, n_held = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
    rng = random.Random(7)
    def norm(ex, aug):
        r = ex['request'].lower()
        r = r.replace('  ', ' ').strip()
        if aug and rng.random() < 0.35: r = typo(r, rng)
        if aug and rng.random() < 0.15: r = r.replace(' the ', ' ').replace(' a ', ' ')
        return {'request': r, 'state': ex['state'], 'program': ex['program']}
    train = [norm(gen_one(rng, False), True) for _ in range(n_train)]
    val = [norm(gen_one(rng, False), False) for _ in range(n_val)]
    held = [norm(gen_one(rng, True), False) for _ in range(n_held)]
    seen = {(x['request'], x['state']) for x in train}
    held = [x for x in held if (x['request'], x['state']) not in seen]
    for name, d in (('train', train), ('val', val), ('heldout', held)):
        with open(f'{OUT}/{name}.jsonl', 'w') as f:
            for x in d: f.write(json.dumps(x) + '\n')
    print({k: len(v) for k, v in (('train', train), ('val', val), ('heldout', held))})

if __name__ == '__main__': main()
