#!/usr/bin/env python3
"""Training data for the CircuitBench Part Maker model (CPU-only, runs in the browser).
request (what a student types) -> part language:  name|label|kind|pin ids (datasheet order)|k=v numbers
Parts it does not know (or cannot model) -> 'unknown', so the app hands those to a bigger AI.
Usage: gen_part_data.py N_TRAIN N_VAL N_HELD OUT_DIR"""
import json, random, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'tiny'))
from gen_data import typo, noisy    # same everyday noise the bench model uses

HERE = os.path.dirname(__file__)
TEMPL = json.load(open(f'{HERE}/templates.json'))

def num(v):
    s = f'{v:g}' if isinstance(v, float) else str(v)
    return s

def P(kind, name, label, pins, params=None, aka=()):
    return dict(kind=kind, name=name, label=label, pins=pins.split(), params=params or {}, aka=list(aka))

# ───────── real parts, pins in datasheet / silk-screen order (what the student will wire by) ─────────
EXTRA = [
 # BJTs
 P('npn', 'NPN transistor 2N3904', '2N3904', 'E B C', dict(beta=100, imax=200), ['2n3904']),
 P('pnp', 'PNP transistor 2N3906', '2N3906', 'E B C', dict(beta=100, imax=200), ['2n3906']),
 P('npn', 'NPN transistor BC548', 'BC548', 'C B E', dict(beta=300, imax=100), ['bc548']),
 P('pnp', 'PNP transistor BC557', 'BC557', 'C B E', dict(beta=200, imax=100), ['bc557']),
 P('npn', 'NPN transistor BC337', 'BC337', 'C B E', dict(beta=250, imax=800), ['bc337']),
 P('pnp', 'PNP transistor BC327', 'BC327', 'C B E', dict(beta=250, imax=800), ['bc327']),
 P('npn', 'NPN transistor S8050', 'S8050', 'E B C', dict(beta=200, imax=500), ['s8050']),
 P('pnp', 'PNP transistor S8550', 'S8550', 'E B C', dict(beta=200, imax=500), ['s8550']),
 P('npn', 'NPN Darlington TIP120', 'TIP120', 'B C E', dict(beta=1000, imax=5000), ['tip120', 'darlington']),
 P('npn', 'NPN Darlington TIP122', 'TIP122', 'B C E', dict(beta=1000, imax=5000), ['tip122']),
 P('npn', 'NPN power transistor TIP31C', 'TIP31C', 'B C E', dict(beta=50, imax=3000), ['tip31', 'tip31c']),
 P('pnp', 'PNP power transistor TIP32C', 'TIP32C', 'B C E', dict(beta=50, imax=3000), ['tip32', 'tip32c']),
 P('npn', 'NPN transistor 2N2222A', '2N2222A', 'E B C', dict(beta=100, imax=600), ['2n2222a', 'pn2222']),
 # MOSFETs
 P('nmos', 'N-MOSFET 2N7000', '2N7000', 'S G D', dict(vth=2.1, rds=5, imax=200), ['2n7000']),
 P('nmos', 'N-MOSFET BS170', 'BS170', 'D G S', dict(vth=2.1, rds=5, imax=500), ['bs170']),
 P('nmos', 'N-MOSFET IRFZ44N', 'IRFZ44N', 'G D S', dict(vth=3, rds=0.0175, imax=49000), ['irfz44n', 'irfz44']),
 P('nmos', 'N-MOSFET IRL540N', 'IRL540N', 'G D S', dict(vth=1.5, rds=0.044, imax=36000), ['irl540n', 'irl540']),
 P('nmos', 'N-MOSFET IRF520', 'IRF520', 'G D S', dict(vth=3.5, rds=0.27, imax=9200), ['irf520']),
 P('nmos', 'N-MOSFET IRF3205', 'IRF3205', 'G D S', dict(vth=3, rds=0.008, imax=110000), ['irf3205']),
 P('nmos', 'N-MOSFET IRLB8721', 'IRLB8721', 'G D S', dict(vth=1.8, rds=0.0065, imax=62000), ['irlb8721']),
 P('nmos', 'N-MOSFET FQP30N06L', 'FQP30N06L', 'G D S', dict(vth=1.5, rds=0.035, imax=32000), ['fqp30n06l']),
 P('pmos', 'P-MOSFET AO3401', 'AO3401', 'G S D', dict(vth=1, rds=0.05, imax=4000), ['ao3401']),
 P('pmos', 'P-MOSFET IRF4905', 'IRF4905', 'G D S', dict(vth=4, rds=0.02, imax=74000), ['irf4905']),
 # diodes
 P('diode', 'Diode 1N4001', '1N4001', 'A K', dict(vf=0.7, imax=1000), ['1n4001']),
 P('diode', 'Diode 1N4002', '1N4002', 'A K', dict(vf=0.7, imax=1000), ['1n4002']),
 P('diode', 'Diode 1N4004', '1N4004', 'A K', dict(vf=0.7, imax=1000), ['1n4004']),
 P('diode', 'Rectifier diode 1N5408', '1N5408', 'A K', dict(vf=0.8, imax=3000), ['1n5408']),
 P('diode', 'Schottky diode 1N5817', '1N5817', 'A K', dict(vf=0.35, imax=1000), ['1n5817']),
 P('diode', 'Schottky diode 1N5822', '1N5822', 'A K', dict(vf=0.4, imax=3000), ['1n5822']),
 P('diode', 'Schottky diode BAT54', 'BAT54', 'A K', dict(vf=0.3, imax=200), ['bat54']),
 P('diode', 'Fast diode UF4007', 'UF4007', 'A K', dict(vf=1, imax=1000), ['uf4007']),
 # regulators
 P('regulator', 'Voltage regulator 7812', '7812', 'IN GND OUT', dict(vout=12, drop=2, mode='linear', imax=1500), ['7812', 'lm7812', 'l7812']),
 P('regulator', 'Voltage regulator 7809', '7809', 'IN GND OUT', dict(vout=9, drop=2, mode='linear', imax=1500), ['7809', 'lm7809']),
 P('regulator', 'Voltage regulator 7806', '7806', 'IN GND OUT', dict(vout=6, drop=2, mode='linear', imax=1500), ['7806']),
 P('regulator', 'Voltage regulator LM7805', 'LM7805', 'IN GND OUT', dict(vout=5, drop=2, mode='linear', imax=1500), ['lm7805', 'l7805']),
 P('regulator', 'Regulator 78L05', '78L05', 'OUT GND IN', dict(vout=5, drop=2, mode='linear', imax=100), ['78l05']),
 P('regulator', 'Regulator 78L33', '78L33', 'OUT GND IN', dict(vout=3.3, drop=2, mode='linear', imax=100), ['78l33']),
 P('regulator', 'Regulator LM1117-5.0', 'LM1117-5', 'GND OUT IN', dict(vout=5, drop=1.2, mode='linear', imax=800), ['lm1117', 'lm1117-5']),
 P('regulator', 'Regulator MCP1700-3.3', 'MCP1700', 'GND IN OUT', dict(vout=3.3, drop=0.2, mode='linear', imax=250), ['mcp1700']),
 P('regulator', 'Regulator LD1117-3.3', 'LD1117', 'GND OUT IN', dict(vout=3.3, drop=1.1, mode='linear', imax=800), ['ld1117']),
 P('regulator', 'Buck converter LM2596 module', 'LM2596', 'VIN GND VOUT', dict(vout=5, drop=0, mode='switching', imax=3000), ['lm2596', 'step down converter']),
 P('regulator', 'Buck converter MP1584', 'MP1584', 'VIN GND VOUT', dict(vout=5, drop=0, mode='switching', imax=3000), ['mp1584']),
 P('regulator', 'Boost converter MT3608', 'MT3608', 'VIN GND VOUT', dict(vout=12, drop=0, mode='switching', imax=2000), ['mt3608', 'step up converter']),
 # op-amps (the simulator's five-pin op-amp)
 P('opamp', 'Op-amp LM324', 'LM324', 'IN+ IN- OUT V+ V-', {}, ['lm324']),
 P('opamp', 'Op-amp TL071', 'TL071', 'IN+ IN- OUT V+ V-', {}, ['tl071']),
 P('opamp', 'Op-amp NE5532', 'NE5532', 'IN+ IN- OUT V+ V-', {}, ['ne5532']),
 P('opamp', 'Op-amp LM833', 'LM833', 'IN+ IN- OUT V+ V-', {}, ['lm833']),
 P('opamp', 'Op-amp MCP6002', 'MCP6002', 'IN+ IN- OUT V+ V-', {}, ['mcp6002']),
 P('opamp', 'Op-amp LMV358', 'LMV358', 'IN+ IN- OUT V+ V-', {}, ['lmv358']),
 P('opamp', 'Op-amp OPA2134', 'OPA2134', 'IN+ IN- OUT V+ V-', {}, ['opa2134']),
 # instrumentation amps
 P('inamp', 'Instrumentation amp INA126', 'INA126', 'IN+ IN- OUT REF V+ V-', dict(gain=100), ['ina126']),
 P('inamp', 'Instrumentation amp INA114', 'INA114', 'IN+ IN- OUT REF V+ V-', dict(gain=100), ['ina114']),
 P('inamp', 'Instrumentation amp INA333', 'INA333', 'IN+ IN- OUT REF V+ V-', dict(gain=100), ['ina333']),
 P('inamp', 'Instrumentation amp AD620', 'AD620', 'IN+ IN- OUT REF V+ V-', dict(gain=100), ['ad620']),
 P('inamp', 'Instrumentation amp AD8221', 'AD8221', 'IN+ IN- OUT REF V+ V-', dict(gain=100), ['ad8221']),
 P('inamp', 'Instrumentation amp INA826', 'INA826', 'IN+ IN- OUT REF V+ V-', dict(gain=100), ['ina826']),
 P('inamp', 'Instrumentation amp AD623', 'AD623', 'IN+ IN- OUT REF V+ V-', dict(gain=100), ['ad623']),
 # sensors, analog
 P('analog-sensor', 'Temperature sensor LM35', 'LM35', 'VCC OUT GND', {}, ['lm35']),
 P('analog-sensor', 'Temperature sensor TMP36', 'TMP36', 'VCC OUT GND', {}, ['tmp36']),
 P('analog-sensor', 'Heart monitor AD8232', 'AD8232', 'GND VCC OUT LO- LO+ SDN', {}, ['ad8232', 'ecg sensor', 'heart rate monitor']),
 P('analog-sensor', 'Gas sensor MQ-2', 'MQ-2', 'VCC GND DO AO', {}, ['mq2', 'smoke sensor']),
 P('analog-sensor', 'Gas sensor MQ-135', 'MQ-135', 'VCC GND DO AO', {}, ['mq135', 'air quality sensor']),
 P('analog-sensor', 'Gas sensor MQ-7', 'MQ-7', 'VCC GND DO AO', {}, ['mq7', 'carbon monoxide sensor']),
 P('analog-sensor', 'Light sensor module LDR', 'LDR', 'VCC GND DO AO', {}, ['ldr module', 'light sensor module', 'photoresistor module']),
 P('analog-sensor', 'Soil moisture sensor module', 'SOIL', 'VCC GND AO', {}, ['soil moisture module', 'capacitive soil sensor']),
 P('analog-sensor', 'Rain sensor module', 'RAIN', 'VCC GND DO AO', {}, ['rain sensor', 'water sensor']),
 P('analog-sensor', 'Flame sensor module', 'FLAME', 'VCC GND DO AO', {}, ['flame sensor', 'fire sensor']),
 P('analog-sensor', 'Current sensor ACS712', 'ACS712', 'VCC OUT GND', {}, ['acs712', 'current sensor']),
 P('analog-sensor', 'Microphone amplifier MAX4466', 'MAX4466', 'OUT GND VCC', {}, ['max4466', 'microphone module']),
 P('analog-sensor', 'Pulse sensor', 'PULSE', 'S VCC GND', {}, ['pulse sensor', 'heartbeat sensor']),
 P('analog-sensor', 'Analog hall sensor SS49E', 'SS49E', 'VCC GND OUT', {}, ['ss49e', 'linear hall sensor']),
 P('analog-sensor', 'UV sensor GUVA-S12SD', 'GUVA', 'VCC GND OUT', {}, ['guva-s12sd', 'uv sensor']),
 # sensors, digital
 P('digital-sensor', 'PIR motion sensor HC-SR501', 'HC-SR501', 'VCC OUT GND', {}, ['hc-sr501', 'pir', 'motion sensor']),
 P('digital-sensor', 'IR obstacle sensor FC-51', 'FC-51', 'VCC GND OUT', {}, ['fc-51', 'obstacle sensor', 'ir sensor']),
 P('digital-sensor', 'Touch sensor TTP223', 'TTP223', 'VCC OUT GND', {}, ['ttp223', 'touch sensor', 'capacitive touch']),
 P('digital-sensor', 'Hall sensor A3144', 'A3144', 'VCC GND OUT', {}, ['a3144', 'hall effect switch']),
 P('digital-sensor', 'Vibration sensor SW-420', 'SW-420', 'VCC GND OUT', {}, ['sw-420', 'vibration sensor', 'shock sensor']),
 P('digital-sensor', 'Tilt sensor SW-520D', 'SW-520D', 'VCC GND OUT', {}, ['sw-520d', 'tilt sensor']),
 P('digital-sensor', 'Line tracking sensor TCRT5000', 'TCRT5000', 'VCC GND OUT', {}, ['tcrt5000', 'line sensor', 'line follower sensor']),
 # servos, ultrasonic, joystick
 P('servo', 'Servo MG90S', 'MG90S', 'GND VCC SIG', dict(range=180), ['mg90s', 'metal gear micro servo']),
 P('servo', 'Servo MG996R', 'MG996R', 'GND VCC SIG', dict(range=180), ['mg996r', 'high torque servo']),
 P('servo', 'Servo MG995', 'MG995', 'GND VCC SIG', dict(range=180), ['mg995']),
 P('servo', 'Servo DS3218', 'DS3218', 'GND VCC SIG', dict(range=270), ['ds3218']),
 P('servo', 'Servo SG92R', 'SG92R', 'GND VCC SIG', dict(range=180), ['sg92r']),
 P('ultrasonic', 'Ultrasonic sensor HC-SR04P (3.3 V)', 'HC-SR04P', 'VCC TRIG ECHO GND', {}, ['hc-sr04p', 'hcsr04p']),
 P('ultrasonic', 'Ultrasonic sensor JSN-SR04T (waterproof)', 'JSN-SR04T', 'VCC TRIG ECHO GND', {}, ['jsn-sr04t', 'waterproof ultrasonic']),
 P('ultrasonic', 'Ultrasonic sensor US-100', 'US-100', 'VCC TRIG ECHO GND', {}, ['us-100']),
]
JOY = dict(kind='joystick', name='Joystick module KY-023', label='KY-023', pins=['GND', '5V', 'VRX', 'VRY', 'SW'], params={}, aka=['ky-023', 'joystick', 'analog joystick', 'thumb joystick'])
EXTRA.append(JOY)
EXTRA += [
 P('switch', 'Slide switch SPDT', 'SPDT', 'COM T1 T2', {}, ['spdt', 'slide switch']),
 P('switch', 'Rocker switch', 'ROCKER', '1 2', {}, ['rocker', 'rocker switch', 'power switch']),
 P('switch', 'Limit switch (lever)', 'LIMIT', 'COM NO NC', {}, ['limit switch', 'micro switch', 'endstop']),
 P('buzzer', 'Piezo buzzer 5 V', 'BUZZ', '+ -', dict(ohms=100, vmin=1, mode='passive'), []),
 P('motor', 'DC motor 130 (toy motor)', 'M130', '+ -', dict(ohms=8), ['130 motor', 'toy motor', 'hobby motor']),
 P('motor', 'N20 gear motor 6 V', 'N20', '+ -', dict(ohms=12), ['n20 motor', 'n20 gear motor', 'micro gear motor']),
 P('motor', 'TT gear motor (yellow)', 'TT', '+ -', dict(ohms=7), ['tt motor', 'yellow gear motor', 'robot car motor']),
 P('motor', 'Motor 775 12 V', '775', '+ -', dict(ohms=2), ['775 motor', 'big motor']),
]

