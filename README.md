# Mentibus - Crypto Investment Data Extraction

Mentibus is a sophisticated toolkit for extracting, analyzing, and structuring cryptocurrency investment data from Telegram channels. It automatically processes fundraising announcements, investments, acquisitions, and weekly roundups to create structured data for analysis and tracking.

## Purpose

This project aims to:

- Extract and structure cryptocurrency fundraising data from Telegram channels
- Provide clean, organized data about investments, acquisitions, and funding rounds
- Enable data-driven insights into crypto funding trends and investor activities
- Create machine-readable datasets for further analysis or integration with other tools

## Supported Sources

Currently supported data sources:

- Telegram channels (e.g., `cryptorank_fundraising`, `crypto_fundraising`)

## Methodology

Mentibus employs a multi-stage approach to extract and structure data:

1. **Data Collection**: Fetches messages from Telegram channels using the official Telegram API
2. **Data Processing**:
   - Basic NLP analysis to identify entities, themes, and keywords
   - Specialized parsers for investment announcements
   - AI-powered extraction using Google's Gemini API
3. **Data Storage**: Saves structured data in JSON format with statistics and summaries
4. **Error Handling**: Implements retry mechanisms, rate limiting, and timeout management

## Methods Used

### 1. Rule-Based Extraction

Uses custom-built parsers with regular expressions and pattern matching to extract structured data from text messages. This approach is implemented in `investmentParser.ts`.

### 2. NLP-Based Extraction

Leverages natural language processing libraries like `compromise` and `natural` to identify entities, themes, and keywords in the text. This approach is implemented in `nlpService.ts`.

### 3. AI-Powered Extraction

Uses Google's Gemini API to extract structured data with a more sophisticated understanding of context and language. This approach is implemented in `genAI.ts`.

### 4. Batch Processing

Handles large datasets by processing messages in batches with appropriate rate limiting and checkpointing, implemented in `processBulkMessages.ts` and `checkpointSystem.ts`.

## Comparison of Methods

| Method | Advantages | Disadvantages |
|--------|------------|---------------|
| **Rule-Based** | - Fast execution<br>- No API costs<br>- Predictable behavior<br>- Works offline | - Limited flexibility<br>- Brittle to format changes<br>- Manual maintenance<br>- Difficult to handle edge cases |
| **NLP-Based** | - Better understanding of text<br>- Can extract implicit entities<br>- More adaptable to variations | - Moderate complexity<br>- Limited contextual understanding<br>- Requires training data<br>- Language-specific models |
| **AI-Powered** | - Superior contextual understanding<br>- Handles variations and edge cases<br>- Extracts structured data from complex text<br>- Less maintenance | - API costs<br>- Rate limits<br>- Latency<br>- Potential hallucinations<br>- Dependency on third-party service |
| **Batch Processing** | - Handles large volumes<br>- Checkpointing for reliability<br>- Rate limiting for stability | - More complex implementation<br>- Higher memory requirements<br>- Longer processing times |

## Input Format

The system takes Telegram messages as input. Each message typically contains:

- Text announcement of investment, acquisition, or funding round
- Company name
- Funding amount
- Investor names
- Round type
- Company description
- URLs and other metadata

Example:

```
{
  "text": "🚀 Exciting News! We've just closed a $1.5M funding round for our project!",
  "company_name": "Innovative Crypto Solutions",
  "funding_amount": 1500000,
  "investor_names": ["Alice Johnson", "Bob Smith"],
  "round_type": "Seed",
  "company_description": "We provide innovative solutions in the crypto space.",
  "metadata": {
    "url": "https://example.com",
    "date": "2023-10-01"
  }
}
```

## Output Format

The system outputs JSON files with structured data:

1. Raw Message Data
2. Structured Investment Data

## Setup and Usage

Install dependencies:

```bash
npm install
```

Set up environment variables in `.env`:

```
TELEGRAM_API_ID=your_tg_app_id
TELEGRAM_API_HASH=your_tg_app_hash
TELEGRAM_PHONE=your_phone_number
TELEGRAM_SESSION=generated_session_id
GEMINI_API_KEY=your_gemini_api_key
```

Run the application:

For NLP generated processing
```bash
npm start
```
For GenAI generated processing
```bash
npm start-genai
```

## Future Scope

### Automated Updates

- Implement a scheduled job system to automatically fetch and process new messages
- Create a daemon process that monitors channels for real-time updates
- Implement a webhook system to trigger processing when new messages arrive

### Data Integration

- Add export functionality to CSV/Excel formats
- Develop Google Sheets auto-sync capability to automatically update spreadsheets
- Create a REST API to expose the structured data to other applications
- Implement database storage (MongoDB/PostgreSQL) for more efficient querying

### Enhanced Analysis

- Add trend analysis and visualization components
- Implement machine learning for investment pattern recognition
- Create anomaly detection for unusual funding activity
- Develop prediction models for funding trends

### Platform Expansion

- Support additional data sources (Twitter, Discord, etc.)
- Create a web dashboard for monitoring and visualization
- Develop alerts for significant funding events
- Implement custom filters and personalized tracking

## License

This project is licensed under the ISC License.