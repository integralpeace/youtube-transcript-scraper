import { YoutubeTranscript } from 'youtube-transcript';

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

function formatTimestamp(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatToMarkdown(transcript, videoUrl, videoId) {
  let md = `# YouTube Video Transcript\n\n`;
  md += `**Video URL:** ${videoUrl}\n\n`;
  md += `**Video ID:** ${videoId}\n\n`;
  md += `---\n\n## Transcript\n\n`;
  transcript.forEach(item => {
    md += `**[${formatTimestamp(item.offset)}]** ${item.text}\n\n`;
  });
  return md;
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

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

    let transcript;
    try {
      transcript = await YoutubeTranscript.fetchTranscript(videoId);
    } catch (e) {
      // Try with language options
      try {
        transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
      } catch (e2) {
        return res.status(404).json({
          error: 'No transcript available for this video. The video may not have captions enabled.'
        });
      }
    }

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
}
