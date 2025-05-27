import { TelegramMessage } from "./telegram";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { extractChannelId, sanitizeFilename, getChannelDirectory, ensureDirectoryExists } from "./dataService";
import type { InvestmentData } from "./src/types/index";
import dotenv from "dotenv";
dotenv.config();

/**
 * Call Gemini API through the ESM wrapper script
 */
async function callGeminiAPI(prompt: string, model = "gemini-2.0-flash-lite"): Promise<string> {
  // Create temp files
  const tempDir = path.join(__dirname, 'temp');
  ensureDirectoryExists(tempDir);
  
  const requestId = Date.now().toString();
  const inputFile = path.join(tempDir, `request-${requestId}.json`);
  const outputFile = path.join(tempDir, `response-${requestId}.json`);
  
  // Write prompt to input file
  fs.writeFileSync(inputFile, JSON.stringify({ prompt, model }), 'utf8');
  
  // Invoke the ESM wrapper script
  return new Promise<string>((resolve, reject) => {
    const childProcess = spawn('node', [
      '--no-warnings',
      '--no-deprecation',
      'geminiWrapper.mjs', 
      inputFile, 
      outputFile
    ], {
      env: { ...process.env },
      stdio: 'inherit'
    });
    
    childProcess.on('close', (code: number) => {
      try {
        if (code !== 0) {
          throw new Error(`Gemini wrapper exited with code ${code}`);
        }
        
        // Read response
        const output = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
        
        // Clean up temp files
        try {
          fs.unlinkSync(inputFile);
          fs.unlinkSync(outputFile);
        } catch (e) {
          console.warn("Failed to clean up temp files:", e);
        }
        
        if (!output.success) {
          throw new Error(output.error || "Unknown error in Gemini API call");
        }
        
        resolve(output.response);
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * Retry a function with exponential backoff
 */
async function retry<T>(
  fn: () => Promise<T>, 
  maxRetries: number = 5, 
  initialDelay: number = 2000,
  maxDelay: number = 60000
): Promise<T> {
  let retries = 0;
  let delay = initialDelay;

  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      retries++;
      
      // Check if we've reached max retries or if it's a non-retryable error
      const isRetryable = 
        error?.message?.includes("503") || 
        error?.message?.includes("overloaded") || 
        error?.message?.includes("UNAVAILABLE");
      
      if (retries > maxRetries || !isRetryable) {
        throw error;
      }
      
      // Calculate exponential backoff with jitter
      const jitter = Math.random() * 0.3 + 0.85; // Random between 0.85-1.15
      delay = Math.min(delay * 1.5 * jitter, maxDelay);
      
      console.log(`Gemini API overloaded. Retrying in ${Math.round(delay/1000)} seconds... (Attempt ${retries}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Extract structured investment data from a single message using Gemini
 */
export async function extractInvestmentWithGemini(message: TelegramMessage): Promise<InvestmentData | null> {
  const { text, date } = message;
  
  // Skip messages that don't look like funding announcements
  if (!text.includes('Round') && 
      !text.includes('raised') && 
      !text.includes('acquired') && 
      !text.includes('Funding') && 
      !text.includes('$') && 
      !text.includes('investment')) {
    return null;
  }
  
  // Check if this is likely a weekly roundup
  const isRoundup = /Top\s+\d+|Best\s+Rounds|Notable\s+Rounds|This\s+Week/i.test(text);
  
  // Build a prompt specific to the message type
  const prompt = isRoundup 
    ? buildRoundupPrompt(text)
    : buildInvestmentPrompt(text);

  try {
    // Call Gemini API through wrapper with retry logic
    const response = await retry(() => callGeminiAPI(prompt));
    
    // Process response
    try {
      const jsonStart = response.indexOf("{");
      const jsonEnd = response.lastIndexOf("}") + 1;
      if (jsonStart < 0 || jsonEnd <= jsonStart) {
        console.error("Invalid JSON structure in response:", response);
        return null;
      }
      
      const jsonString = response.substring(jsonStart, jsonEnd);
      const extractedData = JSON.parse(jsonString);
      
      // Standardize the investment data format
      return standardizeInvestmentData(extractedData, text, date, isRoundup);
      
    } catch (err) {
      console.error("Error parsing Gemini response:", err);
      console.error("Response was:", response);
      return null;
    }
  } catch (err) {
    console.error("Error calling Gemini API:", err);
    return null;
  }
}

/**
 * Standardize the investment data format based on the transaction type
 */
function standardizeInvestmentData(
  data: any, 
  rawText: string, 
  date: string, 
  isRoundup: boolean
): InvestmentData {
  // Determine transaction type
  let type: "investment" | "acquisition" | "roundup" = "investment";
  
  if (isRoundup) {
    type = "roundup";
  } else if (
    data.acquisitions || 
    data.acquirer || 
    rawText.toLowerCase().includes("acquired") || 
    rawText.toLowerCase().includes("acquisition")
  ) {
    type = "acquisition";
  }
  
  // Initialize the base investment data
  const investmentData: InvestmentData = {
    company: "",
    type,
    date,
    rawText
  };
  
  // Handle roundup data
  if (type === "roundup") {
    // For weekly roundups, use arrays for company and amount
    if (Array.isArray(data.company) && data.company.length > 0) {
      investmentData.company = data.company;
      
      // If amounts are provided, store them in parallel array
      if (Array.isArray(data.amount) && data.amount.length > 0) {
        // Standardize the format (remove $ and ensure M/B suffix)
        const standardizedAmounts = data.amount.map((amount: string) => {
          if (typeof amount !== 'string') return amount;
          amount = amount.trim();
          return amount.replace('$', '');
        });
        
        investmentData.amount = standardizedAmounts;
      }
    } else {
      // Default roundup company name if no companies extracted
      investmentData.company = "Weekly Investment Roundup";
    }
    
    // Add acquisitions mentioned in roundups
    if (Array.isArray(data.acquisitions) && data.acquisitions.length > 0) {
      investmentData.acquisitionsInRoundup = data.acquisitions.map((acq: any) => ({
        company: acq.company,
        acquirer: acq.acquirer,
        amount: acq.amount ? acq.amount.replace('$', '') : undefined
      }));
    }
    
    investmentData.isPartOfRoundup = true;
  } 
  // Handle acquisition data
  else if (type === "acquisition") {
    // Set the acquired company as the main company
    investmentData.company = data.company || "";
    
    // Handle the acquisition data - it could be in different formats
    if (data.acquisitions && typeof data.acquisitions === 'object') {
      // Prioritize information from the acquisitions field if available
      if (Array.isArray(data.acquisitions)) {
        // Take the first acquisition if it's an array
        if (data.acquisitions.length > 0) {
          investmentData.acquirer = data.acquisitions[0].acquirer;
          if (data.acquisitions[0].amount) {
            investmentData.amount = data.acquisitions[0].amount.replace('$', '');
          }
        }
      } else {
        // Direct object
        investmentData.acquirer = data.acquisitions.acquirer;
        if (data.acquisitions.amount) {
          investmentData.amount = data.acquisitions.amount.replace('$', '');
        }
      }
    } else {
      // Use direct fields if acquisitions field isn't available
      investmentData.acquirer = data.acquirer;
      if (data.amount) {
        investmentData.amount = typeof data.amount === 'string' ? 
          data.amount.replace('$', '') : data.amount;
      }
    }
  } 
  // Handle standard investment data
  else {
    investmentData.company = data.company || "";
    
    if (data.amount) {
      investmentData.amount = typeof data.amount === 'string' ? 
        data.amount.replace('$', '') : data.amount;
    }
    
    if (data.round) {
      investmentData.round = data.round;
    }
    
    if (Array.isArray(data.investors)) {
      investmentData.investors = data.investors;
    }
  }
  
  // Add optional fields if present
  if (data.about) {
    investmentData.about = data.about;
  }
  
  if (data.valuation) {
    investmentData.valuation = typeof data.valuation === 'string' ? 
      data.valuation.replace('$', '') : data.valuation;
  }
  
  // Clean and add links
  if (Array.isArray(data.links) && data.links.length > 0) {
    investmentData.links = cleanLinks(data.links);
  }
  
  return investmentData;
}

/**
 * Clean links to remove any non-URL values
 */
function cleanLinks(links: string[]): string[] {
  return links
    .filter(link => {
      // Filter out non-URLs
      if (!link || typeof link !== 'string') return false;
      
      // Must start with http/https or contain domain extensions
      if (!link.startsWith('http') && 
          !link.includes('.com') && 
          !link.includes('.io') && 
          !link.includes('.org') && 
          !link.includes('.net')) {
        return false;
      }
      
      // Filter out amounts with M or B suffix
      if (/^[\d\.]+M?B?$/.test(link)) return false;
      
      // Filter out company names
      if (/^[A-Za-z0-9\.-]+$/.test(link) && !link.includes('.')) return false;
      
      return true;
    })
    .map(link => {
      // Add https:// if missing
      if (!link.startsWith('http')) {
        return 'https://' + link;
      }
      return link;
    });
}

/**
 * Build prompt for processing standard investment announcements
 */
function buildInvestmentPrompt(text: string): string {
  return `
    Extract precise structured investment data from this crypto fundraising announcement:
    
    1. Format all monetary amounts consistently with the number followed by 'M' for millions or 'B' for billions (e.g., "10.5M" or "1.2B"). Use "Undisclosed" when no amount is specified.
    
    2. For round types, use one of: "Pre-Seed", "Seed", "Angel Round", "Series A", "Series B", "Series C", "Strategic", "Token Sale", "Private Sale", "Funding", or the exact round type mentioned.
    
    3. Extract all investors as an array. If Lead investors are mentioned, include them.
    
    4. For acquisitions, determine which company acquired which.
    
    5. Extract a brief company description from the "About:" section.
    
    6. Extract all URLs mentioned, including cryptorank.io links.
    
    7. Include any valuation information if present.
    
    Return ONLY a valid JSON object with these fields (skip empty ones):
    - company: The name of the company raising funds or being acquired (exact spelling including .io, .fun etc.)
    - amount: Funding amount (format as described)
    - round: The funding round type
    - investors: Array of investor names
    - about: Brief company description
    - valuation: Valuation if mentioned
    - links: Array of URLs mentioned
    - acquisitions: For acquisition announcements only, include {company, acquirer, amount}
    
    Here's the announcement:
    """
    ${text}
    """
  `;
}

/**
 * Build prompt for processing weekly roundup announcements
 */
function buildRoundupPrompt(text: string): string {
  return `
    Extract structured investment data from this weekly crypto funding roundup:
    
    1. Identify each company mentioned along with their funding amount.
    
    2. Format all monetary amounts consistently with the number followed by 'M' for millions or 'B' for billions (e.g., "10.5M" or "1.2B").
    
    3. Identify any acquisitions mentioned. For each acquisition, extract the acquiring company, acquired company, and amount if mentioned.
    
    4. Extract all URLs mentioned in the text.
    
    For these weekly roundups, it's critical to ensure that:
    - 'company' field is always an array containing all company names mentioned
    - 'amount' field is a parallel array with each amount matching the corresponding company
    
    Return ONLY a valid JSON object with these fields:
    - company: Array of company names mentioned with funding
    - amount: Array of corresponding funding amounts in the same order
    - links: Array of all valid URLs mentioned
    - acquisitions: Array of objects with {company, acquirer, amount}
    
    Here's the roundup:
    """
    ${text}
    """
  `;
}

/**
 * Process an array of messages and extract investment data using Gemini
 */
export async function extractInvestmentsWithAI(messages: TelegramMessage[]): Promise<InvestmentData[]> {
  const investments: InvestmentData[] = [];
  
  console.log(`Processing ${messages.length} messages with GenAI...`);
  
  // Process in smaller batches to avoid overwhelming the API
  const batchSize = 5; // Reduce batch size for parallel processing
  let currentDelayMs = 3000; // Start with 3s delay
  
  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize);
    console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(messages.length/batchSize)}`);
    
    try {
      // Process each message sequentially with small delays to avoid rate limits
      for (const message of batch) {
        try {
          const result = await extractInvestmentWithGemini(message);
          if (result !== null && 
              result !== undefined &&
              result.company !== undefined &&
              (
                (typeof result.company === 'string' && result.company.length > 0) ||
                (Array.isArray(result.company) && result.company.length > 0)
              )
          ) {
            investments.push(result);
          }
          
          // Add a small delay between individual messages
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (error) {
          console.error("Error processing message:", error);
          // Increase delay on errors to recover from rate limiting
          currentDelayMs = Math.min(currentDelayMs * 1.5, 30000); // Max 30 seconds
          await new Promise(resolve => setTimeout(resolve, 2000)); // Additional cooldown on error
        }
      }
      
      // Add a longer delay between batches
      if (i + batchSize < messages.length) {
        console.log(`Waiting ${currentDelayMs/1000} seconds before next batch...`);
        await new Promise(resolve => setTimeout(resolve, currentDelayMs));
        
        // Reduce delay gradually if things are going well
        currentDelayMs = Math.max(2000, currentDelayMs * 0.9);
      }
    } catch (batchError) {
      console.error(`Error processing batch:`, batchError);
      // Increase delay on batch errors
      currentDelayMs = Math.min(currentDelayMs * 2, 60000); // Max 60 seconds
      await new Promise(resolve => setTimeout(resolve, currentDelayMs));
    }
  }
  
  return investments;
}

/**
 * Save AI-extracted investment data to file without investmentsByCompany
 */
export async function saveAIInvestmentData(channelId: string, messages: TelegramMessage[]): Promise<string> {
  const channelDirectory = getChannelDirectory(channelId);
  ensureDirectoryExists(channelDirectory);
  
  const sanitizedChannelId = sanitizeFilename(extractChannelId(channelId));
  
  // Extract structured investment data using AI
  const investments = await extractInvestmentsWithAI(messages);
  
  // Create a summary with stats but without investmentsByCompany
  const summary = {
    totalInvestments: investments.length,
    investmentsByType: {
      acquisition: investments.filter(i => i.type === "acquisition").length,
      investment: investments.filter(i => i.type === "investment").length,
      roundup: investments.filter(i => i.type === "roundup").length,
    },
    topInvestors: calculateTopInvestors(investments),
    roundDistribution: calculateRoundDistribution(investments),
    investments: investments
    // investmentsByCompany removed
  };
  
  // Updated filename to include channel ID
  const filePath = path.join(channelDirectory, `${sanitizedChannelId}_investments_genai.json`);
  
  fs.writeFileSync(filePath, JSON.stringify(summary, null, 2), "utf8");
  console.log(`AI-processed investment data saved to ${filePath}`);
  
  return filePath;
}

// Calculate top investors from all investment data
function calculateTopInvestors(investments: InvestmentData[]): Record<string, number> {
  const investorCounts: Record<string, number> = {};
  
  investments.forEach(investment => {
    if (!investment.investors) return;
    
    investment.investors.forEach(investor => {
      if (!investor) return;
      investorCounts[investor] = (investorCounts[investor] || 0) + 1;
    });
  });
  
  // Sort by count and take top 20
  return Object.fromEntries(
    Object.entries(investorCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20)
  );
}

// Calculate round type distribution
function calculateRoundDistribution(investments: InvestmentData[]): Record<string, number> {
  const roundCounts: Record<string, number> = {};
  
  investments.forEach(investment => {
    if (investment.round) {
      roundCounts[investment.round] = (roundCounts[investment.round] || 0) + 1;
    } else if (investment.type === "acquisition") {
      roundCounts["Acquisition"] = (roundCounts["Acquisition"] || 0) + 1;
    } else if (investment.type === "roundup") {
      roundCounts["Roundup"] = (roundCounts["Roundup"] || 0) + 1;
    } else {
      roundCounts["Other"] = (roundCounts["Other"] || 0) + 1;
    }
  });
  
  return roundCounts;
}
