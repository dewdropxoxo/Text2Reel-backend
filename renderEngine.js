import puppeteer from 'puppeteer';
import ffmpeg from 'fluent-ffmpeg';
import { PassThrough } from 'stream';

/**
 * The Professional Core
 * Uses Stdin Piping to keep memory usage extremely low.
 */
export async function runRenderJob(scriptData) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 360, height: 640, deviceScaleFactor: 2 });

  // 1. Visit the specialized render page
  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  await page.goto(`${appUrl}/#/render-preview`);

  // 2. Inject the script data
  await page.evaluate((data) => {
    window.RENDER_DATA = data;
  }, scriptData);

  // 3. Wait for React to be ready
  await page.waitForFunction(() => window.IS_READY === true);

  // 4. Setup FFmpeg Pipe
  const videoStream = new PassThrough();
  const ffmpegProcess = ffmpeg()
    .inputFormat('image2pipe')
    .inputFPS(30)
    .input('-') // Read from stdin
    .videoCodec('libx264')
    .outputOptions([
      '-pix_fmt yuv420p',
      '-preset ultrafast',
      '-movflags frag_keyframe+empty_moov'
    ])
    .format('mp4')
    .on('error', (err) => console.error('FFmpeg Error:', err));

  const finalStream = ffmpegProcess.pipe(videoStream);

  // 5. Frame Generation Loop (The "Piping" Logic)
  const messages = scriptData.content;
  let previewMsgs = [];
  
  for (const msg of messages) {
    // Simulate typing or delay
    if (msg.type === 'msg') {
      if (msg.sender === 'me') {
        // Capture typing steps
        for (let i = 1; i <= msg.text.length; i++) {
          await page.evaluate((msgs, text) => {
            window.setPreviewState(msgs, false, text);
          }, previewMsgs, msg.text.substring(0, i));
          
          const buffer = await page.screenshot({ type: 'png' });
          ffmpegProcess.stdin.write(buffer);
        }
      } else {
        // Show typing indicator
        await page.evaluate((msgs) => window.setPreviewState(msgs, true, ''), previewMsgs);
        for (let i = 0; i < 15; i++) { // 0.5 sec of typing
          const buffer = await page.screenshot({ type: 'png' });
          ffmpegProcess.stdin.write(buffer);
        }
      }
      previewMsgs.push(msg);
    } else {
      previewMsgs.push(msg);
    }

    // Capture the result state
    await page.evaluate((msgs) => window.setPreviewState(msgs, false, ''), previewMsgs);
    for (let i = 0; i < 30; i++) { // 1 sec pause
       const buffer = await page.screenshot({ type: 'png' });
       ffmpegProcess.stdin.write(buffer);
    }
  }

  ffmpegProcess.stdin.end();
  await browser.close();

  return videoStream;
}