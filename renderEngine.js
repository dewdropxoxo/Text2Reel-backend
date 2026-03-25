import puppeteer from 'puppeteer';
import ffmpeg from 'fluent-ffmpeg';
import { PassThrough } from 'stream';

/**
 * Optimized for Render.com Environment
 */
export async function runRenderJob(scriptData) {
  // Launch browser with specific flags for restricted environments (like Render)
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });

  const page = await browser.newPage();
  
  // Set a standard vertical mobile viewport
  await page.setViewport({
    width: 360,
    height: 640,
    deviceScaleFactor: 2
  });

  // 1. Visit the render preview page
  // On Render, we'll use the APP_URL env var you set in the dashboard
  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  
  try {
    await page.goto(`${appUrl}/#/render-preview`, {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    // 2. Inject the script data
    await page.evaluate((data) => {
      window.RENDER_DATA = data;
    }, scriptData);

    // 3. Wait for the page's "ready" signal
    await page.waitForFunction(() => window.IS_READY === true, { timeout: 10000 });

    // 4. Setup FFmpeg Pipe
    const videoStream = new PassThrough();
    const ffmpegProcess = ffmpeg()
      .inputFormat('image2pipe')
      .inputFPS(30)
      .input('-')
      .videoCodec('libx264')
      .outputOptions([
        '-pix_fmt yuv420p',
        '-preset ultrafast',
        '-movflags frag_keyframe+empty_moov'
      ])
      .format('mp4')
      .on('error', (err) => console.error('FFmpeg Error:', err));

    const finalStream = ffmpegProcess.pipe(videoStream);

    // 5. Frame Generation Loop
    const messages = scriptData.content;
    let previewMsgs = [];

    for (const msg of messages) {
      if (msg.type === 'msg') {
        if (msg.sender === 'me') {
          // Typing animation for "Me"
          for (let i = 1; i <= msg.text.length; i++) {
            await page.evaluate((msgs, text) => {
              window.setPreviewState(msgs, false, text);
            }, previewMsgs, msg.text.substring(0, i));
            
            const buffer = await page.screenshot({ type: 'png' });
            ffmpegProcess.stdin.write(buffer);
          }
        } else {
          // Typing indicator for "Them"
          await page.evaluate((msgs) => window.setPreviewState(msgs, true, ''), previewMsgs);
          for (let i = 0; i < 15; i++) { // ~0.5s typing
            const buffer = await page.screenshot({ type: 'png' });
            ffmpegProcess.stdin.write(buffer);
          }
        }
        previewMsgs.push(msg);
      } else {
        previewMsgs.push(msg);
      }

      // Final state of this message
      await page.evaluate((msgs) => window.setPreviewState(msgs, false, ''), previewMsgs);
      for (let i = 0; i < 20; i++) { // ~0.6s pause
        const buffer = await page.screenshot({ type: 'png' });
        ffmpegProcess.stdin.write(buffer);
      }
    }

    ffmpegProcess.stdin.end();
    await browser.close();
    return videoStream;

  } catch (err) {
    await browser.close();
    throw err;
  }
}