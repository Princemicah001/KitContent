# KitContent

KitContent is a minimalist, reliable content-generation studio for creating original, visually consistent social media posts focused on psychology and human behavior.

## Requirements
- Node.js 18+
- SQLite
- Gemini API Key

## Installation
```bash
npm install
```

## Environment Variables
Create a `.env` file based on `.env.example`:
```
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-2.5-flash
IMAGE_PROVIDER=pollinations
PORT=3000
```

## How to Start
```bash
npm start
```
For development:
```bash
npm run dev
```

## How to Generate Posts
1. Open the dashboard in your browser (default `http://localhost:3000`).
2. Click "GENERATE 10 POSTS".
3. The system will create unique content candidates, validate them, generate background images, compose 1080x1920 PNG files, and display them in the dashboard.

## Duplicate Detection
KitContent prevents repeated content by comparing newly generated candidate posts (topic, hook, body, takeaway) against all previously generated posts using a lightweight text similarity algorithm. If a candidate is too similar (score >= 0.78), it is rejected and a new candidate is requested.

## Image Generation
Background images are dynamically generated via an image provider. The content is translated into a cinematic editorial image prompt which is requested from the provider.
To change the image provider, update `IMAGE_PROVIDER` in `.env` (currently supports `pollinations`).

## Troubleshooting
- **IMAGE PROVIDER NOT AVAILABLE**: The configured image provider is not responding or not configured correctly. Check your `.env` settings.
- **Database errors**: Ensure the `data` directory exists and has write permissions.
- **Generation fails**: Check the server logs for detailed API or rate limit errors.
