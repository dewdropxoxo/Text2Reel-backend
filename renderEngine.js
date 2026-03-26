import ffmpeg from 'fluent-ffmpeg';
import { PassThrough } from 'stream';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export async function processVideoJob(socket, data) {
  const { 
    title, 
    quality = '720p', 
    isPro = false, 
    audioEvents = [],
    fps = 30 
  } = data;

  const jobId = uuidv4();
  const outputDir = './temp';
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
  
  const outputPath = path.join(outputDir, `${jobId}.mp4`);
  const inputStream = new PassThrough();

  console.log(`[Job ${jobId}] Initializing FFmpeg...`);

  const ff = ffmpeg()
    .input(inputStream)
    .inputFormat('image2pipe')
    .inputFPS(fps)
    .videoCodec('libx264')
    .outputOptions([
      '-pix_fmt yuv420p',
      '-preset ultrafast',
      '-movflags +faststart'
    ]);

  // Resolution Management
  const scale = quality === '1080p' ? '1080:1920' : '720:1280';
  let videoFilters = [`scale=${scale}:force_original_aspect_ratio=decrease,pad=${scale}:(ow-iw)/2:(oh-ih)/2`];

  // Watermark for Free users
  if (!isPro) {
    videoFilters.push(`drawtext=text='watermark':x=w-120:y=h-60:fontsize=32:fontcolor=white@0.3:shadowcolor=black@0.2:shadowx=2:shadowy=2`);
  }

  ff.videoFilters(videoFilters);

  // Audio Handling (Placeholder for actual mixing logic)
  // In a full implementation, we would download the assets and use -filter_complex
  // For now, we focus on the video stream stability
  
  ff.on('error', (err) => {
    console.error('FFmpeg Error:', err);
    socket.emit('render-error', { message: 'Video encoding failed' });
  })
  .on('end', () => {
    console.log(`[Job ${jobId}] Completed.`);
    // In a real production environment, you'd upload to S3 here.
    // For this prototype, we'll notify the client we are ready.
    socket.emit('render-complete', { jobId, downloadUrl: '#' }); 
  })
  .save(outputPath);

  // Listen for frames from the client
  socket.on('frame', (frameBuffer) => {
    inputStream.write(Buffer.from(frameBuffer));
  });

  socket.on('finish-frames', () => {
    console.log(`[Job ${jobId}] Finalizing...`);
    inputStream.end();
  });
}
