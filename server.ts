import express from "express";
import { createServer as createViteServer } from "vite";
import path from "node:path";
import * as url from "node:url";

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Wait, I should not store API key in the repo but pass it via process.env.
  // The user says the API key is associated with the current project, so let's put it in process.env.
  app.post("/api/verify-recaptcha", async (req, res) => {
    try {
      const { token, action } = req.body;
      const apiKey = process.env.RECAPTCHA_API_KEY;

      if (!apiKey) {
        return res.status(500).json({ error: "ReCaptcha API key not configured" });
      }

      const requestBody = {
        event: {
          token,
          expectedAction: action || "LOGIN",
          siteKey: "6Lc1QcUsAAAAAB7EjZgWtJljysfy7EvkeR1scH8N"
        }
      };

      const response = await fetch(`https://recaptchaenterprise.googleapis.com/v1/projects/webnow10101/assessments?key=${apiKey}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("ReCaptcha check failed:", error);
      res.status(500).json({ error: "ReCaptcha check failed" });
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
    // Handling Express version API
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
