import { TelegramMessage } from "./telegram";

// Interface for structured investment data
export interface InvestmentData {
  company: string | string[];  // Single company or array of companies in roundups
  amount?: string | string[];  // Single amount or array of amounts in roundups
  round?: string;   // Seed, Strategic, Series A, etc.
  investors: string[];
  investorDetails?: Record<string, string>; // Store investor descriptions separately
  type: "investment" | "acquisition" | "roundup";
  date: string;
  valuation?: string; // Optional valuation information
  links?: string[];   // Links mentioned in the message
  rawText: string;    // Original message for reference
  isPartOfRoundup?: boolean; // Flag indicating if this was extracted from a roundup post
  acquisitions?: Array<{ company: string, acquirer: string, amount?: string }>; // For acquisition data in roundups
}

/**
 * Extracts URLs from text with improved filtering
 */
function extractLinks(text: string): string[] {
  // More restrictive regex to avoid matching amounts and company names
  const urlRegex = /(https?:\/\/[^\s]+)|(\bwww\.[^\s]+)|([a-zA-Z0-9][-a-zA-Z0-9]{0,62}\.(?:com|io|org|net|finance|xyz|app|dev|eth|crypto|nft|fund)[^\s)*,;:!]?)/gi;
  const matches = text.match(urlRegex) || [];
  
  // Filter and clean the URLs
  return matches
    .filter(url => {
      // Exclude amounts like "32.0M", "2.5M", etc.
      if (/^\d+(\.\d+)?M?B?$/.test(url)) return false;
      
      // Exclude common non-URL patterns
      if (url === "T-Rex" || url === "others." || url === "etc." || url === "e.g.") return false;
      
      // Make sure it's likely a URL
      return url.includes('.') && !url.includes('@');
    })
    .map(url => {
      // Add https:// if missing
      if (!url.startsWith('http')) {
        return 'https://' + url;
      }
      return url;
    });
}

/**
 * Clean and extract just the investor name from text that might include description
 */
function cleanInvestorName(investor: string): { name: string, description?: string } {
  // Check if there's a comma or description separator
  const commaIndex = investor.indexOf(',');
  const descriptionSeparators = [' - ', ' is ', ' a ', ' forms ', ' builds '];
  
  let separatorIndex = commaIndex !== -1 ? commaIndex : -1;
  let separatorType = 'comma';
  
  // Look for other separators if no comma was found or if comma is far into the text
  for (const separator of descriptionSeparators) {
    const index = investor.indexOf(separator);
    if (index !== -1 && (separatorIndex === -1 || index < separatorIndex)) {
      separatorIndex = index;
      separatorType = separator;
    }
  }
  
  // If we found a separator
  if (separatorIndex !== -1) {
    const name = investor.substring(0, separatorIndex).trim();
    const description = investor.substring(
      separatorIndex + (separatorType === 'comma' ? 1 : separatorType.length)
    ).trim();
    
    return { name, description };
  }
  
  // No separator found, just return the cleaned name
  return { name: investor.trim() };
}

/**
 * Check if the text is a weekly roundup summary
 */
function isWeeklyRoundup(text: string): boolean {
  const roundupIndicators = [
    /Top\s+\d+\s+.*Rounds\s+of\s+This\s+Week/i,
    /Best\s+Rounds\s+Of\s+This\s+Week/i,
    /Notable\s+Rounds\s+of\s+This\s+Week/i,
    /Funding\s+Rounds\s+Of\s+.*Week/i,
    /Rounds\s+Of\s+.*Week/i,
    /Best\s+Funding\s+Rounds\s+Of/i
  ];
  
  return roundupIndicators.some(pattern => pattern.test(text));
}

/**
 * Parse weekly roundup message and extract as a single investment object with arrays
 */