# generic jobs a beginner names without a part number -> the standard real part
GENERIC = {
 'an NPN transistor': 'npn transistor 2n2222', 'a PNP transistor': 'pnp transistor 2n2907', 'a transistor': 'npn transistor 2n2222',
 'a logic level mosfet': 'n-mosfet irlz44n', 'a mosfet': 'n-mosfet irlz44n', 'a power mosfet': 'n-mosfet irf540n',
 'a diode': 'diode 1n4007', 'a rectifier diode': 'diode 1n4007', 'a schottky diode': 'schottky diode 1n5819',
 'a 5v regulator': 'voltage regulator 7805', 'a voltage regulator': 'voltage regulator 7805', 'a 3.3v regulator': 'regulator ams1117-3.3',
 'a servo': 'servo sg90', 'a servo motor': 'servo sg90', 'a micro servo': 'servo sg90',
 'a distance sensor': 'ultrasonic sensor hc-sr04', 'an ultrasonic sensor': 'ultrasonic sensor hc-sr04', 'a range finder': 'ultrasonic sensor hc-sr04',
 'a motion sensor': 'pir motion sensor hc-sr501', 'a temperature sensor': 'temperature sensor lm35', 'a light sensor': 'light sensor module ldr',
 'a gas sensor': 'gas sensor mq-2', 'a smoke sensor': 'gas sensor mq-2', 'a heartbeat sensor': 'pulse sensor', 'an ecg sensor': 'heart monitor ad8232',
 'an op amp': 'op-amp lm358-style', 'an operational amplifier': 'op-amp lm358-style', 'an instrumentation amplifier': 'instrumentation amp ina128 (gain 100)',
 'a relay': 'relay (5 v coil)', 'a 5v relay': 'relay (5 v coil)', 'a 12v relay': 'relay (12 v coil)',
 'a rotary encoder': 'rotary encoder ky-040', 'a joystick': 'joystick module ky-023', 'a buzzer': 'active buzzer', 'a speaker': 'speaker 8 ohm',
 'a dc motor': 'dc motor 130 (toy motor)', 'a motor': 'dc motor 130 (toy motor)', 'a vibration motor': 'vibration motor', 'a fan': 'dc fan 5 v',
 'a slide switch': 'slide switch spdt', 'a toggle switch': 'toggle switch (on / off)', 'a force sensor': 'force sensor (fsr)', 'a flex sensor': 'flex sensor',
 'a hall sensor': 'hall / magnet sensor', 'a sound sensor': 'sound sensor (analog)', 'a soil moisture sensor': 'soil moisture sensor module',
}

