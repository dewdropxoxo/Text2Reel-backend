import ffmpeg from 'fluent-ffmpeg';
import { PassThrough } from 'stream';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import puppeteer from 'puppeteer';

const SOUND_ASSETS = {
  TYPING: 'https://mp3tourl.com/audio/1774410364465-b6e3995a-51ee-4ead-bf78-881acfcaa4c8.wav',
  SEND: 'https://mp3tourl.com/audio/1774410462405-b5063226-2516-493b-8900-ec7b22d0e1f0.wav',
  RECEIVE: 'https://mp3tourl.com/audio/1774410528713-68b5d60a-17f5-460a-b74c-2729d078cf2f.wav',
  BACKSPACE: 'https://mp3tourl.com/audio/1774413005961-1f23b05b-b7a6-44e6-bb36-55ec7f057310.m4a'
};

export async function processVideoJob(socket, data) {
  const { title, quality = '720p', isPro = false, audioEvents = [], fps = 30, mode = 'hybrid' } = data;
  const jobId = uuidv4();
  const outputDir = './temp';
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${jobId}.mp4`);

  const inputStream = new PassThrough();
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

  const width = quality === '1080p' ? 1080 : 720;
  const height = quality === '1080p' ? 1920 : 1280;

  ff.videoFilters([`scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`]);

  if (!isPro) {
    ff.videoFilters(`drawtext=text='Text2Reel':x=w-150:y=h-80:fontsize=32:fontcolor=white@0.3:shadowcolor=black@0.2:shadowx=2:shadowy=2`);
  }

  if (audioEvents.length > 0) {
    const uniqueTypes = [...new Set(audioEvents.map(e => e.type))];
    uniqueTypes.forEach(type => {
      ff.input(SOUND_ASSETS[type]);
    });

    const typeToIdx = {};
    uniqueTypes.forEach((type, i) => { typeToIdx[type] = i + 1; });

    const typeCounts = {};
    audioEvents.forEach(e => { typeCounts[e.type] = (typeCounts[e.type] || 0) + 1; });

    let filterString = '';
    let amixInputs = '';

    // 1. SPLIT STREAMS
    uniqueTypes.forEach(type => {
      const count = typeCounts[type];
      const inputIdx = typeToIdx[type];
      if (count > 1) {
        let splits = '';
        for (let i = 0; i < count; i++) {
          splits += `[s_${type}_${i}]`;
        }
        filterString += `[${inputIdx}:a]asplit=${count}${splits};`;
      } else {
        filterString += `[${inputIdx}:a]anull[s_${type}_0];`;
      }
    });

    // 2. APPLY PRECISION TRIMMING AND DELAYS
    const currentCounters = {};
    audioEvents.forEach((event, idx) => {
      const type = event.type;
      const c = currentCounters[type] || 0;
      currentCounters[type] = c + 1;

      const inLabel = `[s_${type}_${c}]`;
      const outLabel = `[a${idx}]`;
      const delay = event.timestamp; 
      
      const isKeystroke = (type === 'TYPING' || type === 'BACKSPACE');
      
      // SURGICAL FIX: 
      // 1. Use duration=0.2 to ensure the click is captured (0.1 was too short for some streams).
      // 2. Add a tiny fadeout (afade) to prevent audio pops.
      // 3. Use pipe syntax for adelay (delay|delay) as it's more stable for stereo inputs.
      const trimFilter = isKeystroke 
        ? 'atrim=duration=0.2,asetpts=PTS-STARTPTS,afade=t=out:st=0.15:d=0.05,' 
        : '';
      
      const volume = isKeystroke ? 0.5 : 0.7;
      
      filterString += `${inLabel}${trimFilter}adelay=${delay}|${delay},volume=${volume}${outLabel};`;
      amixInputs += outLabel;
    });

    // 3. MIX ALL STREAMS
    filterString += `${amixInputs}amix=inputs=${audioEvents.length}:dropout_transition=0:normalize=0[outa]`;

    ff.complexFilter(filterString);
    ff.outputOptions(['-map 0:v', '-map [outa]']);
  }

  ff.on('error', (err) => {
    console.error('FFMPEG Error:', err.message);
    socket.emit('render-error', { message: err.message });
  })
  .on('end', () => {
    socket.emit('render-complete', { jobId });
  })
  .save(outputPath);

  if (mode === 'server') {
    runServerSideRender(inputStream, data, socket);
  } else {
    socket.on('frame', ({ buffer, repeat = 1 }) => {
      if (inputStream.writable) {
        const buf = Buffer.from(buffer);
        for (let i = 0; i < repeat; i++) {
          inputStream.write(buf);
        }
      }
    });

    socket.on('finish-frames', () => inputStream.end());
  }
}

async function runServerSideRender(inputStream, data, socket) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 360, height: 640, deviceScaleFactor: 2 });
    const appUrl = process.env.VITE_APP_URL || 'http://localhost:5173';
    await page.goto(`${appUrl}/#/render-preview`);
    await page.evaluate((d) => { window.RENDER_DATA = d; }, data);
    await page.waitForFunction(() => window.IS_READY === true);
    socket.emit('render-status', { message: "Cloud rendering started..." });
  } catch (e) {
    socket.emit('render-error', { message: `Puppeteer Error: ${e.message}` });
  }
      }
