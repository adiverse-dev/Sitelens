# SiteLens

SiteLens is an AI-ready website auditing backend built with Node.js, Express, and Playwright. It analyzes a website URL, opens the page in a real Chromium browser, captures key technical signals, and returns a structured audit response through an API.

This project is currently in its backend foundation phase. The main goal of this phase is to build a working browser-based audit engine that can later be expanded with accessibility checks, Lighthouse reports, AI recommendations, and a React dashboard.

## Why This Project Matters

Modern websites need to be fast, reliable, accessible, and technically clean. SiteLens is designed to help developers, founders, and teams quickly inspect a website and understand the first layer of issues that may affect user experience.

For recruiters and reviewers, this project demonstrates practical backend engineering skills, API design, browser automation, error tracking, and the ability to build a real-world developer tool from the ground up.

## Current Features

- Website URL analysis through a REST API
- Page title detection
- Full-page screenshot capture
- Console error detection
- Failed network request detection
- Page load time measurement
- JSON response format for easy frontend or dashboard integration

## Tech Stack

- Node.js
- Express.js
- Playwright
- Chromium browser automation
- CORS support

## Project Structure

```text
SiteLens/
  backend/
    server.js          # Express API server and Playwright audit logic
    package.json       # Backend dependencies
    package-lock.json  # Locked dependency versions
    google.png         # Latest generated full-page screenshot
  README.md
```

## How It Works

1. A user sends a website URL to the `/audit` endpoint.
2. The backend launches a Chromium browser using Playwright.
3. SiteLens opens the requested website.
4. While the page loads, it listens for browser console errors and failed network requests.
5. It measures page load time.
6. It reads the page title.
7. It captures a full-page screenshot.
8. It returns the audit result as JSON.

## API Endpoint

### `POST /audit`

Request body:

```json
{
  "url": "https://example.com"
}
```

Example success response:

```json
{
  "success": true,
  "title": "Example Domain",
  "screenshot": "google.png",
  "loadTime": 1234,
  "consoleErrors": [],
  "failedRequests": []
}
```

Example error response:

```json
{
  "success": false,
  "error": "Error message"
}
```

## Getting Started

### 1. Clone or open the project

```bash
cd SiteLens/backend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Install Playwright browsers if needed

```bash
npx playwright install
```

### 4. Start the backend server

```bash
node server.js
```

The server will run on:

```text
http://localhost:5000
```

## Test the API

You can test the endpoint with Postman, Thunder Client, Insomnia, or a terminal request.

Example using curl:

```bash
curl -X POST http://localhost:5000/audit \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://example.com\"}"
```

Example using PowerShell:

```powershell
Invoke-RestMethod -Uri "http://localhost:5000/audit" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"url":"https://example.com"}'
```

## Current Output

SiteLens currently returns:

- `success`: Shows whether the audit completed successfully
- `title`: The detected page title
- `screenshot`: The generated screenshot file name
- `loadTime`: Page load time in milliseconds
- `consoleErrors`: Browser console errors found during page load
- `failedRequests`: Failed network requests with URL and HTTP method

## Current Phase

This version focuses on the backend audit engine. The project is functional and can already analyze live websites, but it is still a work in progress.

The next phase will improve the audit depth, add more structured scoring, and prepare the backend for a complete frontend dashboard.

## Roadmap

- H1 tag analysis
- Image analysis
- Meta description audit
- Lighthouse integration
- Accessibility audit
- AI-powered recommendations
- React dashboard
- Better screenshot file naming
- Audit history storage
- Website health scoring

## Recruiter-Friendly Highlights

This project shows hands-on experience with:

- Building REST APIs with Express.js
- Using Playwright for browser automation
- Capturing real website performance and reliability signals
- Handling asynchronous browser events
- Returning structured API responses
- Designing a scalable foundation for a full-stack SaaS-style product

## Future Vision

The long-term goal of SiteLens is to become a smart website audit platform where a user can enter any URL and receive a clear report about performance, SEO, accessibility, errors, screenshots, and improvement recommendations.

In future versions, AI can be used to convert raw audit data into simple, human-friendly suggestions for developers, business owners, and non-technical users.

## Status

Work in progress. Backend audit engine is currently active and ready for testing.