function parseWeeklyRoundup(message: TelegramMessage): InvestmentData {
  const { text, date } = message;
  
  // Arrays to collect all companies and amounts
  const companies: string[] = [];
  const amounts: string[] = [];
  const acquisitions: Array<{ company: string, acquirer: string, amount?: string }> = [];
  
  // Extract special mentions like BVNK/Visa
  const specialInvestments: Array<{ company: string, investor: string, description?: string }> = [];
  
  // Check for special mentions first
  if (text.includes("BVNK") && text.includes("Visa")) {
    specialInvestments.push({
      company: "BVNK",
      investor: "Visa",
      description: "stablecoin infrastructure"
    });
  }
  
  // Extract lines that match funding patterns
  const lines = text.split('\n');
  
  // Common patterns for funding line items in summaries
  // These can appear as "Company - $10M" or "Company – $10M" or "Company: $10M"
  const patterns = [
    /([^-–:$\n]+)\s*[-–:]\s*\$?([\d\.]+)M?B?/i,  // CompanyName - $10M
    /([^-–:$\n]+)\s*[-–:]\s*\$?([\d\.]+)M?B?/i,  // CompanyName – $10M (en dash)
    /([^-–:$\n]+)\s*[-–:]\s*\$?([\d\.]+)M?B?/i,  // CompanyName - $10.5M
    /([^\s]+)\s+\$?([\d\.]+)M?B?/i               // CompanyName $10M
  ];

  // Try to find acquisition mentions in the entire text
  const acquisitionRegex = /(\w+)\s+acquired\s+(\w+)(?:\s+for\s+\$?([\d\.]+)B?M?)?/gi;
  let acquisitionMatch;
  
  while ((acquisitionMatch = acquisitionRegex.exec(text)) !== null) {
    const acquirer = acquisitionMatch[1].trim();
    const acquired = acquisitionMatch[2].trim();
    let amount = undefined;
    
    if (acquisitionMatch[3]) {
      amount = acquisitionMatch[3] + (acquisitionMatch[0].toLowerCase().includes('b') ? 'B' : 'M');
    }
    
    acquisitions.push({
      company: acquired,
      acquirer: acquirer,
      amount
    });
  }
  
  // Process each line for company-amount pairs
  for (const line of lines) {
    // Skip lines that are too short or likely headers
    if (line.length < 5 || line.includes('Round') || line.includes('Week') || line.includes('Total')) {
      continue;
    }
    
    // Clean the line of any special characters at the beginning
    const cleanLine = line.replace(/^[^\w]+/, '').trim();
    
    // Try each pattern to see if it matches
    let matched = false;
    for (const pattern of patterns) {
      const match = cleanLine.match(pattern);
      if (match) {
        // Get full company name by handling multi-word names properly
        const dollarIndex = cleanLine.indexOf('$');
        let company = match[1].trim();
        
        // If the company is "T" but the line contains "T-Rex", use "T-Rex" instead
        if (company === "T" && cleanLine.includes("T-Rex")) {
          company = "T-Rex";
        }
        
        // Handle multi-word company names
        if (dollarIndex > 0) {
          const possibleFullName = cleanLine.substring(0, dollarIndex).trim();
          if (possibleFullName.length > company.length && possibleFullName.startsWith(company)) {
            company = possibleFullName;
          }
        }
        
        const amountValue = match[2];
        // Add B or M suffix as appropriate
        const amount = amountValue + (cleanLine.toLowerCase().includes('b') ? 'B' : 'M');
        
        // Skip if we already have this company
        if (!companies.includes(company)) {
          companies.push(company);
          amounts.push(amount);
        }
        
        matched = true;
        break;
      }
    }
    
    // If no pattern matched, try to extract in a more general way
    if (!matched && cleanLine.includes('$') && /\d+/.test(cleanLine)) {
      // Look for a company name before the dollar amount
      const dollarIndex = cleanLine.indexOf('$');
      if (dollarIndex > 2) { // Ensure there's some text before the dollar sign
        const possibleCompany = cleanLine.substring(0, dollarIndex).trim();
        
        // Extract the company name - handle multi-word names
        let company = "";
        const companyWords = possibleCompany.split(/\s+/);
        if (companyWords.length > 0) {
          // For company names like "Alt DRX", "T-Rex", etc.
          if (companyWords.length >= 2 && 
              (companyWords[0] === "Alt" || 
               companyWords[0] === "T" || 
               /^[A-Z][a-z]*$/.test(companyWords[0]))) {
            company = companyWords.slice(0, 2).join(' ');
          } else {
            company = companyWords[0];
          }
        }
        
        if (company && company.length > 1) {
          // Extract the amount
          const amountMatch = cleanLine.match(/\$\s?([\d\.]+)M?B?/i);
          if (amountMatch) {
            const amountValue = amountMatch[1];
            const amount = amountValue + (cleanLine.toLowerCase().includes('b') ? 'B' : 'M');
            
            if (!companies.includes(company)) {
              companies.push(company);
              amounts.push(amount);
            }
          }
        }
      }
    }
  }
  
  // Extract properly filtered links from the message
  const links = cleanLinks(extractLinks(text));
  
  // Create a single investment object containing all companies and amounts as arrays
  return {
    company: companies,
    amount: amounts,
    investors: [],
    type: "roundup", // Use a specific type for roundups
    date,
    links,
    rawText: text,
    isPartOfRoundup: true,
    acquisitions: acquisitions.length > 0 ? acquisitions : undefined
  };
}

