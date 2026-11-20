/**
 * Servidor Local Alternativo (Fallback Web / Preview HTTP)
 * Permite rodar a mesma interface e persistência em arquivos caso o usuário execute `npm run web`
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { FileStorage } = require('./storage');
const { calculateInvoice } = require('./calculator');

const PORT = process.env.PORT || 4173;
const storageDir = path.join(os.homedir(), '.config', 'whattz', 'data');
const storage = new FileStorage(storageDir);
const rendererDir = path.join(__dirname, '../renderer');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = body ? JSON.parse(body) : {};
        let result;

        switch (req.url) {
          case '/api/getState':
            result = storage.getFullState();
            break;
          case '/api/setActivePeriod':
            result = storage.setActivePeriod(payload.periodId);
            break;
          case '/api/upsertReading':
            result = storage.upsertReading(payload.periodId, payload.reading);
            break;
          case '/api/deleteReading':
            result = storage.deleteReading(payload.periodId, payload.date);
            break;
          case '/api/updatePeriodMetadata':
            result = storage.updatePeriodMetadata(payload.periodId, payload.metadata);
            break;
          case '/api/createNewPeriod':
            result = storage.createNewPeriod(payload);
            break;
          case '/api/updateTariffConfig':
            result = storage.updateTariffConfig(payload.periodId, payload.config, payload.applyAsGlobalDefault);
            break;
          case '/api/simulateInvoice':
            result = calculateInvoice(payload.consumoKwh, payload.config, payload.options);
            break;
          case '/api/loadSampleData':
            result = storage.loadSampleData();
            break;
          case '/api/exportBackup':
            result = { exported: true, json: storage.exportBackupJson() };
            break;
          case '/api/importBackup':
            result = { imported: true, state: storage.importBackupJson(payload.rawJson) };
            break;
          default:
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Endpoint não encontrado' }));
            return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  let filePath = req.url === '/'
    ? path.join(rendererDir, 'index.html')
    : path.join(rendererDir, req.url.replace(/\?.*$/, ''));

  if (req.url === '/Calculo.png') {
    filePath = path.join(__dirname, '../../Calculo.png');
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Whattz rodando em http://localhost:${PORT}`);
});
