from flask import Flask, request, jsonify, send_from_directory
from youtube_transcript_api import YouTubeTranscriptApi
import re
import os

app = Flask(__name__, static_folder='public')

def extract_video_id(url):
    """Extract video ID from YouTube URL"""
    patterns = [
        r'(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)',
        r'^([a-zA-Z0-9_-]{11})$'
    ]

    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None

def format_timestamp(seconds):
    """Format seconds to MM:SS"""
    minutes = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{minutes:02d}:{secs:02d}"

def format_to_markdown(transcript, video_url, video_id):
    """Format transcript to markdown"""
    markdown = f"# YouTube Video Transcript\n\n"
    markdown += f"**Video URL:** {video_url}\n\n"
    markdown += f"**Video ID:** {video_id}\n\n"
    markdown += "---\n\n"
    markdown += "## Transcript\n\n"

    for item in transcript:
        timestamp = format_timestamp(item.start)
        markdown += f"**[{timestamp}]** {item.text}\n\n"

    return markdown

@app.route('/')
def index():
    return send_from_directory('public', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('public', path)

@app.route('/api/transcript', methods=['POST'])
def get_transcript():
    try:
        data = request.get_json()
        url = data.get('url', '').strip()

        if not url:
            return jsonify({'error': 'YouTube URL is required'}), 400

        video_id = extract_video_id(url)

        if not video_id:
            return jsonify({'error': 'Invalid YouTube URL'}), 400

        ytt = YouTubeTranscriptApi()

        # Try to get transcript, try different languages if needed
        transcript = None
        languages = ['en', 'hu', 'de', 'es', 'fr', 'ja', 'ko', 'pt', 'ru', 'zh']

        try:
            transcript = ytt.fetch(video_id)
        except Exception:
            # Try listing available transcripts
            try:
                available = ytt.list(video_id)
                if available:
                    # Get the first available transcript
                    for t in available:
                        try:
                            transcript = t.fetch()
                            break
                        except:
                            continue
            except:
                pass

        if not transcript:
            return jsonify({'error': 'No transcript available for this video'}), 404

        markdown = format_to_markdown(transcript, url, video_id)

        return jsonify({
            'success': True,
            'videoId': video_id,
            'markdown': markdown,
            'filename': f'transcript-{video_id}.md'
        })

    except Exception as e:
        print(f'Error fetching transcript: {e}')
        return jsonify({
            'error': str(e) or 'Failed to fetch transcript. The video may not have captions available.'
        }), 500

if __name__ == '__main__':
    print('YouTube Transcript Scraper running at http://localhost:3000')
    app.run(host='0.0.0.0', port=3000, debug=False)