/**
 * Extract the real company name from the message text
 * Modified to better handle company names with dots (.fun, .io, etc.)
 */
function extractCompanyName(text: string, isAcquisition: boolean): string {
  // First try to extract from the title line
  const firstLine = text.split('\n')[0].trim();
  
  // Try to match pattern: CompanyName $XXM Round Type
  const titleMatchWithAmount = firstLine.match(/​​([^$\s]+(?:\.[^\s]+)?)\s+\$?([\d\.]+)M?\s+([A-Za-z\-]+(?:\s+[A-Za-z]+)?)\s+Round/i);
  if (titleMatchWithAmount) {
    return titleMatchWithAmount[1].trim();
  }
  
  // Try to match pattern: CompanyName Round Type Round
  const titleMatchWithRound = firstLine.match(/​​([^$\s]+(?:\.[^\s]+)?)\s+([A-Za-z\-]+(?:\s+[A-Za-z]+)?)\s+Round/i);
  if (titleMatchWithRound) {
    return titleMatchWithRound[1].trim();
  }
  
  // Extract from "About:" section
  const aboutMatch = text.match(/About:\s*\n([^\n]+)/);
  if (aboutMatch) {
    const aboutText = aboutMatch[1];
    // First phrase in the About section is usually the company
    const companyPattern = /^([^\.]+\.[^\s]+|[^\s]+)\s+is\s+/i;
    const companyMatch = aboutText.match(companyPattern);
    if (companyMatch) {
      return companyMatch[1].trim();
    }
    
    // If no match, just take the first term which is often the company name
    const firstTerm = aboutText.split(/\s+/)[0];
    if (firstTerm && firstTerm.length > 1) {
      return firstTerm.trim();
    }
  }
  
  // For acquisitions, use a different approach
  if (isAcquisition) {
    const acquisitionMatch = text.match(/has acquired\s+([^\s\n]+)/i);
    if (acquisitionMatch) {
      return acquisitionMatch[1].trim();
    }
    
    // Try alternate format
    const altMatch = text.match(/([^\n]+)\s+acquired by:/i);
    if (altMatch) {
      return altMatch[1].trim();
    }
    
    // General case - text before the word "has acquired"
    const generalMatch = text.match(/([^\s\n]+)\s+has acquired/i);
    if (generalMatch) {
      return generalMatch[1].trim();
    }
  }

  // Last resort: first line of the message, which typically contains company name
  if (firstLine) {
    // Get the first word after the emoji symbols (potentially with domain suffix)
    const cleanedFirstLine = firstLine.replace(/^​​/, '').trim();
    const firstWordMatch = cleanedFirstLine.match(/^([^$\s]+(?:\.[^\s]+)?)/);
    if (firstWordMatch && firstWordMatch[1].length > 1) {
      return firstWordMatch[1];
    }
  }
  
  return "";
}

/**
 * Extract round type from text with improved detection
 */
function extractRoundType(text: string): string | undefined {
  // Check the first line first (highest priority)
  const firstLine = text.split('\n')[0].trim();
  
  // Try exact match for full round name in first line
  if (firstLine.includes("Angel Round")) return "Angel Round";
  if (firstLine.includes("Pre-Seed Round")) return "Pre-Seed";
  if (firstLine.includes("Seed Round")) return "Seed";
  if (firstLine.includes("Series A Round")) return "Series A";
  if (firstLine.includes("Series B Round")) return "Series B";
  if (firstLine.includes("Series C Round")) return "Series C";
  if (firstLine.includes("Strategic Round")) return "Strategic";
  if (firstLine.includes("Funding Round")) return "Funding";
  if (firstLine.includes("Pre-Series A Round")) return "Pre-Series A";
  if (firstLine.includes("Private Round")) return "Private Round";
  if (firstLine.includes("Private Token Sale")) return "Token Sale";
  if (firstLine.includes("Token Sale")) return "Token Sale";
  
  // Define all possible round types with their regex patterns
  const roundTypeMatches = [
    { regex: /Pre-Seed\s+Round/i, value: "Pre-Seed" },
    { regex: /Seed\s+Round/i, value: "Seed" },
    { regex: /Series\s+A\s+Round/i, value: "Series A" },
    { regex: /Series\s+B\s+Round/i, value: "Series B" },
    { regex: /Series\s+C\s+Round/i, value: "Series C" },
    { regex: /Strategic\s+Round/i, value: "Strategic" },
    { regex: /Funding\s+Round/i, value: "Funding" },
    { regex: /Extended\s+Series\s+A/i, value: "Series A" },
    { regex: /Pre-Series\s+A/i, value: "Pre-Series A" },
    { regex: /Angel\s+Round/i, value: "Angel Round" },
    { regex: /Private\s+Round/i, value: "Private Round" },
    { regex: /Private\s+Sale/i, value: "Private Sale" },
    { regex: /Token\s+Sale/i, value: "Token Sale" },
    { regex: /Series\s+A/i, value: "Series A" },
    { regex: /Series\s+B/i, value: "Series B" },
    { regex: /Series\s+C/i, value: "Series C" }
  ];
  
  // Check entire text
  for (const match of roundTypeMatches) {
    if (match.regex.test(text)) {
      return match.value;
    }
  }

  return undefined;
}

