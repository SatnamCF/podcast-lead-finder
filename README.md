# Podcast Lead Finder

AI-powered web app that finds podcast guest opportunities for coaches based on their niche. Uses Claude API with web search to find real podcast leads with verified contact emails.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env.local` file with your Anthropic API key:
```
ANTHROPIC_API_KEY=your_api_key_here
```

3. Run the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000)

## How It Works

1. Enter a coach's niche (e.g. "Manufacturing leadership, family business succession")
2. Select how many leads you want (10, 25, 50, or 100)
3. Click "Find Leads" — Claude searches the web for relevant podcasts and contact emails
4. View results in a table and download as CSV

## Tech Stack

- Next.js 15 (App Router)
- TypeScript
- Tailwind CSS v4
- Claude API with web search tool

## Deploy on Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/SatnamCF/podcast-lead-finder&env=ANTHROPIC_API_KEY)

Add your `ANTHROPIC_API_KEY` as an environment variable in Vercel project settings.
