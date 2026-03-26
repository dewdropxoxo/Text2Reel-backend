import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { processVideoJob } from './renderEngine.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e8 // 100MB for frame data
});

app.get('/', (req, res) => {
  res.status(200).json({ status: 'healthy', mode: 'hybrid' });
});

io.on('connection', (socket) => {
  console.log('Client connected for rendering:', socket.id);

  socket.on('start-render', async (data) => {
    try {
      console.log('Starting render job for:', data.title);
      await processVideoJob(socket, data);
    } catch (err) {
      console.error('Render Job Error:', err);
      socket.emit('render-error', { message: err.message });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Hybrid Render Engine Online on port ${PORT}`);
});
