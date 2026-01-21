from http.server import BaseHTTPRequestHandler
from youtube_transcript_api import YouTubeTranscriptApi
import json
import re

def extract_video_id(url):
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
    minutes = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{minutes:02d}:{secs:02d}"

def format_to_markdown(transcript, video_url, video_id):
    markdown = f"# YouTube Video Transcript\n\n"
    markdown += f"**Video URL:** {video_url}\n\n"
    markdown += f"**Video ID:** {video_id}\n\n"
    markdown += "---\n\n"
    markdown += "## Transcript\n\n"
    for item in transcript:
        timestamp = format_timestamp(item.start)
        markdown += f"**[{timestamp}]** {item.text}\n\n"
    return markdown

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)

        try:
            data = json.loads(post_data.decode('utf-8'))
            url = data.get('url', '').strip()

            if not url:
                self.send_response(400)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'YouTube URL is required'}).encode())
                return

            video_id = extract_video_id(url)

            if not video_id:
                self.send_response(400)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Invalid YouTube URL'}).encode())
                return

            ytt = YouTubeTranscriptApi()
            transcript = None

            try:
                transcript = ytt.fetch(video_id)
            except Exception:
                try:
                    available = ytt.list(video_id)
                    if available:
                        for t in available:
                            try:
                                transcript = t.fetch()
                                break
                            except:
                                continue
                except:
                    pass

            if not transcript:
                self.send_response(404)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'No transcript available for this video'}).encode())
                return

            markdown = format_to_markdown(transcript, url, video_id)

            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'success': True,
                'videoId': video_id,
                'markdown': markdown,
                'filename': f'transcript-{video_id}.md'
            }).encode())

        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())
