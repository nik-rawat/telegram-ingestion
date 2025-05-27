/**
 * Simple token rate limiter for Gemini API
 */
export class TokenRateLimiter {
  private tokensPerMinute: number = 60000; // Default Gemini rate
  private tokenBudget: number = 60000;
  private lastRefillTime: number = Date.now();
  
  constructor(tokensPerMinute: number = 60000) {
    this.tokensPerMinute = tokensPerMinute;
    this.tokenBudget = tokensPerMinute;
  }
  
  /**
   * Check if we have enough tokens and wait if needed
   */
  async consumeTokens(tokens: number): Promise<void> {
    // Refill tokens based on time elapsed
    this.refillTokens();
    
    // If we don't have enough tokens, wait until we do
    if (tokens > this.tokenBudget) {
      const timeToWait = Math.ceil((tokens - this.tokenBudget) * 60000 / this.tokensPerMinute);
      console.log(`Token budget exceeded, waiting ${timeToWait/1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, timeToWait));
      this.refillTokens(); // Refill again after waiting
    }
    
    // Consume tokens
    this.tokenBudget -= tokens;
  }
  
  /**
   * Refill tokens based on time elapsed
   */
  private refillTokens(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefillTime;
    
    // Calculate tokens to add based on elapsed time
    const tokensToAdd = Math.floor(elapsedMs * this.tokensPerMinute / 60000);
    
    if (tokensToAdd > 0) {
      this.tokenBudget = Math.min(this.tokenBudget + tokensToAdd, this.tokensPerMinute);
      this.lastRefillTime = now;
    }
  }
}

// Singleton instance
export const tokenLimiter = new TokenRateLimiter(60000); // Adjust based on your API tier