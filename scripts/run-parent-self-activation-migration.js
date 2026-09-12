require('dotenv').config();
const { runMigration } = require('./parent-self-activation-tooling');

runMigration()
  .then(() => process.stdout.write('Parent self-activation migration applied and verified\n'))
  .catch((error) => {
    process.stderr.write(`Parent self-activation migration failed: ${error.message}\n`);
    process.exitCode = 1;
  });