NEGATIVE = ['a motor driver', 'l298n motor driver', 'an h bridge', 'dual h-bridge driver', 'l293d motor driver', 'a motor controller', 'an esc', 'brushless motor controller', 'a drv8833', 'a tb6612 driver', 'a motor shield', 'a drone flight controller', 'a 4 in 1 esc', 'a led strip driver', 'a mosfet driver module', 'a relay module with optocoupler', 'a solid state relay', 'a triac dimmer', 'an optocoupler pc817', 'a 4n35', 'a 7 segment driver max7219', 'a led matrix', 'a lcd i2c backpack', 'a bluetooth speaker', 'a battery charger tp4056', 'a lithium battery', 'a solar panel', 'a supercapacitor', 'a thermocouple amplifier max31855', 'a strain gauge', 'a loudspeaker amplifier pam8403', 'an audio amplifier lm386', 'a dac', 'an adc','a quantum flux capacitor', 'a bluetooth module hc-05', 'esp32 cam', 'a gps module neo-6m', 'an sd card reader', 'a raspberry pi', 'an arduino uno', 'a wifi module esp-01', 'a lora radio sx1278',
 'an nrf24l01 radio', 'a bme280 sensor', 'a bmp180 pressure sensor', 'a ds3231 real time clock', 'an mpu6050', 'a max30102 pulse oximeter', 'a 16x2 lcd', 'an oled display ssd1306', 'a tft screen', 'a neopixel ring',
 'a ws2812b led strip', 'a rfid reader rc522', 'a fingerprint sensor', 'a camera module ov7670', 'a dht22', 'a thermal camera amg8833', 'a stepper driver a4988', 'a tmc2209 driver', 'a nema 17 stepper', 'a gyroscope l3g4200',
 'a magnetometer hmc5883l', 'a time of flight sensor vl53l0x', 'a color sensor tcs3200', 'an hx711 load cell amplifier', 'a lidar', 'a geiger counter', 'a flux capacitor', 'a teleporter', 'a lightsaber', 'a pizza oven',
 'a 74hc595', 'a 555 timer', 'an atmega328p', 'an attiny85', 'a 4017 counter', 'a nand gate', 'a flip flop', 'a shift register', 'a keypad 4x4', 'a seven segment display', 'an ir receiver vs1838', 'a dfplayer mini',
 'a cd4051 multiplexer', 'an lm393 comparator', 'a mcp3008 adc', 'an ads1115', 'a pca9685 servo driver', 'a mcp4725 dac']

