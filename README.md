# YouTube Transcript Scraper

A web-based tool to download YouTube video transcripts in Markdown format.

## Features

- Paste any YouTube URL and fetch its transcript
- Preview the transcript in the browser
- Download as a Markdown file with timestamps
- Supports multiple languages (auto-detection)

## Usage

1. Open the web interface
2. Paste a YouTube video URL
3. Click "Get Transcript"
4. Preview and download the Markdown file

## Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Run the server
python server.py
```

Then open http://localhost:3000

## Deployment

### Railway / Render

The app includes a `Procfile` for easy deployment:

```
web: gunicorn server:app
```

### Environment Variables

No environment variables required.

## Tech Stack

- Python / Flask
- youtube-transcript-api
- Vanilla HTML/CSS/JS frontend