/**
 * Extract funding amount from text with better handling of edge cases
 */
function extractFundingAmount(text: string): string {
  // Check first line for dollar amount format
  const firstLine = text.split('\n')[0].trim();
  
  // Handle explicit dollar amount in first line
  const firstLineDollarMatch = firstLine.match(/\$\s*([\d\.]+)\s*(M|B)/i);
  if (firstLineDollarMatch) {
    return firstLineDollarMatch[1] + firstLineDollarMatch[2].toUpperCase();
  }
  
  // Handle patterns like "$750K" - convert to millions
  const kMatch = firstLine.match(/\$\s*([\d\.]+)\s*K/i);
  if (kMatch) {
    const amountInM = (parseFloat(kMatch[1]) / 1000).toFixed(2);
    return amountInM + 'M';
  }
  
  // Try to find $XXM format in whole text
  const dollarMatch = text.match(/\$\s*([\d\.]+)\s*(M|B)/i);
  if (dollarMatch) {
    return dollarMatch[1] + dollarMatch[2].toUpperCase();
  }
  
  // Try to find "Undisclosed" mentions
  if (text.toLowerCase().includes('undisclosed')) {
    return 'Undisclosed';
  }
  
  // Default to Undisclosed if no amount is found
  return 'Undisclosed';
}

/**
 * Remove duplicate links and filter out non-links
 */
function cleanLinks(links: string[]): string[] {
  // First pass: identify real links vs. numbers/company names
  const validLinks = links.filter(link => {
    // Filter out all numeric-only items
    if (/^[\d\.]+M?B?$/.test(link)) return false;
    
    // Filter out known company names that might be caught as links
    if (['Turtle.Club', 'Boop.fun', 'T-Rex'].includes(link)) return false;
    
    // Must start with http or have a valid domain suffix
    return link.startsWith('http') || 
           link.includes('.io') || 
           link.includes('.com') || 
           link.includes('.org');
  });
  
  // Second pass: ensure proper formatting and remove duplicates
  const uniqueLinks = new Set<string>();
  
  validLinks.forEach(link => {
    // Add http/https if missing
    if (!link.startsWith('http')) {
      link = 'https://' + link;
    }
    
    uniqueLinks.add(link);
  });
  
  return Array.from(uniqueLinks);
}

/**
 * Parses a Telegram message to extract structured investment data
 */
