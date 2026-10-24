// Pico: Serial1 (UART0, TX = GP0, RX = GP1) says hello, and echoes what it hears
void setup() { Serial1.begin(9600); Serial1.println("hello from pico"); }
void loop() { while (Serial1.available()) Serial1.write(Serial1.read()); }