OFFSETS = []   # filled in main

# ───────── parametric families: the numbers are what the model must read correctly ─────────
def fmt_ohm(v):
    if v >= 1e6: return f'{v / 1e6:g}M'
    if v >= 1e3: return f'{v / 1e3:g}k'
    return f'{v:g}'
def ohm_forms(v, rng):
    f = [f'{v:g} ohm', f'{v:g} ohms', f'{v:g}ohm']
    if v >= 1e3 and v < 1e6: k = v / 1e3; f += [f'{k:g}k', f'{k:g}k ohm', f'{k:g} k', f'{k:g}kohm', f'{k:g} kilo ohm', f'{k:g} kilohm', f'{int(k)}k{str(round(v % 1000 / 100)) if v % 1000 else ""}']
    if v >= 1e6: m = v / 1e6; f += [f'{m:g}m ohm', f'{m:g} meg', f'{m:g}M', f'{m:g} megohm', f'{m:g}Mohm']
    return rng.choice(f)
def cap_forms(uf, rng):
    if uf < 0.001: n = uf * 1e6; f = [f'{n:g}pf', f'{n:g} pf', f'{n:g}pF', f'{n:g} picofarad']
    elif uf < 1: n = uf * 1e3; f = [f'{n:g}nf', f'{n:g} nf', f'{n:g}nF', f'{n:g} nanofarad', f'{uf:g}uf', f'{uf:g} uf']
    elif uf >= 1000: n = uf / 1000; f = [f'{n:g}mf', f'{uf:g}uf', f'{uf:g} uf', f'{uf:g}uF', f'{n:g} millifarad']
    else: f = [f'{uf:g}uf', f'{uf:g} uf', f'{uf:g}uF', f'{uf:g} microfarad', f'{uf:g} mf'.replace('mf', 'uf')]
    return rng.choice(f)
