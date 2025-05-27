import natural from 'natural';
import nlp from 'compromise';

// Type for extracted entities
export interface ExtractedEntities {
  companies: string[];
  protocols: string[];
  themes: string[];
  keywords: string[];
}

// Common crypto terms and protocols for better identification
const cryptoProtocols = [
  'Bitcoin', 'BTC', 'Ethereum', 'ETH', 'Solana', 'SOL', 'Cardano', 'ADA',
  'Polkadot', 'DOT', 'Avalanche', 'AVAX', 'Chainlink', 'LINK', 'Polygon', 'MATIC',
  'Uniswap', 'UNI', 'Aave', 'Compound', 'MakerDAO', 'Curve', 'DeFi', 'NFT', 
  'SushiSwap', 'PancakeSwap', 'BSC', 'Binance Smart Chain', 'Layer 2', 'L2',
  'Rollup', 'ZK-rollup', 'Optimistic rollup', 'Arbitrum', 'Optimism',
];

const cryptoThemes = [
  'DeFi', 'NFT', 'Metaverse', 'Web3', 'DAO', 'GameFi', 'Play-to-Earn', 'P2E',
  'DEX', 'AMM', 'Lending', 'Yield Farming', 'Staking', 'Layer 1', 'Layer 2',
  'L1', 'L2', 'ZK', 'Zero Knowledge', 'Privacy', 'Governance', 'Interoperability',
  'Cross-chain', 'Oracle', 'Stablecoin', 'CBDC', 'ICO', 'IDO', 'IEO', 'INO',
  'STO', 'Tokenization', 'Smart Contracts', 'Fundraising', 'Presale', 'Seed Round',
  'Private Sale', 'Public Sale', 'Listing', 'LaunchPad', 'Whitelist'
];

// Create tokenizer instance correctly
const tokenizer = new natural.WordTokenizer();

// Create stopwords set using Node.js stopwords list
const stopwords = new Set(natural.stopwords);

// Extract keywords from text
function extractKeywords(text: string): string[] {
  try {
    const tokens = tokenizer.tokenize(text) || [];
    return tokens
      .filter(token => 
        token.length > 2 && 
        !stopwords.has(token.toLowerCase()) &&
        /^[a-zA-Z0-9]+$/.test(token) // Only alphanumeric
      )
      .map(token => token.toLowerCase());
  } catch (error) {
    console.error("Error extracting keywords:", error);
    return [];
  }
}

// Check if text contains terms from a list
function containsTerms(text: string, termList: string[]): string[] {
  const foundTerms: string[] = [];
  const lowercaseText = text.toLowerCase();
  
  termList.forEach(term => {
    if (lowercaseText.includes(term.toLowerCase())) {
      foundTerms.push(term);
    }
  });
  
  return foundTerms;
}

// Extract entities using compromise
function extractNamedEntities(text: string): { companies: string[] } {
  try {
    const doc = nlp(text);
    const organizations = doc.organizations().out('array');
    
    return {
      companies: Array.from(new Set(organizations))
    };
  } catch (error) {
    console.error("Error extracting named entities:", error);
    return { companies: [] };
  }
}

// Main function to analyze text
export async function analyzeText(text: string): Promise<ExtractedEntities> {
  try {
    // Basic extraction
    const keywords = extractKeywords(text);
    const protocols = containsTerms(text, cryptoProtocols);
    const themes = containsTerms(text, cryptoThemes);
    
    // Named entity recognition
    const { companies } = extractNamedEntities(text);
    
    return {
      companies,
      protocols,
      themes,
      keywords: keywords.slice(0, 10) // Top 10 keywords
    };
  } catch (error) {
    console.error("Error analyzing text:", error);
    return {
      companies: [],
      protocols: [],
      themes: [],
      keywords: []
    };
  }
}