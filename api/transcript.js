import { Innertube } from 'youtubei.js';

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

function formatToMarkdown(transcript, videoUrl, videoId, title) {
  let md = `# ${title || 'YouTube Video Transcript'}\n\n`;
  md += `**Video URL:** ${videoUrl}\n\n`;
  md += `**Video ID:** ${videoId}\n\n`;
  md += `---\n\n## Transcript\n\n`;
  transcript.forEach(item => {
    md += `**[${formatTimestamp(item.start_ms)}]** ${item.text}\n\n`;
  });
  return md;
}

export default async function handler(req, res) {
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

    const youtube = await Innertube.create();
    const info = await youtube.getInfo(videoId);
    const transcriptInfo = await info.getTranscript();

    if (!transcriptInfo?.transcript?.content?.body?.initial_segments) {
      return res.status(404).json({ error: 'No transcript available for this video' });
    }

    const segments = transcriptInfo.transcript.content.body.initial_segments;
    const transcript = segments.map(seg => ({
      text: seg.snippet?.text || '',
      start_ms: parseInt(seg.start_ms) || 0
    })).filter(t => t.text);

    if (transcript.length === 0) {
      return res.status(404).json({ error: 'No transcript available for this video' });
    }

    const title = info.basic_info?.title || 'YouTube Video';
    const markdown = formatToMarkdown(transcript, url, videoId, title);

    return res.status(200).json({
      success: true,
      videoId,
      title,
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
