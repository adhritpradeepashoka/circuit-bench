// Small ready-made Arduino sketches the model can ask for by name ("sketch fade 9"). Each is checked against the pin rules of the Uno family before it is written.
const PWM = new Set(['3', '5', '6', '9', '10', '11']);
const DIG = pin => /^(\d{1,2}|A[0-5])$/.test(pin) && (pin[0] === 'A' || +pin <= 13);

/** → sketch text, or null when the kind or pin is not valid. */
export function sketchFor(kind, pin) {
  const p = String(pin ?? '').toUpperCase();
  switch (kind) {
    case 'fade':
      if (!PWM.has(p)) return null;
      return `// Fade the LED on pin ${p} up and down.\nint level = 0;\nint step = 5;\n\nvoid setup() {\n  pinMode(${p}, OUTPUT);\n}\n\nvoid loop() {\n  analogWrite(${p}, level);\n  level += step;\n  if (level <= 0 || level >= 255) step = -step;\n  delay(20);\n}\n`;
    case 'sweep':
      if (!DIG(p)) return null;
      return `// Sweep a servo on pin ${p} from 0 to 180 degrees and back.\n#include <Servo.h>\n\nServo servo;\n\nvoid setup() {\n  servo.attach(${p});\n}\n\nvoid loop() {\n  for (int angle = 0; angle <= 180; angle += 2) { servo.write(angle); delay(15); }\n  for (int angle = 180; angle >= 0; angle -= 2) { servo.write(angle); delay(15); }\n}\n`;
    case 'tone':
      if (!DIG(p)) return null;
      return `// Play a rising beep on the buzzer on pin ${p}.\nvoid setup() {\n}\n\nvoid loop() {\n  for (int f = 300; f <= 1200; f += 100) { tone(${p}, f, 120); delay(150); }\n  noTone(${p});\n  delay(800);\n}\n`;
    case 'hello':
      return `// Print a message to the Serial Monitor once a second.\nvoid setup() {\n  Serial.begin(9600);\n}\n\nvoid loop() {\n  Serial.println("Hello from CircuitBench");\n  delay(1000);\n}\n`;
    case 'empty':
      return `void setup() {\n}\n\nvoid loop() {\n}\n`;
    default: return null;
  }
}
export const SKETCH_KINDS = ['fade', 'sweep', 'tone', 'hello', 'empty'];
