// Almacenamiento simple en un archivo JSON. Sin dependencias nativas:
// corre igual en un hosting en la nube que en una PC local.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

function emptyDb() {
  return {
    establecimientos: [],
    usuarios: [],
    gastos: []
  };
}

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(emptyDb(), null, 2));
  }
}

let cache = null;

function load() {
  ensureFile();
  if (!cache) {
    cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  }
  return cache;
}

function save() {
  // Escritura sincrónica: Node es single-threaded para JS, así que esto
  // serializa las escrituras sin necesitar un lock adicional.
  fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2));
}

function id() {
  return crypto.randomUUID();
}

module.exports = { load, save, id, DATA_FILE };