def cap_label(uf):
    if uf < 0.001: return f'{uf * 1e6:g}pF'
    if uf < 1: return f'{uf * 1e3:g}nF'
    return f'{uf:g}uF'
def ind_label(mh):
    return f'{mh * 1000:g}uH' if mh < 1 else f'{mh:g}mH'

def family_entries(rng):
    E = []
    for v in [10, 22, 47, 100, 150, 220, 330, 470, 560, 680, 1000, 1500, 2200, 3300, 4700, 5600, 6800, 10000, 15000, 22000, 33000, 47000, 68000, 100000, 220000, 470000, 1000000, 2200000, 4700000]:
        E.append(dict(kind='resistor', name=f'Resistor {fmt_ohm(v)}', label=fmt_ohm(v), pins=['1', '2'], params=dict(ohms=v), aka=[], fam=('res', v)))
    for uf in [0.0001, 0.00047, 0.001, 0.0047, 0.01, 0.022, 0.047, 0.1, 0.22, 0.47, 1, 2.2, 4.7, 10, 22, 47, 100, 220, 470, 1000, 2200, 4700]:
        pol = uf >= 1
        E.append(dict(kind='capacitor', name=f'{"Electrolytic" if pol else "Ceramic"} capacitor {cap_label(uf)}', label=cap_label(uf), pins=['+', '-'] if pol else ['1', '2'], params=dict(uF=uf), aka=[], fam=('cap', uf)))
    for mh in [0.01, 0.1, 1, 4.7, 10, 22, 47, 100, 220, 1000]:
        E.append(dict(kind='inductor', name=f'Inductor {ind_label(mh)}', label=ind_label(mh), pins=['1', '2'], params=dict(mH=mh, rs=round(2 + mh ** 0.5, 1)), aka=[], fam=('ind', mh)))
    for v in [1000, 5000, 10000, 20000, 50000, 100000, 500000, 1000000]:
        E.append(dict(kind='variable-resistor', name=f'Potentiometer {fmt_ohm(v)}', label='POT', pins=['LO', 'W', 'HI'], params=dict(ohms=v), aka=[], fam=('pot', v)))
    for v in [3.3, 4.7, 5.1, 5.6, 6.2, 9.1, 12, 15, 18, 24]:
        E.append(dict(kind='diode', name=f'Zener diode {v:g} V', label=f'ZENER {v:g}V', pins=['A', 'K'], params=dict(vf=0.7, vz=v, imax=500), aka=[], fam=('zener', v)))
    for v in [1.8, 2.5, 3.3, 5, 6, 9, 12, 15]:
        E.append(dict(kind='regulator', name=f'Voltage regulator {v:g} V', label=f'{v:g}V LDO', pins=['IN', 'GND', 'OUT'], params=dict(vout=v, drop=1.1, mode='linear', imax=1000), aka=[], fam=('ldo', v)))
    for v in [3.3, 5, 9, 12]:
        E.append(dict(kind='regulator', name=f'Buck converter module (to {v:g} V)', label=f'BUCK {v:g}V', pins=['VIN', 'GND', 'VOUT'], params=dict(vout=v, drop=0, mode='switching', imax=3000), aka=[], fam=('buck', v)))
    for v in [5, 6, 9, 12, 24]:
        ohm = {5: 70, 6: 100, 9: 200, 12: 400, 24: 1600}[v]
        E.append(dict(kind='relay', name=f'Relay ({v} V coil)', label=f'RELAY {v}V', pins='C+ C- COM NO NC'.split(), params=dict(ohms=ohm, pick={5: 3.5, 12: 8}.get(v, round(v * 0.67, 1))), aka=[], fam=('relay', v)))
    for v in [3.3, 5, 6, 9, 12]:
        E.append(dict(kind='motor', name=f'DC motor {v:g} V', label=f'MOTOR {v:g}V', pins=['+', '-'], params=dict(ohms=round(v * 1.5, 1)), aka=[], fam=('motor', v)))
    for g in [2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]:
        for nm, lb, pins in (('INA128', 'INA128', 'IN+ IN- OUT REF V+ V-'), ('AD620', 'AD620', 'IN+ IN- OUT REF V+ V-'), ('BioAmp EXG Pill', 'EXG Pill', 'OUT VCC GND IN+ IN- REF'), ('INA126', 'INA126', 'IN+ IN- OUT REF V+ V-')):
            E.append(dict(kind='inamp', name=f'{"Instrumentation amp " if nm != "BioAmp EXG Pill" else ""}{nm}', label=lb, pins=pins.split(), params=dict(gain=g), aka=[nm.lower()], fam=('gain', g)))
    return E

