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
  # robotics / fixed wing (the circuit workspace's Plane parts): their ids on the board carry the template prefix
  'servo': ['servo', 'servo motor', 'sg90', 'micro servo', 'elevon servo', 'hobby servo', 'control surface servo', 'mg90'],
  'plane-fc': ['flight controller', 'fc', 'plane flight controller', 'fixed wing flight controller', 'wing flight controller', 'autopilot', 'flight computer', 'flight control board'],
  'plane-esc': ['esc', 'speed controller', 'electronic speed controller', 'plane esc', 'motor esc', 'brushless esc', 'brushless speed controller'],
  'plane-motor': ['brushless motor', 'edf', 'ducted fan', 'edf motor', 'outrunner', 'plane motor', 'fan motor', 'brushless outrunner', 'edf fan', 'bldc motor'],
  'drone-battery': ['lipo', 'lipo battery', 'flight battery', 'drone battery', 'lipo pack', 'lipo cell pack', 'rc battery'],
  'drone-rx': ['receiver', 'rx', 'radio receiver', 'elrs receiver', 'crsf receiver', 'rc receiver', 'radio rx'],
}
SID = {'plane-fc': 'custom-plane-fc', 'plane-esc': 'custom-plane-esc', 'plane-motor': 'custom-plane-motor', 'drone-battery': 'custom-drone-battery', 'drone-rx': 'custom-drone-rx'}   # how the board names them
sid = lambda t: SID.get(t, t)
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
         'load up', 'toss in', 'tack on', 'slap in', 'fit', 'mount', 'whip in', 'bring over', 'could i have', 'gimme', 'i could use', 'we want', 'add one more',
         # held-out ↓ (never trained)
         'stick on', 'pop on', 'slot in', 'plonk', 'bung in', 'summon', 'deposit']
