import express from 'express';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import os from 'os';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 4000;

const ytDlpPath = [
  '/opt/homebrew/bin/yt-dlp',
  '/usr/local/bin/yt-dlp'
].find(p => fs.existsSync(p)) || 'yt-dlp';

const ffmpegPath = [
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg'
].find(p => fs.existsSync(p)) || 'ffmpeg';

console.log('yt-dlp path:', ytDlpPath);
console.log('ffmpeg path:', ffmpegPath);

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    console.log('Running:', ytDlpPath, args.join(' '));
    const proc = spawn(ytDlpPath, args);
    let output = '';
    let errorOutput = '';

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ output });
      } else {
        reject(new Error(errorOutput || `yt-dlp exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start yt-dlp: ${err.message}. Make sure yt-dlp is installed (brew install yt-dlp)`));
    });
  });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function formatTimestamp(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatToMarkdown(transcript, videoUrl, videoId) {
  let md = `# YouTube Video Transcript\n\n`;
  md += `**Video URL:** ${videoUrl}\n\n`;
  md += `**Video ID:** ${videoId}\n\n`;
  md += `---\n\n## Transcript\n\n`;
  transcript.forEach(item => {
    md += `**[${formatTimestamp(item.start)}]** ${item.text}\n\n`;
  });
  return md;
}

function httpsPost(url, data, headers) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(data);

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...headers
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Failed to parse response'));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    https.get({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));
}

function parseXmlCaptions(xml) {
  const transcript = [];

  // Handle format 3 XML with <p> and <s> tags
  if (xml.includes('<timedtext format="3">')) {
    const pRegex = /<p t="(\d+)" d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
    let pMatch;

    while ((pMatch = pRegex.exec(xml)) !== null) {
      const startMs = parseInt(pMatch[1]);
      const content = pMatch[3];

      // Extract text from <s> tags
      const sRegex = /<s[^>]*>([^<]*)<\/s>/g;
      let text = '';
      let sMatch;
      while ((sMatch = sRegex.exec(content)) !== null) {
        text += sMatch[1];
      }

      // If no <s> tags, try to get raw text content
      if (!text) {
        text = content.replace(/<[^>]+>/g, '');
      }

      text = decodeHtmlEntities(text).trim();

      if (text) {
        transcript.push({
          start: startMs / 1000,
          text: text
        });
      }
    }
  }

  // Handle traditional XML format with <text> tags
  if (transcript.length === 0) {
    const textRegex = /<text start="([^"]*)" dur="([^"]*)"[^>]*>([\s\S]*?)<\/text>/g;
    let match;

    while ((match = textRegex.exec(xml)) !== null) {
      const text = decodeHtmlEntities(match[3]).replace(/\n/g, ' ').trim();

      if (text) {
        transcript.push({
          start: parseFloat(match[1]),
          text: text
        });
      }
    }
  }

  return transcript;
}

function parseVtt(vtt) {
  // Auto-generated VTT has overlapping/rolling captions — collect all cue texts,
  // then deduplicate by only keeping sentences/words that are new compared to previous.
  const cues = [];
  const lines = vtt.split('\n');
  let i = 0;
  while (i < lines.length) {
    const tsMatch = lines[i].match(/^(\d{2}:\d{2}:\d{2}[.,]\d{3})\s+-->/);
    if (tsMatch) {
      const [h, m, s] = tsMatch[1].replace(',', '.').split(':');
      const start = parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s);
      i++;
      const textLines = [];
      while (i < lines.length && lines[i].trim() !== '') {
        const clean = lines[i].replace(/<[^>]+>/g, '').trim();
        if (clean) textLines.push(clean);
        i++;
      }
      // Last line of the cue is usually the most complete version
      const text = textLines[textLines.length - 1] || '';
      if (text) cues.push({ start, text });
    } else {
      i++;
    }
  }

  // Deduplicate: skip cues whose text is already contained in the next cue
  const transcript = [];
  for (let j = 0; j < cues.length; j++) {
    const current = cues[j].text;
    const next = cues[j + 1]?.text || '';
    if (!next.includes(current) && current !== transcript[transcript.length - 1]?.text) {
      transcript.push({ start: cues[j].start, text: current });
    }
  }
  return transcript;
}

