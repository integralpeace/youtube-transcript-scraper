const https = require('https');

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

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseCaptions(xml) {
  const captions = [];
  const regex = /<text start="([^"]*)" dur="([^"]*)"[^>]*>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const text = match[3]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n/g, ' ')
      .trim();
    if (text) {
      captions.push({
        start: parseFloat(match[1]),
        text
      });
    }
  }
  return captions;
}

async function getCaptionsUrl(videoId) {
  const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const html = await fetchUrl(pageUrl);

  const timedtextMatch = html.match(/timedtext\?v=[^"]+lang=en[^"]*/);
  if (timedtextMatch) {
    let url = timedtextMatch[0].replace(/\\u0026/g, '&');
    return `https://www.youtube.com/api/${url}`;
  }

  const anyTimedtext = html.match(/timedtext\?v=[^"]+/);
  if (anyTimedtext) {
    let url = anyTimedtext[0].replace(/\\u0026/g, '&');
    return `https://www.youtube.com/api/${url}`;
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'YouTube URL is required' });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    const captionsUrl = await getCaptionsUrl(videoId);
    if (!captionsUrl) {
      return res.status(404).json({ error: 'No transcript available for this video' });
    }

    const captionsXml = await fetchUrl(captionsUrl);
    const transcript = parseCaptions(captionsXml);

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
    return res.status(500).json({ error: error.message || 'Failed to fetch transcript' });
  }
};
