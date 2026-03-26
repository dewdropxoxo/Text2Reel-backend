import ffmpeg from 'fluent-ffmpeg';
import { PassThrough } from 'stream';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export async function processVideoJob(socket, data) {
  const { title, quality = '720p', isPro = false, audioEvents = [], fps = 30 } = data;
  const jobId = uuidv4();
  const outputDir = './temp';
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  
  const outputPath = path.join(outputDir, `${jobId}.mp4`);
  const inputStream = new PassThrough();
  
  console.log(`[Job ${jobId}] Starting render: ${quality} @ ${fps}fps`);

  const ff = ffmpeg()
    .input(inputStream)
    .inputFormat('image2pipe')
    .inputFPS(fps)
    .videoCodec('libx264')
    .outputOptions([
      '-pix_fmt yuv420p',
      '-preset ultrafast',
      '-movflags +faststart',
      '-crf 23'
    ]);

  // Resolution Management - STRICT 9:16
  const width = quality === '1080p' ? 1080 : 720;
  const height = quality === '1080p' ? 1920 : 1280;
  
  let videoFilters = [`scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`];
  
  if (!isPro) {
    videoFilters.push(`drawtext=text='Text2Reel':x=w-150:y=h-80:fontsize=32:fontcolor=white@0.3:shadowcolor=black@0.2:shadowx=2:shadowy=2`);
  }
  
  ff.videoFilters(videoFilters);

  // --- AUDIO MIXING SYSTEM ---
  const SOUND_ASSETS = {
    TYPING: 'https://mp3tourl.com/audio/1774410364465-b6e3995a-51ee-4ead-bf78-881acfcaa4c8.wav',
    SEND: 'https://mp3tourl.com/audio/1774410462405-b5063226-2516-493b-8900-ec7b22d0e1f0.wav',
    RECEIVE: 'https://mp3tourl.com/audio/1774410528713-68b5d60a-17f5-460a-b74c-2729d078cf2f.wav',
    BACKSPACE: 'https://mp3tourl.com/audio/1774413005961-1f23b05b-b7a6-44e6-bb36-55ec7f057310.m4a'
  };

  if (audioEvents.length > 0) {
    // Map of unique sound types used in this job
    const uniqueTypes = [...new Set(audioEvents.map(e => e.type))];
    const typeToIndex = {};
    
    // Add audio inputs for each unique sound type
    uniqueTypes.forEach((type, idx) => {
      ff.input(SOUND_ASSETS[type]);
      typeToIndex[type] = idx + 1; // Input 0 is the video pipe
    });

    // Build adelay filter string
    // Example: [1:a]adelay=500|500[a1]; [2:a]adelay=1200|1200[a2]; [a1][a2]amix=inputs=2[outa]
    let filterString = '';
    let amixInputs = '';
    
    audioEvents.forEach((event, idx) => {
      const inputIdx = typeToIndex[event.type];
      const delay = event.timestamp;
      const label = `aud${idx}`;
      filterString += `[${inputIdx}:a]adelay=${delay}|${delay}[${label}]; `;
      amixInputs += `[${label}]`;
    });

    filterString += `${amixInputs}amix=inputs=${audioEvents.length}:dropout_transition=0[outa]`;
    
    ff.complexFilter(filterString);
    ff.outputOptions(['-map 0:v', '-map [outa]']);
  } else {
    // Silent video if no audio events
    ff.outputOptions(['-map 0:v']);
  }

  ff.on('error', (err) => {
    console.error(`[Job ${jobId}] FFmpeg Error:`, err.message);
    socket.emit('render-error', { message: 'Video encoding failed' });
  })
  .on('end', () => {
    console.log(`[Job ${jobId}] Saved to ${outputPath}`);
    socket.emit('render-complete', { jobId });
  })
  .save(outputPath);

  // Buffer frames from socket
  socket.on('frame', (frameBuffer) => {
    inputStream.write(Buffer.from(frameBuffer));
  });

  socket.on('finish-frames', () => {
    console.log(`[Job ${jobId}] Cleaning up streams...`);
    inputStream.end();
  });
}
