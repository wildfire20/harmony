require('dotenv').config();
const { runAudit } = require('./parent-self-activation-tooling');

runAudit()
  .then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
  .catch((error) => {
    process.stderr.write(`Parent self-activation audit failed: ${error.message}\n`);
    process.exitCode = 1;
  });