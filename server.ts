import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-for-dev';

// Initialize SQLite database
const dbPath = path.join(__dirname, 'database.sqlite');
const db = new Database(dbPath);

// Create tables if they don't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    google_id TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS timesheets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    week_of TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id),
    UNIQUE(user_id, week_of)
  );

  CREATE TABLE IF NOT EXISTS magic_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL
  );
`);

// Add google_id column if it doesn't exist (for existing databases)
try {
  db.exec('ALTER TABLE users ADD COLUMN google_id TEXT UNIQUE');
} catch (e) {
  // Column likely already exists
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '10mb' })); // Allow larger payloads for signatures

  // Middleware to verify JWT
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    });
  };

  // API Routes
  
  // Request Magic Link
  app.post('/api/auth/magic-link', (req, res) => {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    try {
      const token = crypto.randomBytes(32).toString('hex');
      // Token expires in 15 minutes
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      const stmt = db.prepare('INSERT INTO magic_links (email, token, expires_at) VALUES (?, ?, ?)');
      stmt.run(email, token, expiresAt);

      // In a real production app, you would send an email here using SendGrid, Resend, etc.
      // For this environment, we will return the link so the frontend can display it.
      const link = `${req.protocol}://${req.get('host')}/api/auth/verify?token=${token}`;
      console.log(`Magic link for ${email}: ${link}`);

      res.json({ success: true, devLink: link });
    } catch (error) {
      console.error('Magic link error:', error);
      res.status(500).json({ error: 'Failed to generate magic link' });
    }
  });

  // Verify Magic Link
  app.get('/api/auth/verify', (req, res) => {
    const { token } = req.query;
    if (!token) {
      return res.status(400).send('Missing token');
    }

    try {
      // Check if token exists and is not expired
      const stmt = db.prepare('SELECT * FROM magic_links WHERE token = ? AND expires_at > CURRENT_TIMESTAMP');
      const linkRecord = stmt.get(token) as any;

      if (!linkRecord) {
        return res.status(400).send('Invalid or expired magic link. Please request a new one.');
      }

      const email = linkRecord.email;

      // Find or create user
      let userStmt = db.prepare('SELECT * FROM users WHERE email = ?');
      let user = userStmt.get(email) as any;
      let userId;

      if (user) {
        userId = user.id;
      } else {
        // Create new user with dummy password (since we use passwordless)
        const insertStmt = db.prepare('INSERT INTO users (email, password) VALUES (?, ?)');
        const dummyPassword = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);
        const info = insertStmt.run(email, dummyPassword);
        userId = info.lastInsertRowid;
      }

      // Delete the used token
      db.prepare('DELETE FROM magic_links WHERE token = ?').run(token);

      // Generate JWT
      const jwtToken = jwt.sign({ id: userId, email }, JWT_SECRET);

      // Redirect to frontend with the token
      res.redirect(`/?auth_token=${jwtToken}`);
    } catch (error) {
      console.error('Verify error:', error);
      res.status(500).send('Internal server error during verification');
    }
  });

  // Get current user
  app.get('/api/auth/me', authenticateToken, (req: any, res) => {
    res.json({ user: req.user });
  });

  // Sync timesheets (migrate from local storage)
  app.post('/api/timesheets/sync', authenticateToken, (req: any, res) => {
    const { history } = req.body;
    const userId = req.user.id;

    if (!history || typeof history !== 'object') {
      return res.status(400).json({ error: 'Invalid history data' });
    }

    try {
      const stmt = db.prepare(`
        INSERT INTO timesheets (user_id, week_of, data, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, week_of) DO UPDATE SET
        data = excluded.data,
        updated_at = CURRENT_TIMESTAMP
      `);

      const syncTimesheets = db.transaction((historyData) => {
        for (const [weekOf, data] of Object.entries(historyData)) {
          stmt.run(userId, weekOf, JSON.stringify(data));
        }
      });

      syncTimesheets(history);
      res.json({ success: true });
    } catch (error) {
      console.error('Sync error:', error);
      res.status(500).json({ error: 'Failed to sync timesheets' });
    }
  });

  // Get all timesheets for user
  app.get('/api/timesheets', authenticateToken, (req: any, res) => {
    const userId = req.user.id;
    try {
      const stmt = db.prepare('SELECT week_of, data FROM timesheets WHERE user_id = ?');
      const rows = stmt.all() as any[];
      
      const history: Record<string, any> = {};
      rows.forEach(row => {
        history[row.week_of] = JSON.parse(row.data);
      });
      
      res.json({ history });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch timesheets' });
    }
  });

  // Save single timesheet
  app.post('/api/timesheets', authenticateToken, (req: any, res) => {
    const { weekOf, data } = req.body;
    const userId = req.user.id;

    if (!weekOf || !data) {
      return res.status(400).json({ error: 'Week and data are required' });
    }

    try {
      const stmt = db.prepare(`
        INSERT INTO timesheets (user_id, week_of, data, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, week_of) DO UPDATE SET
        data = excluded.data,
        updated_at = CURRENT_TIMESTAMP
      `);
      stmt.run(userId, weekOf, JSON.stringify(data));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to save timesheet' });
    }
  });

  // Delete single timesheet
  app.delete('/api/timesheets/:weekOf', authenticateToken, (req: any, res) => {
    const { weekOf } = req.params;
    const userId = req.user.id;

    try {
      const stmt = db.prepare('DELETE FROM timesheets WHERE user_id = ? AND week_of = ?');
      stmt.run(userId, weekOf);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete timesheet' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
