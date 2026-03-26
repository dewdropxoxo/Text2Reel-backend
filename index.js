import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { runRenderJob } from './renderEngine.js';

dotenv.config();

const app = express();

// Standard middleware
app.use(cors());
app.use(express.json());

/**
 * RENDER.COM HEALTH CHECK
 * Render pings the root URL ('/') to verify the service is "Live".
 * Without this, the deployment will time out even if the server is running.
 */
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'Text2Reel Render Engine',
    timestamp: new Date().toISOString()
  });
});

/**
 * Main Rendering Endpoint
 */
app.post('/api/render', async (req, res) => {
  const scriptData = req.body;
  
  if (!scriptData || !scriptData.content) {
    return res.status(400).json({ error: 'Invalid script data' });
  }

  try {
    console.log(`[${new Date().toLocaleTimeString()}] Starting render job: "${scriptData.title || 'Untitled'}"`);
    
    // Set headers for streaming video
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="render.mp4"`);

    const videoStream = await runRenderJob(scriptData);
    
    // Pipe the video stream directly to the HTTP response
    videoStream.pipe(res);
    
    videoStream.on('end', () => {
      console.log(`[${new Date().toLocaleTimeString()}] Render job completed successfully.`);
    });

  } catch (error) {
    console.error('Render Route Error:', error);
    // If headers haven't been sent yet, we can send a 500
    if (!res.headersSent) {
      res.status(500).json({ error: 'Rendering failed' });
    } else {
      res.end();
    }
  }
});

// Render usually uses port 10000, but we use process.env.PORT to be safe
const PORT = process.env.PORT || 3001;

app.listen(PORT, '0.0.0.0', () => {
  console.log('-------------------------------------------');
  console.log(`🚀 Render Engine Online`);
  console.log(`📡 Listening on port: ${PORT}`);
  console.log(`🔗 Health Check: http://localhost:${PORT}/`);
  console.log('-------------------------------------------');
});