DEL_V = ['remove', 'delete', 'get rid of', 'take away', 'take out', 'scrap', 'erase', 'trash', 'clear', 'dump', 'please remove', 'can you delete',
         'ditch', 'bin', 'yank out', 'wipe out', 'drop', 'lose', 'unplug', 'take off', 'pull out', 'i dont need', 'i dont want', 'cut', 'discard', 'kill',
         'nuke', 'zap', 'knock out', 'eject', 'strip out', 'we dont need', 'no more', 'i do not want',
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
    return fin(rng.choice(['make it brighter', 'make it dimmer', 'turn it off', 'turn it on', 'make it stronger', 'make it louder', 'fix it', 'do it again', 'make it better', 'that is wrong', 'try again']), st, 'defer')

# ───────── robotics / fixed-wing requests, batteries with specs, wipe-out requests and 3D requests the circuit model must not guess at ─────────
PLANE_EDF = ['build a flying wing with an edf', 'wire up an edf plane', 'set up the electronics for an edf jet', 'make a flying wing circuit', 'i want a plane with an edf', 'build me an edf plane circuit',
             'wire a ducted fan plane', 'make the edf wiring', 'set up my flying wing', 'wire up the edf and the esc and the flight controller', 'build the plane circuit with an edf', 'make me a flying wing',
             'wire up a 50mm edf plane', 'plane circuit with an edf please', 'edf jet electronics', 'hook up the edf plane']
PLANE_PROP = ['build a plane with a propeller', 'wire up a propeller plane', 'set up the electronics for a fixed wing', 'make a fixed wing circuit', 'i want a plane with a prop', 'build me a plane circuit',
              'wire up a pusher plane', 'make the plane wiring', 'set up my fixed wing', 'build the plane circuit', 'wire up an rc plane', 'make me an rc plane circuit', 'wire up the plane',
              'plane electronics please', 'build a plane', 'set up a plane with a brushless motor and a prop']
PLANE_HO = {'edf': ['whip up an edf plane', 'rig up a ducted fan jet'], 'prop': ['rig up a propeller plane', 'whip up a fixed wing circuit']}
SPEC_FORMS = ['{c}s {m}mah {k}c battery', '{m}mah {c}s battery', '{c}s {m} mah lipo', '{c}s lipo', '{k}c {m}mah {c}s power battery with xt60 connector', '{m}mah {k}c {c}s battery', 'a {c}s battery',
              '{c}s {m}mah battery', '{c}s {k}c battery', '{m}mah lipo', 'lipo {c}s {m}mah', '{c}s flight battery', 'flight battery {m}mah', '{m} mah {c}s {k}c lipo pack', 'xt60 battery {c}s', '{k}c lipo battery', '{c}s battery pack {m}mah']
WIPE = ['remove everything', 'clear the board', 'delete everything', 'delete all of it', 'start over', 'wipe the bench', 'clear everything', 'get rid of everything', 'empty the workspace', 'reset everything', 'remove all the parts',
        'delete all parts', 'clear all', 'trash it all', 'scrap everything', 'nuke everything', 'wipe it all', 'clean the bench', 'remove all of it']
WIPE_HO = ['purge the bench', 'blank the board', 'flatten everything']
R_DEFER = ['make it fly', 'test fly it', 'add wings', 'add an antenna', 'add a wing', 'print the airframe', 'import my stl', 'what pinout does my flight controller have', 'why wont my edf spin', 'check my plane wiring',
           'set the servo to 90 degrees', 'make the servo sweep', 'add a fuselage', 'add a tail', 'how much thrust does a 50mm edf make', 'will my 3s battery power the edf', 'which esc should i buy',
           'bind my receiver', 'calibrate the esc', 'how do i wire elevons', 'set up failsafe', 'flash betaflight', 'add a camera', 'add gps', 'add a propeller', 'add the airframe', 'put the motors on the frame',
           'add props', 'join the two holes', 'move the battery 10 mm left', 'rotate the motor 90 degrees', 'put the flight controller on the standoffs', 'drop the battery on the floor', 'attach the antenna to the receiver',
           'place the edf inside the wing', 'make the battery bigger', 'measure the gap', 'fit the battery inside', 'screw the fc to the frame', 'unjoin the servo', 'set the joint limits', 'hold the frame still']
R_DEFER_HO = ['sort out the airframe', 'make it take off', 'stick the antenna on', 'slide the battery forward']

def gen_robo(rng, held, suf):
    def fin(req, state, prog): return {'request': (req + ' ' + suf).strip(), 'state': state, 'program': prog}
    k = rng.random(); _, st = make_state(rng)
    if k < 0.30:                                    # a battery described with its specs: one LiPo part, the numbers are not a count
        c, m, kk = rng.choice([1, 2, 3, 4, 5, 6]), rng.choice([450, 650, 850, 1000, 1300, 1500, 1800, 2200, 2600, 3000, 3300, 4000, 5000, 6000]), rng.choice([20, 25, 30, 45, 50, 60, 75, 100, 120, 150])
        desc = rng.choice(SPEC_FORMS).format(c=c, m=m, k=kk)
        v = rng.choice(['add', 'make', 'i need', 'get me', 'i want', 'put', 'give me', 'create', 'can you add', 'please add', 'i want to add', 'add in', 'lets add', 'need', ''])
        det = rng.choice(['a', 'an', 'one', '']) if not desc.startswith(('a ', 'xt')) else ''
        return fin(f'{v} {det} {desc}'.replace('  ', ' ').strip(), st, 'add drone-battery')
    if k < 0.50:                                    # the whole plane
        if held:
            how = rng.choice(['edf', 'prop']); return fin(rng.choice(PLANE_HO[how]), st, f'build plane {how}')
        if rng.random() < 0.5: return fin(rng.choice(PLANE_EDF), st, 'build plane edf')
        return fin(rng.choice(PLANE_PROP), st, 'build plane prop')
    if k < 0.65: return fin(rng.choice(WIPE_HO if held else WIPE), st, 'defer')
    return fin(rng.choice(R_DEFER_HO if held else R_DEFER), st, 'defer')


# ───────── app functions: run / zoom / tabs / export / projects … (core/app-ops.js), part moves, unwiring and ready-made sketches ─────────
# Each name: (train phrasings, held-out phrasings). The held-out ones are never trained on.
APP = {
 'run': (['run it', 'run the simulation', 'start the simulation', 'press run', 'hit run', 'start it', 'play it', 'simulate it', 'run my circuit', 'start simulating', 'run the circuit', 'fire it up', 'test it', 'try it out', 'let it run', 'begin the simulation', 'run the sim', 'run the sketch', 'start the sim', 'go ahead and run it', 'can you run it', 'i want to see it run', 'run this'], ['kick off the simulation', 'set it going']),
 'stop': (['stop it', 'stop the simulation', 'halt it', 'stop running', 'end the simulation', 'press stop', 'stop the sim', 'cut the simulation', 'stop simulating', 'kill the simulation', 'stop the circuit', 'i want to stop it', 'stop the run'], ['bring it to a halt', 'shut the simulation down']),
 'pause': (['pause it', 'pause the simulation', 'freeze it', 'hold the simulation', 'pause the sim', 'press pause', 'freeze the simulation', 'pause for a second', 'pause the circuit'], ['put the simulation on hold']),
 'sound': (['mute it', 'unmute it', 'turn the sound off', 'turn the sound on', 'toggle the sound', 'mute the buzzer', 'sound on or off', 'switch the sound', 'mute the speaker'], ['silence it']),
 'undo': (['undo', 'undo that', 'undo the last change', 'go back one step', 'revert that', 'take that back', 'undo my last edit', 'undo it', 'reverse that change', 'undo the last edit', 'oops undo'], ['roll that back', 'backtrack one step']),
 'redo': (['redo', 'redo that', 'redo it', 'redo the last change', 'redo my edit', 'step forward again', 'redo the undo', 'oops redo'], ['redo the undone change']),
 'zoomin': (['zoom in', 'zoom in a bit', 'make the view bigger', 'get closer', 'zoom in please', 'magnify', 'closer view', 'enlarge the view', 'zoom closer', 'bring the view in', 'zoom in on the board'], ['move in closer']),
 'zoomout': (['zoom out', 'zoom out a bit', 'make the view smaller', 'pull back', 'see more of the board', 'zoom way out', 'shrink the view', 'widen the view', 'zoom out please', 'show more of the workspace'], ['back the view off']),
 'fit': (['fit everything', 'fit to screen', 'show everything', 'fit the view', 'zoom to fit', 'show the whole circuit', 'center everything', 'see the whole board', 'fit it all on screen', 'reset the zoom', 'fit all the parts'], ['frame it all']),
 'select': (['select tool', 'switch to select', 'use the select tool', 'pointer tool', 'cursor tool', 'let me move things', 'move mode', 'switch to the pointer'], ['arrow tool']),
 'wiretool': (['wire tool', 'draw a wire', 'let me draw wires', 'switch to the wire tool', 'wiring mode', 'start wiring', 'use the wire tool', 'i want to draw wires', 'pick the wire tool'], ['enable wiring mode']),
 'rotatesel': (['rotate it', 'rotate this', 'rotate the selection', 'turn the selected part', 'rotate the selected part', 'rotate what i selected', 'turn it around'], ['spin the selected one']),
 'duplicate': (['duplicate it', 'duplicate this', 'duplicate the selected part', 'copy and paste it', 'make a copy of it', 'clone it', 'clone the selected part', 'duplicate the selection'], ['twin it']),
 'code': (['show the code', 'open the sketch', 'show the sketch editor', 'hide the code', 'hide the sketch', 'open the editor', 'show me the code', 'close the code editor', 'toggle the code', 'show the arduino code', 'open the code panel', 'show the sketch'], ['reveal the sketch']),
 'blocks': (['switch to blocks', 'use blocks', 'block mode', 'blocks editor', 'program with blocks', 'show blocks', 'i want blocks instead', 'drag and drop coding', 'switch to block coding'], ['blocky programming']),
 'text': (['switch to code', 'text mode', 'use the code editor', 'write code instead', 'show the text editor', 'code mode', 'switch to text', 'i want to type code', 'typed code mode'], ['go to text code']),
 'compile': (['compile it', 'compile the sketch', 'verify the code', 'check the code compiles', 'build the sketch', 'verify the sketch', 'compile my code', 'check my sketch for errors', 'verify it', 'press verify'], ['run the compiler']),
 'output': (['show the output', 'open the output tab', 'output tab', 'show output', 'go to output', 'switch to the output'], ['bring up the output']),
 'serial': (['show the serial monitor', 'open the serial monitor', 'serial monitor', 'show serial', 'open serial', 'show the serial output', 'open the serial tab', 'see the serial', 'i want to see the serial prints'], ['bring up the serial monitor']),
 'clearserial': (['clear the serial monitor', 'clear serial', 'wipe the serial monitor', 'empty the serial monitor', 'clear the monitor', 'clear the serial output'], ['blank the serial monitor']),
 'newproject': (['new project', 'start a new project', 'create a new project', 'make a new project', 'open a blank project', 'fresh project', 'start fresh in a new project', 'i want a new project', 'new blank project'], ['spin up a new project']),
 'projects': (['show my projects', 'open my projects', 'switch project', 'list my projects', 'my projects', 'open projects', 'change project', 'go to my projects', 'switch to another project'], ['pull up my projects']),
 'gallery': (['show shared projects', 'open the project gallery', 'see what others made', 'community projects', 'browse shared projects', 'look at other peoples projects', 'open the gallery', 'show me projects from other people'], ['see what others built']),
 'export': (['export my project', 'download my project', 'save the project as a file', 'export it', 'export the circuit', 'save my project to a file', 'download the circuit file', 'give me the project file', 'export the project'], ['dump the project to a file']),
 'copy': (['copy the project json', 'copy my project as json', 'copy json', 'copy the circuit json', 'copy the project to the clipboard', 'copy the project'], ['grab the project json']),
 'import': (['import a project', 'import a file', 'import a pcb', 'load a project file', 'upload a project', 'bring in a project file', 'import json', 'open a project file', 'import my kicad board', 'import a kicad pcb'], ['load a saved project']),
 'packs': (['open resource packs', 'show the packs', 'more parts', 'get more boards', 'add more parts packs', 'open the parts packs', 'install a pack', 'resource packs', 'show me the parts packs', 'browse packs', 'i want more boards'], ['find more parts packs']),
 'community': (['open the community', 'show the blog', 'open the community page', 'show updates', 'see the discussions', 'whats new in circuitbench', 'open the circuitbench blog'], ['check the community']),
 'feedback': (['send feedback', 'report a bug', 'tell the team something broke', 'open the feedback form', 'i want to give feedback', 'report a problem', 'suggest a feature', 'feedback', 'report an issue'], ['let the team know about a bug']),
 'settings': (['open settings', 'show settings', 'change the settings', 'open the settings menu', 'go to settings', 'settings', 'change the theme', 'add an api key', 'open the api key settings'], ['bring up the settings']),
 'partmaker': (['open the part maker', 'create a custom part', 'i want to make my own part', 'design a part', 'create a part', 'new custom part', 'part maker', 'build my own component', 'make my own part', 'make a custom part'], ['craft my own part']),
 'robots': (['change the robot type', 'pick a robot type', 'choose the robot type', 'open the robot picker', 'switch the robot type', 'set the robot type', 'robot type', 'pick a robot'], ['select a robot kind']),
}
APP_DEFER = ['how do i run the simulation', 'why wont it run', 'what does the compile button do', 'where is the serial monitor', 'how do i export my project', 'what does undo do', 'run it at double speed', 'run it for ten minutes',
  'export as a pdf', 'export it to kicad', 'share my project with a friend', 'publish my project', 'why is the simulation slow', 'how do i zoom', 'what is the wire tool for', 'how do i import a pcb',
  'what is a resource pack', 'can you run the code on a real arduino', 'upload the sketch to my arduino', 'save it to google drive', 'print the circuit', 'email me the project', 'delete my account', 'sign me out',
  'why did the compile fail', 'what is in the serial monitor', 'what is the part maker', 'is the simulation accurate', 'run it on my phone', 'record a video of the simulation']
APP_DEFER_HO = ['how come it will not simulate', 'whats the export button for', 'send my project to a teacher', 'turn the simulation into a video']
STEP_PHRASES = {'left': ['left', 'to the left', 'leftwards', 'a bit left'], 'right': ['right', 'to the right', 'rightwards', 'a bit right'], 'up': ['up', 'upwards', 'higher up', 'a bit up'], 'down': ['down', 'downwards', 'lower down', 'a bit down']}
PART_FOR_MOVE = ['led', 'resistor', 'pushbutton', 'potentiometer', 'ssd1306', 'lcd1602', 'dht', 'servo', 'battery', 'dc-motor']

def gen_app(rng, held, suf):
    def fin(req, state, prog): return {'request': (req + ' ' + suf).strip(), 'state': state, 'program': prog}
    _, st = make_state(rng)
    k = rng.random()
    if k < 0.74:                                    # one app button
        name = rng.choice(list(APP)); tr, ho = APP[name]
        return fin(rng.choice(ho if held else tr), st, f'app {name}')
    if k < 0.80: return fin(rng.choice(APP_DEFER_HO if held else APP_DEFER), st, 'defer')
    if k < 0.90:                                    # move / rotate / unwire a named part
        what = rng.choice(['move', 'move', 'rotate', 'rotate', 'unwire', 'unwire'])
        t = rng.choice(PART_FOR_MOVE if what != 'unwire' else PART_FOR_MOVE + ['plane-fc', 'plane-esc'])
        n = rng.choices([1, 2], [70, 30])[0]
        parts, st = make_state(rng, {t: n}); have = sorted((i for ty, i in parts if ty == t), key=lambda i: int(i.rsplit('-', 1)[1]))
        name = tname(t, rng)
        if len(have) == 1: ref, who = t, f'the {name}'
        else:
            j = rng.randrange(len(have)); ref = have[j]; who = rng.choice([f'the {["first", "second", "third"][j] if j < 3 else str(j + 1)} {name}', have[j]])
        if what == 'move':
            d = rng.choice(['left', 'right', 'up', 'down']); cnt = rng.choices([1, 2, 3], [70, 18, 12])[0]
            verb = rng.choice(['move', 'shift', 'nudge', 'push', 'slide'] + (['budge', 'scoot'] if held else []))
            if cnt == 1: return fin(f'{verb} {who} {rng.choice(STEP_PHRASES[d])}', st, f'move {ref} {d}')
            return fin(f'{verb} {who} {d} {cnt} steps', st, f'move {ref} {d} {cnt}')
        if what == 'rotate':
            deg = rng.choice([90, 90, 180, 270]); verb = rng.choice(['rotate', 'turn', 'spin'] + (['pivot'] if held else []))
            if deg == 90 and rng.random() < 0.5: return fin(f'{verb} {who}', st, f'rotate {ref}')
            form = rng.choice([f'{verb} {who} {deg} degrees', f'{verb} {who} by {deg}'])
            if deg == 180 and rng.random() < 0.4: form = rng.choice([f'flip {who} around', f'turn {who} around', f'flip {who} upside down'])
            return fin(form, st, f'rotate {ref}' if (deg == 90 and 'flip' not in form) else f'rotate {ref} {deg}')
        verb = rng.choice(['unwire', 'disconnect', 'detach the wires from', 'cut the wires on', 'remove the wires from', 'take the wires off'] + (['sever the wires on'] if held else []))
        return fin(f'{verb} {who}', st, f'unwire {ref}')
    if k < 0.94:
        verb = rng.choice(['remove all wires', 'delete every wire', 'disconnect everything', 'unwire everything', 'clear all the wires', 'take all the wires off', 'cut every wire'] + (['strip every wire'] if held else []))
        return fin(verb, st, 'unwire all')
    pin = rng.choice(['3', '5', '6', '9', '10', '11']); anyp = rng.choice(DIGI)             # ready-made sketches
    kind = rng.choice(['fade', 'fade', 'sweep', 'tone', 'hello', 'empty'])
    if kind == 'fade':
        w = rng.choice(['fade the led on pin {p}', 'make the led on pin {p} fade', 'write a fading sketch for pin {p}', 'make the led on {p} fade in and out', 'pulse the led on pin {p} smoothly', 'breathe the led on pin {p}'] + (['dim the led up and down on pin {p}'] if held else []))
        if rng.random() < 0.2:
            bad = rng.choice(['2', '4', '7', '8', '12', '13']); return fin(w.format(p=bad), st, 'defer')      # not a PWM pin: it cannot fade
        return fin(w.format(p=pin), st, f'sketch fade {pin}')
    if kind == 'sweep':
        w = rng.choice(['sweep the servo on pin {p}', 'make the servo on {p} sweep back and forth', 'write a servo sweep sketch for pin {p}', 'swing the servo on pin {p} from 0 to 180', 'make the servo on pin {p} wave'] + (['rock the servo on pin {p} to and fro'] if held else []))
        return fin(w.format(p=anyp), st, f'sketch sweep {anyp}')
    if kind == 'tone':
        w = rng.choice(['play a beep on pin {p}', 'make the buzzer on pin {p} beep', 'write a buzzer sketch for pin {p}', 'make a rising tone on pin {p}', 'play some tones on pin {p}'] + (['sound the buzzer on pin {p}'] if held else []))
        return fin(w.format(p=anyp), st, f'sketch tone {anyp}')
    if kind == 'hello':
        w = rng.choice(['print hello to the serial monitor', 'write a hello world sketch for serial', 'say hello over serial', 'print a message to serial every second', 'make the arduino say hello on the serial monitor'] + (['output a greeting over serial'] if held else []))
        return fin(w, st, 'sketch hello')
    w = rng.choice(['empty the sketch', 'clear the code', 'blank sketch', 'start with an empty sketch', 'erase my code', 'wipe the sketch', 'reset the sketch to empty'] + (['blank out my code'] if held else []))
    return fin(w, st, 'sketch empty')

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
    # the main board: mostly an Uno, but also other boards, or none at all (a plane project has no Arduino, the flight controller is the board)
    r0 = rng.random()
    parts = [('arduino-uno', 'uno-1')] if r0 < 0.62 else [('arduino-nano', 'nano-1')] if r0 < 0.70 else [('arduino-mega', 'mega-1')] if r0 < 0.75 else [('raspberry-pi-pico', 'pico-1')] if r0 < 0.82 else [('arduino-uno-r4', 'unor4-1')] if r0 < 0.85 else []
    if rng.random() < 0.4 and parts: parts.append(('breadboard', 'bb-1'))
    counts = {}
    for t in rng.sample(list(TYPES), rng.randint(0, 4)):
        if t not in ('arduino-nano', 'arduino-mega', 'breadboard'): counts[t] = rng.choice([1, 1, 1, 2, 3])
    for t, n in (need or {}).items(): counts[t] = max(counts.get(t, 0), n)
    for t, n in counts.items():
        for i in range(1, n + 1): parts.append((t, f'{sid(t)}-{i}'))
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
    kind = rng.choices(['add', 'del', 'set', 'blink', 'build', 'multi', 'defer', 'off', 'vague', 'robo', 'app'], [24, 12, 12, 7, 12, 8, 8, 5, 30, 20, 44])[0]
    suf = rng.choice(SUF)
    if kind == 'vague': return gen_vague(rng, held, suf)
    if kind == 'robo': return gen_robo(rng, held, suf)
    if kind == 'app': return gen_app(rng, held, suf)
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

# ───────── everyday noise, TRAIN ONLY: the way real people pad, hedge and shorten a request. It never changes what is being asked. ─────────
FILL_PRE = ['hey', 'ok', 'okay so', 'um', 'so', 'hmm', 'alright', 'right', 'yo', 'listen', 'hi', 'hey can you', 'i was thinking', 'actually', 'ok now', 'next', 'and now', 'also', 'one thing', 'quick one', 'oh and', 'hold on', 'sorry', 'ok so basically', 'wait', 'now']
FILL_POST = ['thanks', 'thank you', 'please', 'pls', 'ok', 'thx', 'cheers', 'that would be great', 'if thats ok', 'dont worry about the rest', 'thats it', 'for now', 'okay']
SWAPS = [('can you ', ['could you ', 'would you ', 'can u ', 'will you ']), ('i want ', ['i wanna ', 'i d like ', 'i would like ', 'i need ']), ('please ', ['pls ', 'kindly ', '']), (' a ', [' one ', ' a single ', ' an ']),
         ('make it ', ['can you make it ', 'make it so its ', 'lets make it ']), (' the ', [' my ', ' this ', ' that ']), ('lets ', ['let us ', 'we should ', 'how about we ']), ('add ', ['add in ', 'add on ', 'add a new '])]
def noisy(r, rng):
    if rng.random() < 0.30: r = rng.choice(FILL_PRE) + ' ' + r
    if rng.random() < 0.20: r = r + ' ' + rng.choice(FILL_POST)
    if rng.random() < 0.35:
        a, bs = rng.choice(SWAPS)
        if a in f' {r} ': r = (' ' + r + ' ').replace(a, rng.choice(bs), 1).strip()
    if rng.random() < 0.12:
        w = r.split(' '); drop = [i for i, x in enumerate(w) if x in ('the', 'a', 'an', 'to', 'me', 'it', 'my', 'please')]
        if drop and len(w) > 3: w.pop(rng.choice(drop)); r = ' '.join(w)
    if rng.random() < 0.05: r = r.replace(' ', '  ', 1)
    return r.replace('  ', ' ').strip()

OUT = sys.argv[4] if len(sys.argv) > 4 else '/tmp/tiny'

def main():
    n_train, n_val, n_held = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
    rng = random.Random(7)
    def norm(ex, aug):
        r = ex['request'].lower()
        r = r.replace('  ', ' ').strip()
        if aug and rng.random() < 0.55: r = noisy(r, rng)
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
