import { Router } from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve HTML files path - works from both src/ and dist/
const HTML_DIR = __filename.includes('/dist/')
  ? path.join(__dirname, '..', '..', '..', 'src', 'legal')  // from dist/src/legal/ to src/legal/
  : __dirname;  // from src/legal/

export function createLegalRouter(): Router {
  const router = Router();

  router.get('/terms', async (_req: Request, res: Response) => {
    try {
      const htmlPath = path.join(HTML_DIR, 'terms.html');
      const html = await fs.readFile(htmlPath, 'utf-8');
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      console.error('Error serving terms page:', error);
      res.status(500).send('Error loading page');
    }
  });

  router.get('/privacy', async (_req: Request, res: Response) => {
    try {
      const htmlPath = path.join(HTML_DIR, 'privacy.html');
      const html = await fs.readFile(htmlPath, 'utf-8');
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      console.error('Error serving privacy page:', error);
      res.status(500).send('Error loading page');
    }
  });

  return router;
}
