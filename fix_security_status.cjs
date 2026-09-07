const fs = require('fs');
let code = fs.readFileSync('src/components/SecurityStatus.jsx', 'utf8');

code = code.replace(
  /label: 'Passport Worker',/,
  `label: 'Edge Connection',`
);
code = code.replace(
  /value: readiness\.worker \? 'Protected' : 'Required',/,
  `value: readiness.worker ? 'Active' : 'Degraded',`
);

code = code.replace(
  /label: 'Turnstile protection',/,
  `label: 'Bot Protection',`
);
code = code.replace(
  /value: readiness\.turnstile \? 'Ready' : 'Required',/,
  `value: readiness.turnstile ? 'Verified' : 'Required',`
);

code = code.replace(
  /label: 'Redirect validation',/,
  `label: 'Session Security',`
);

fs.writeFileSync('src/components/SecurityStatus.jsx', code);
