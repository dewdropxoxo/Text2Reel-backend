import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { runRenderJob } from './renderEngine.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/render', async (req, res) => {
  const scriptData = req.body;

  try {
    console.log(`Starting render job: ${scriptData.title}`);
    
    // Set headers for streaming video
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="render.mp4"`);

    const videoStream = await runRenderJob(scriptData);
    
    // Pipe the video stream directly to the HTTP response
    videoStream.pipe(res);

  } catch (error) {
    console.error('Render Route Error:', error);
    res.status(500).json({ error: 'Rendering failed' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Professional Render Server running on port ${PORT}`);
});