# ───────── phrasing: TRAIN pools and HELD-OUT pools (never trained on) ─────────
PRE = ['', '', '', 'add', 'make', 'create', 'i need', 'i want', 'make me', 'a part for', 'build', 'new part', 'define', 'give me', 'part maker', 'can you make', 'please make', 'i d like', 'lets make', 'generate', 'design', 'get me', 'put together', 'write up']
PRE_HO = ['whip up', 'fashion', 'conjure', 'cook up', 'draft', 'prepare']
POST = ['', '', '', '', 'module', 'part', 'please', 'for my project', 'for the bench', 'component', 'with its pins', 'real one', 'thanks', 'asap', 'in my parts']
POST_HO = ['for my robot', 'if you can', 'lets go', 'real quick']
def dressed(core, rng, held):
    return ' '.join(x for x in [rng.choice(PRE_HO if held and rng.random() < 0.5 else PRE), core, rng.choice(POST_HO if held and rng.random() < 0.5 else POST)] if x)

def part_number_forms(s, rng):
    # "ina128" can arrive as "INA 128", "ina-128"; "hc-sr04" as "hcsr04" or "hc sr04"
    r = rng.random()
    if r < 0.12 and '-' in s: return s.replace('-', '')
    if r < 0.24 and '-' in s: return s.replace('-', ' ')
    if r < 0.30:
        import re
        m = re.match(r'^([a-z]+)(\d.*)$', s)
        if m: return f'{m.group(1)} {m.group(2)}'
    return s

