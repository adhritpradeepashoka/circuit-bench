// npm run doctor — checks that this machine can compile Arduino sketches for the app (see server/doctor.mjs)
import { createCompiler } from '../server/compile-service.mjs';
import { checkToolchain, formatChecks } from '../server/doctor.mjs';

const port = process.env.PORT || 8787;
console.log('Virtual Lab — checking the Arduino toolchain…\n');
const checks = await checkToolchain(createCompiler(), { healthUrl: `http://127.0.0.1:${port}/api/health` });
console.log(formatChecks(checks));
process.exit(checks.filter(c => c.name !== 'Compile service').every(c => c.ok) ? 0 : 1);
