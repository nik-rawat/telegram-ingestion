export interface InvestmentData {
  // Core information - always required
  company: string | string[];     // Name of company OR array of companies in roundups
  type: "investment" | "acquisition" | "roundup";  // Type of transaction
  date: string;                   // ISO format date
  rawText: string;                // Original message text
  
  // Investment-specific fields
  amount?: string | string[];     // Funding amount OR array of amounts matching companies array
  round?: string;                 // Round type (e.g., "Seed", "Series A", "Strategic")
  investors?: string[];           // Array of investor names
  
  // Acquisition-specific fields
  acquirer?: string;              // Name of acquiring company (for acquisitions)
  
  // Common optional fields
  about?: string;                 // Description of the company
  valuation?: string;             // Company valuation (if mentioned)
  links?: string[];               // Array of related URLs
  
  // Roundup-specific fields (for weekly/monthly summaries)
  isPartOfRoundup?: boolean;      // Whether this is part of a roundup post
  
  // For acquisitions mentioned in roundups
  acquisitionsInRoundup?: Array<{
    company: string;
    acquirer: string;
    amount?: string;
  }>;
}