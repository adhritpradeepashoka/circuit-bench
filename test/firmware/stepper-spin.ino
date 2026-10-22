#include <Stepper.h>
Stepper st(2048, 8, 10, 9, 11);
void setup() { Serial.begin(9600); st.setSpeed(15); st.step(512); Serial.println("done"); st.step(-256); Serial.println("back"); }
void loop() {}
