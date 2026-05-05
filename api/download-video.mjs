import ytdl from '@distube/ytdl-core';

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function sanitize(name) {
  return name.replace(/[\/\\?%*:|"<>]/g, '-').slice(0, 180);
}

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { url, quality } = req.body || {};
    if (!url) return res.status(400).json({ error: 'YouTube URL is required' });

    const videoId = extractVideoId(url);
    if (!videoId) return res.status(400).json({ error: 'Invalid YouTube URL' });

    const fullUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const info = await ytdl.getInfo(fullUrl);
    const title = sanitize(info.videoDetails.title || videoId);

    const wantedItag = quality === '360' ? 18 : 22;
    let format = info.formats.find(f => f.itag === wantedItag);
    if (!format) {
      format = ytdl.chooseFormat(info.formats, {
        filter: f => f.hasVideo && f.hasAudio && f.container === 'mp4',
        quality: 'highest'
      });
    }
    if (!format) {
      return res.status(404).json({ error: 'No mp4 format with audio+video available. On Vercel only single-stream formats are supported (720p / 360p).' });
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${title}.mp4"`);
    if (format.contentLength) res.setHeader('Content-Length', format.contentLength);

    const stream = ytdl.downloadFromInfo(info, { format });
    stream.on('error', (err) => {
      console.error('ytdl stream error:', err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
      else res.end();
    });
    stream.pipe(res);
  } catch (err) {
    console.error('Video download error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Failed to download video' });
  }
}