async function getTranscript(videoId) {
  const tmpFile = path.join(os.tmpdir(), `yt-transcript-${videoId}`);

  // Download subtitles via yt-dlp (auto-generated or manual, prefer English)
  const args = [
    '--write-auto-sub',
    '--write-sub',
    '--sub-format', 'vtt',
    '--sub-lang', 'en',
    '--skip-download',
    '-o', tmpFile,
    '--no-playlist',
    `https://www.youtube.com/watch?v=${videoId}`
  ];

  try {
    await runYtDlp(args);
  } catch (err) {
    throw new Error('No captions available for this video');
  }

  // Find the downloaded .vtt file
  const vttFile = `${tmpFile}.en.vtt`;
  if (!fs.existsSync(vttFile)) {
    throw new Error('No captions available for this video');
  }

  const vttContent = fs.readFileSync(vttFile, 'utf8');
  fs.unlinkSync(vttFile);

  const transcript = parseVtt(vttContent);
  if (transcript.length === 0) {
    throw new Error('Failed to parse captions');
  }

  return transcript;
}

app.post('/api/transcript', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'YouTube URL is required' });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    const transcript = await getTranscript(videoId);

    if (!transcript || transcript.length === 0) {
      return res.status(404).json({ error: 'No transcript available for this video' });
    }

    const markdown = formatToMarkdown(transcript, url, videoId);

    return res.status(200).json({
      success: true,
      videoId,
      markdown,
      filename: `transcript-${videoId}.md`
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to fetch transcript. The video may not have captions available.'
    });
  }
});

// Video download endpoint
app.post('/api/download-video', async (req, res) => {
  try {
    const { url, quality } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'YouTube URL is required' });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    const downloadsDir = path.join(os.homedir(), 'Downloads');
    const outputTemplate = path.join(downloadsDir, '%(title)s.%(ext)s');

    const formatArg = quality === '1080' ? 'bestvideo[height<=1080]+bestaudio/best[height<=1080]'
      : quality === '720' ? 'bestvideo[height<=720]+bestaudio/best[height<=720]'
      : 'bestvideo[height<=360]+bestaudio/best[height<=360]';

    const args = [
      '-f', formatArg,
      '--merge-output-format', 'mp4',
      '--ffmpeg-location', ffmpegPath,
      '-o', outputTemplate,
      '--no-playlist',
      '--print', 'after_move:filepath',
      url
    ];

    const result = await runYtDlp(args);
    const filepath = result.output.trim().split('\n').pop();
    const filename = path.basename(filepath);

    return res.status(200).json({
      success: true,
      videoId,
      filename,
      filepath
    });

  } catch (error) {
    console.error('Video download error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to download video'
    });
  }
});

// Audio download endpoint
app.post('/api/download-audio', async (req, res) => {
  try {
    const { url, format } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'YouTube URL is required' });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    const downloadsDir = path.join(os.homedir(), 'Downloads');
    const audioFormat = format === 'm4a' ? 'm4a' : 'mp3';
    const outputTemplate = path.join(downloadsDir, '%(title)s.%(ext)s');

    const args = [
      '-x',
      '--audio-format', audioFormat,
      '--audio-quality', '0',
      '--ffmpeg-location', ffmpegPath,
      '-o', outputTemplate,
      '--no-playlist',
      '--print', 'after_move:filepath',
      url
    ];

    const result = await runYtDlp(args);
    const filepath = result.output.trim().split('\n').pop();
    const filename = path.basename(filepath);

    return res.status(200).json({
      success: true,
      videoId,
      filename,
      filepath
    });

  } catch (error) {
    console.error('Audio download error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to download audio'
    });
  }
});

app.listen(PORT, () => {
  console.log(`YouTube Transcript Scraper running at http://localhost:${PORT}`);
});
