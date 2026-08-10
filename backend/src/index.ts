import { fileURLToPath } from 'node:url';

import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { loadCatalog } from './catalog-file.js';
import { BackendDatabase } from './db.js';

const databasePath = process.env.DATABASE_PATH ?? fileURLToPath(new URL('../data/catalog.sqlite', import.meta.url));
const photoDir = process.env.PHOTO_DIR ?? fileURLToPath(new URL('../data/photos/', import.meta.url));
const catalogPath = process.env.CATALOG_PATH ?? fileURLToPath(new URL('../../data/catalog.json', import.meta.url));
const port = Number(process.env.PORT ?? 8787);

if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Invalid PORT');

const db = new BackendDatabase(databasePath);
db.seedCatalog(loadCatalog(catalogPath));

const app = createApp({ db, photoDir });

serve({ fetch: app.fetch, port });
