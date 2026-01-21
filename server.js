const express = require('express');
const https = require('https');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Extract video ID from YouTube URL
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

// Fetch URL content
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

// Parse XML captions to array
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
        duration: parseFloat(match[2]),
        text
      });
    }
  }

  return captions;
}

// Get captions URL from video page
async function getCaptionsUrl(videoId) {
  const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const html = await fetchUrl(pageUrl);

  // Find timedtext URL - look for the pattern with lang=en first
  const timedtextMatch = html.match(/timedtext\?v=[^"\\]+\\u0026[^"\\]+lang=en[^"\\]*/);

  if (timedtextMatch) {
    let url = timedtextMatch[0].replace(/\\u0026/g, '&');
    return `https://www.youtube.com/api/${url}`;
  }

  // Try to find any timedtext URL
  const anyTimedtext = html.match(/timedtext\?v=[^"\\]+/);
  if (anyTimedtext) {
    let url = anyTimedtext[0].replace(/\\u0026/g, '&');
    return `https://www.youtube.com/api/${url}`;
  }

  return null;
}

// Format transcript to markdown
function formatToMarkdown(transcript, videoUrl, videoId) {
  let markdown = `# YouTube Video Transcript\n\n`;
  markdown += `**Video URL:** ${videoUrl}\n\n`;
  markdown += `**Video ID:** ${videoId}\n\n`;
  markdown += `---\n\n`;
  markdown += `## Transcript\n\n`;

  transcript.forEach((item) => {
    const timestamp = formatTimestamp(item.start * 1000);
    markdown += `**[${timestamp}]** ${item.text}\n\n`;
  });

  return markdown;
}

// Format milliseconds to MM:SS
function formatTimestamp(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// API endpoint to fetch transcript
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

    const captionsUrl = await getCaptionsUrl(videoId);

    if (!captionsUrl) {
      return res.status(404).json({ error: 'No transcript available for this video. The video may not have captions enabled.' });
    }

    console.log('Fetching captions from:', captionsUrl);
    const captionsXml = await fetchUrl(captionsUrl);
    const transcript = parseCaptions(captionsXml);

    if (!transcript || transcript.length === 0) {
      return res.status(404).json({ error: 'No transcript available for this video' });
    }

    const markdown = formatToMarkdown(transcript, url, videoId);

    res.json({
      success: true,
      videoId,
      markdown,
      filename: `transcript-${videoId}.md`
    });

  } catch (error) {
    console.error('Error fetching transcript:', error);
    res.status(500).json({
      error: error.message || 'Failed to fetch transcript. The video may not have captions available.'
    });
  }
});

app.listen(PORT, () => {
  console.log(`YouTube Transcript Scraper running at http://localhost:${PORT}`);
});
