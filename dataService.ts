import fs from "fs";
import path from "path";
import { TelegramMessage } from "./telegram";
import { extractInvestmentData, InvestmentData } from "./investmentParser";

// Ensure directory exists, now with support for nested paths
export function ensureDirectoryExists(dirPath: string = "./data"): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Created directory: ${dirPath}`);
  }
}

// Extract channel ID from URL or handle direct channel name
export function extractChannelId(channel: string): string {
  let channelId = channel;
  
  // Extract from t.me URL format
  if (channel.includes("t.me/")) {
    channelId = channel.split("t.me/")[1].split("/")[0];
  } 
  // Extract from https://telegram.me format
  else if (channel.includes("telegram.me/")) {
    channelId = channel.split("telegram.me/")[1].split("/")[0];
  }
  
  // Remove any @ prefix if present
  if (channelId.startsWith("@")) {
    channelId = channelId.substring(1);
  }
  
  return channelId;
}

// Sanitize filename to avoid filesystem issues
export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9_-]/g, "_");
}

// Get channel-specific directory path
export function getChannelDirectory(channelId: string): string {
  const sanitizedChannelId = sanitizeFilename(extractChannelId(channelId));
  return path.join("./data", sanitizedChannelId);
}

// Save messages to file
export function saveMessagesToFile(channelId: string, messages: TelegramMessage[]): string {
  const channelDirectory = getChannelDirectory(channelId);
  ensureDirectoryExists(channelDirectory);
  
  const sanitizedChannelId = sanitizeFilename(extractChannelId(channelId));
  // Updated filename to include channel ID
  const filePath = path.join(channelDirectory, `${sanitizedChannelId}.json`);
  
  fs.writeFileSync(filePath, JSON.stringify(messages, null, 2), "utf8");
  console.log(`Messages saved to ${filePath}`);
  
  // Create a summary file with extracted entities
  const summaryData = {
    totalMessages: messages.length,
    companies: extractUniqueEntities(messages, 'companies'),
    protocols: extractUniqueEntities(messages, 'protocols'),
    themes: extractUniqueEntities(messages, 'themes'),
    topKeywords: calculateTopKeywords(messages)
  };
  
  // Updated filename to include channel ID
  const summaryPath = path.join(channelDirectory, `${sanitizedChannelId}_summary.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summaryData, null, 2), "utf8");
  console.log(`Summary saved to ${summaryPath}`);
  
  // Save investment data
  saveInvestmentData(channelId, messages);
  
  return filePath;
}

// Save investment data to its own file in the channel directory
export function saveInvestmentData(channelId: string, messages: TelegramMessage[]): string {
  const channelDirectory = getChannelDirectory(channelId);
  ensureDirectoryExists(channelDirectory);
  
  const sanitizedChannelId = sanitizeFilename(extractChannelId(channelId));
  
  // Extract structured investment data
  const investments = extractInvestmentData(messages);
  
  // Group investments by company for easier analysis
  const investmentsByCompany: Record<string, InvestmentData[]> = {};
  
  investments.forEach(investment => {
    // Handle both string and array company names
    if (!investment.company) return;
    
    const companyNames = Array.isArray(investment.company) 
      ? investment.company 
      : [investment.company];
      
    companyNames.forEach(company => {
      if (!company) return;
      
      if (!investmentsByCompany[company]) {
        investmentsByCompany[company] = [];
      }
      
      investmentsByCompany[company].push(investment);
    });
  });
  
  // Create a summary with stats
  const summary = {
    totalInvestments: investments.length,
    investmentsByType: {
      acquisition: investments.filter(i => i.type === "acquisition").length,
      investment: investments.filter(i => i.type === "investment").length,
      roundup: investments.filter(i => i.type === "roundup").length,
    },
    topInvestors: calculateTopInvestors(investments),
    roundDistribution: calculateRoundDistribution(investments),
    investments: investments,
    investmentsByCompany: investmentsByCompany
  };
  
  // Updated filename to include channel ID
  const filePath = path.join(channelDirectory, `${sanitizedChannelId}_investments.json`);
  
  fs.writeFileSync(filePath, JSON.stringify(summary, null, 2), "utf8");
  console.log(`Investment data saved to ${filePath}`);
  
  return filePath;
}

// Calculate top investors from all investment data
function calculateTopInvestors(investments: InvestmentData[]): Record<string, number> {
  const investorCounts: Record<string, number> = {};
  
  investments.forEach(investment => {
    investment.investors.forEach(investor => {
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

// Extract unique entities from all messages
function extractUniqueEntities(messages: TelegramMessage[], entityType: 'companies' | 'protocols' | 'themes'): string[] {
  const allEntities = new Set<string>();
  
  messages.forEach(message => {
    if (message.entities && message.entities[entityType]) {
      message.entities[entityType].forEach(entity => allEntities.add(entity));
    }
  });
  
  return Array.from(allEntities);
}

// Calculate top keywords
function calculateTopKeywords(messages: TelegramMessage[]): Record<string, number> {
  const keywordCount: Record<string, number> = {};
  
  messages.forEach(message => {
    if (message.entities && message.entities.keywords) {
      message.entities.keywords.forEach(keyword => {
        keywordCount[keyword] = (keywordCount[keyword] || 0) + 1;
      });
    }
  });
  
  // Sort by frequency
  return Object.fromEntries(
    Object.entries(keywordCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 30) // Top 30 keywords
  );
}

// Read messages from file
export function readMessagesFromFile(channelId: string): TelegramMessage[] | null {
  const channelDirectory = getChannelDirectory(channelId);
  const sanitizedChannelId = sanitizeFilename(extractChannelId(channelId));
  
  // Updated filename to include channel ID
  const filePath = path.join(channelDirectory, `${sanitizedChannelId}.json`);
  
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  try {
    const data = fs.readFileSync(filePath, "utf8");
    return JSON.parse(data) as TelegramMessage[];
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    return null;
  }
}