def request_for(e, rng, held):
    kind = e['kind']; fam = e.get('fam')
    if fam:
        t, v = fam
        if t == 'res': core = rng.choice([f'{ohm_forms(v, rng)} resistor', f'resistor {ohm_forms(v, rng)}', f'{ohm_forms(v, rng)} resistor']);
        elif t == 'cap':
            c = cap_forms(v, rng); core = rng.choice([f'{c} capacitor', f'capacitor {c}', f'{c} cap', f'{c} {"electrolytic" if v >= 1 else "ceramic"} capacitor'])
        elif t == 'ind':
            lab = ind_label(v).lower(); core = rng.choice([f'{lab} inductor', f'inductor {lab}', f'{lab} coil', f'{lab.replace("mh", " mh").replace("uh", " uh")} inductor'])
        elif t == 'pot': core = rng.choice([f'{ohm_forms(v, rng)} potentiometer', f'{ohm_forms(v, rng)} pot', f'potentiometer {ohm_forms(v, rng)}', f'{ohm_forms(v, rng)} knob', f'{fmt_ohm(v).lower()} trimmer'])
        elif t == 'zener': core = rng.choice([f'{v:g}v zener', f'{v:g} v zener diode', f'zener diode {v:g}v', f'zener {v:g}', f'{v:g}v zener diode'])
        elif t == 'ldo': core = rng.choice([f'{v:g}v regulator', f'{v:g} v voltage regulator', f'{v:g}v ldo', f'regulator to {v:g}v', f'{v:g}v linear regulator'])
        elif t == 'buck': core = rng.choice([f'buck converter {v:g}v', f'{v:g}v buck converter', f'step down converter to {v:g}v', f'{v:g}v step down module', f'buck module {v:g} v'])
        elif t == 'relay': core = rng.choice([f'{v}v relay', f'relay {v}v', f'{v} v relay', f'relay with {v}v coil', f'{v}v coil relay'])
        elif t == 'motor': core = rng.choice([f'{v:g}v dc motor', f'dc motor {v:g}v', f'{v:g} v motor', f'motor {v:g}v'])
        elif t == 'gain':
            nm = e['name'].lower().replace('instrumentation amp ', ''); nm = part_number_forms(nm, rng)
            core = rng.choice([f'{nm} with gain {v}', f'{nm} gain {v}', f'{nm} at gain {v}', f'{nm} amplifier gain of {v}', f'{nm} x{v}', f'{nm} {v}x gain', f'{nm} gain={v}', f'{nm} set to {v} gain'])
        return dressed(core, rng, held)
    opts = [e['name'].lower(), e['label'].lower(), f"{e['label'].lower()} {rng.choice(['module', 'sensor', 'chip', 'part', 'board', ''])}".strip()]
    for a in e['aka']: opts += [a, f'{a} {rng.choice(["module", "sensor", "chip", "part", ""])}'.strip()]
    core = rng.choice(opts)
    core = part_number_forms(core, rng)
    return dressed(core, rng, held)