export function parseInvestmentData(message: TelegramMessage): InvestmentData | null {
  const { text, date } = message;
  
  // Skip messages that don't look like funding announcements
  if (!text.includes('Round') && !text.includes('acquired') && !text.includes('Funding') && !text.includes('$')) {
    return null;
  }

  // Check if this is a weekly roundup message
  if (isWeeklyRoundup(text)) {
    return parseWeeklyRoundup(message);
  }

  // Check if this is a monthly roundup (similar format to weekly)
  if (text.includes("Funding Rounds Of") && (text.includes("April") || text.includes("May") || text.includes("June"))) {
    return parseWeeklyRoundup(message); // Use same parser for monthly roundups
  }

  // Regular processing for standard funding announcement
  // Determine if this is an acquisition or investment
  const isAcquisition = text.includes('acquired') || text.includes('acquisition');
  const type = isAcquisition ? "acquisition" : "investment";
  
  // Extract company name using our dedicated function
  let company = extractCompanyName(text, isAcquisition);
  
  // If we couldn't find a company name, this might not be a proper funding announcement
  if (!company) {
    return null;
  }
  
  // Clean up company name
  // Handle special cases for "Alt DRX" where we might just get "Alt"
  if (company === "Alt" && text.includes("Alt DRX")) {
    company = "Alt DRX";
  }
  
  // Extract funding amount using our dedicated function
  const amount = extractFundingAmount(text);
  
  // Extract round type using dedicated function
  let round = extractRoundType(text);
  
  // Handle special case for Alt DRX's round type
  if (company === "Alt DRX" && text.includes("Pre-Series A")) {
    round = "Pre-Series A";
  }
  
  // Extract investors with descriptions
  let investorEntries: { name: string, description?: string }[] = [];
  const investorDetails: Record<string, string> = {};
  
  if (text.includes('Investor:') || text.includes('Investors:')) {
    const investorSection = text.split(/Investor[s]?:/)[1]?.split(/\n\n|👉/)[0];
    if (investorSection) {
      // Split by commas, "and", or new lines
      const rawInvestors = investorSection
        .split(/,|\sand\s|\n/)
        .map(i => i.replace(/\(Lead\)/g, '').trim())
        .filter(i => i && i.length > 1);
      
      investorEntries = rawInvestors.map(inv => cleanInvestorName(inv));
    }
  } else if (isAcquisition) {
    const acquiredBySection = text.split(/Acquired by:/i)[1]?.split(/\n\n|👉/)[0];
    if (acquiredBySection) {
      const cleaned = cleanInvestorName(acquiredBySection.trim());
      investorEntries = [cleaned];
    }
  }
  
  // Extract just the names and save descriptions separately
  const investors = investorEntries.map(entry => entry.name);
  investorEntries.forEach(entry => {
    if (entry.description) {
      investorDetails[entry.name] = entry.description;
    }
  });
  
  // Extract valuation if available
  let valuation: string | undefined;
  const valuationMatch = text.match(/Valuation:\s+\$?([\d\.]+)M/i);
  if (valuationMatch) {
    valuation = '$' + valuationMatch[1] + 'M';
  }
  
  // Extract all links from the message and clean them
  const links = cleanLinks(extractLinks(text));
  
  return {
    company,
    amount,
    round,
    investors,
    investorDetails: Object.keys(investorDetails).length > 0 ? investorDetails : undefined,
    type,
    date,
    valuation,
    links: links.length > 0 ? links : undefined,
    rawText: text
  };
}

/**
 * Processes an array of messages and extracts investment data
 */
export function extractInvestmentData(messages: TelegramMessage[]): InvestmentData[] {
  const investments: InvestmentData[] = [];
  
  for (const message of messages) {
    try {
      const result = parseInvestmentData(message);
      
      if (result && (typeof result.company === 'string' ? result.company : result.company.length > 0)) {
        investments.push(result);
      }
    } catch (error) {
      console.error("Error parsing message:", error);
      // Continue processing other messages even if one fails
    }
  }
  
  return investments;
}

/**
 * Groups investment data by various categories for analysis
 */
export function organizeInvestmentData(investments: InvestmentData[]) {
  // Group by company
  const byCompany: Record<string, InvestmentData[]> = {};
  
  // Group by investor
  const byInvestor: Record<string, InvestmentData[]> = {};
  
  // Group by round
  const byRound: Record<string, InvestmentData[]> = {};
  
  // Group roundups separately
  const roundups: InvestmentData[] = [];
  
  // Process each investment
  investments.forEach(investment => {
    // Handle roundups separately
    if (investment.type === "roundup" || investment.isPartOfRoundup) {
      roundups.push(investment);
      return;
    }
    
    // Process regular investments
    const companyName = investment.company as string;
    
    // Add to company group
    if (companyName) {
      if (!byCompany[companyName]) {
        byCompany[companyName] = [];
      }
      byCompany[companyName].push(investment);
    }
    
    // Add to investor groups
    investment.investors.forEach(investor => {
      if (!byInvestor[investor]) {
        byInvestor[investor] = [];
      }
      byInvestor[investor].push(investment);
    });
    
    // Add to round group
    const roundType = investment.round || (investment.type === 'acquisition' ? 'Acquisition' : 'Unknown');
    if (!byRound[roundType]) {
      byRound[roundType] = [];
    }
    byRound[roundType].push(investment);
  });
  
  return {
    byCompany,
    byInvestor,
    byRound,
    roundups
  };
}