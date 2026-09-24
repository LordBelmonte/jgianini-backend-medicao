'use strict';

const env = require('./config/env');
const app = require('./app');

const PORT = env.PORT;

app.listen(PORT, () => {
  console.log(`[SERVER] Ambiente : ${env.NODE_ENV}`);
  console.log(`[SERVER] Porta    : ${PORT}`);
  console.log(`[SERVER] Health   : http://localhost:${PORT}/api/health`);
});