def pl(e):
    params = ' '.join(f'{k}={num(v)}' for k, v in e['params'].items())
    return f"{e['name']}|{e['label']}|{e['kind']}|{' '.join(e['pins'])}|{params}".rstrip('|') if not params else f"{e['name']}|{e['label']}|{e['kind']}|{' '.join(e['pins'])}|{params}"

def ascii_pl(s): return ''.join(c if 32 <= ord(c) < 127 else '?' for c in s)

def main():
    n_train, n_val, n_held = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]); OUT = sys.argv[4]; os.makedirs(OUT, exist_ok=True)
    rng = random.Random(11)
    cat = []
    for t in TEMPL:
        aka = [t['id'].replace('-', ' '), t['id'].split('-', 1)[-1]]
        cat.append(dict(kind=t['kind'], name=t['name'], label=t['label'], pins=t['pins'], params=t['params'], aka=aka))
    cat += EXTRA
    fam = family_entries(rng)
    allparts = cat + fam
    json.dump([{k: v for k, v in e.items() if k != 'aka'} for e in allparts], open(f'{OUT}/catalog.json', 'w'), indent=0)
    gen_ids = {id(e) for e in cat}
    def gen_one(held):
        r = rng.random()
        if r < 0.50: e = rng.choice(cat); return request_for(e, rng, held), pl(e)
        if r < 0.78: e = rng.choice(fam); return request_for(e, rng, held), pl(e)
        if r < 0.90:
            k = rng.choice(list(GENERIC)); target = GENERIC[k]
            e = next((x for x in cat if x['name'].lower() == target), None)
            if e is None: return gen_one(held)
            return dressed(k, rng, held), pl(e)
        return dressed(rng.choice(NEGATIVE), rng, held), 'unknown'
    def make(n, held, aug):
        out, seen = [], set()
        while len(out) < n:
            q, p = gen_one(held); q = q.lower().replace('  ', ' ').strip()
            if aug and rng.random() < 0.45: q = noisy(q, rng)
            if aug and rng.random() < 0.30: q = typo(q, rng)
            if not q: continue
            out.append({'request': q, 'state': '', 'program': ascii_pl(p)})
        return out
    train, val, held = make(n_train, False, True), make(n_val, False, False), make(n_held, True, False)
    seen = {x['request'] for x in train}; held = [x for x in held if x['request'] not in seen]
    for name, d in (('train', train), ('val', val), ('heldout', held)):
        with open(f'{OUT}/{name}.jsonl', 'w') as f:
            for x in d: f.write(json.dumps(x) + '\n')
    print({'catalog': len(cat), 'families': len(fam), 'train': len(train), 'val': len(val), 'heldout': len(held)})
    for x in train[:12]: print(x['request'], '=>', x['program'])

if __name__ == '__main__': main()
