import { fetchTelegramMessages } from "../core/telegram.js";
import { saveMessagesToFile } from "../core/dataService.js";
import { saveAIInvestmentData } from "../parsers/genAI.js";
import fs from "fs";
import path from "path";
import { extractChannelId, sanitizeFilename, getChannelDirectory, ensureDirectoryExists } from "../core/dataService.js";

const BATCH_SIZE = 25; // Process 25 messages per API batch
const DELAY_BETWEEN_BATCHES = 5000; // 5 seconds between batches
const MAX_RETRIES_PER_BATCH = 3;
const PROGRESSIVE_BACKOFF = 1.5; // Multiply delay by this factor on errors

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Process a large number of messages in batches with rate limiting
 */
async function processBulkMessages(channel: string, totalLimit = 1000): Promise<void> {
  try {
    console.log(`Processing ${totalLimit} messages from ${channel}...`);
    
    // Get the directory for this channel
    const channelDirectory = getChannelDirectory(channel);
    ensureDirectoryExists(channelDirectory);
    const sanitizedChannelId = sanitizeFilename(extractChannelId(channel));
    
    // First fetch all messages in one go (or in larger batches if needed)
    console.log(`Fetching ${totalLimit} messages...`);
    const messages = await fetchTelegramMessages(channel, totalLimit);
    console.log(`Successfully fetched ${messages.length} messages`);
    
    // Save raw messages to file
    const filePath = saveMessagesToFile(channel, messages);
    console.log(`Raw messages saved to: ${filePath}`);
    
    // Process in smaller batches with Gemini
    console.log(`Processing messages with GenAI in batches of ${BATCH_SIZE}...`);
    
    // Split the messages into smaller batches
    const batches = [];
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      batches.push(messages.slice(i, i + BATCH_SIZE));
    }
    
    // Create a results folder for this processing run
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const resultsDir = path.join(channelDirectory, `batch_results_${timestamp}`);
    ensureDirectoryExists(resultsDir);
    
    // Process each batch with progressive delay
    let currentDelay = DELAY_BETWEEN_BATCHES;
    let processedCount = 0;
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`Processing batch ${i+1}/${batches.length} (${batch.length} messages)...`);
      
      // Try processing this batch with retries
      let success = false;
      let retryCount = 0;
      
      while (!success && retryCount < MAX_RETRIES_PER_BATCH) {
        try {
          // Save batch results to a separate file
          const batchFilePath = path.join(resultsDir, `batch_${i+1}.json`);
          
          // Process this batch with GenAI
          const investments = await processMessagesWithAI(batch);
          
          // Save this batch's results
          fs.writeFileSync(batchFilePath, JSON.stringify(investments, null, 2), "utf8");
          
          processedCount += batch.length;
          console.log(`Batch ${i+1} processed successfully. Progress: ${processedCount}/${messages.length} (${Math.round(processedCount/messages.length*100)}%)`);
          
          success = true;
          
          // Reset delay if successful (but keep a minimum)
          currentDelay = Math.max(DELAY_BETWEEN_BATCHES, currentDelay / PROGRESSIVE_BACKOFF);
          
        } catch (error) {
          retryCount++;
          console.error(`Error processing batch ${i+1}, retry ${retryCount}/${MAX_RETRIES_PER_BATCH}:`, error);
          
          // Increase delay for next attempt
          currentDelay *= PROGRESSIVE_BACKOFF;
          console.log(`Increasing delay to ${currentDelay}ms for next attempt`);
          
          if (retryCount >= MAX_RETRIES_PER_BATCH) {
            console.error(`Failed to process batch ${i+1} after ${MAX_RETRIES_PER_BATCH} attempts, skipping...`);
          } else {
            await sleep(currentDelay);
          }
        }
      }
      
      // Wait before processing next batch
      if (i < batches.length - 1) {
        console.log(`Waiting ${currentDelay}ms before next batch...`);
        await sleep(currentDelay);
      }
    }
    
    // Merge all batch results
    console.log("Merging batch results...");
    await mergeBatchResults(resultsDir, channel);
    
  } catch (error) {
    console.error("Error processing bulk messages:", error);
  }
}

/**
 * Process a batch of messages with GenAI
 */
async function processMessagesWithAI(messages: any[]): Promise<any[]> {
  // Import dynamically to avoid circular dependencies
  const { extractInvestmentsWithAI } = await import("../parsers/genAI.js");
  return extractInvestmentsWithAI(messages);
}

/**
 * Merge all batch results into a single file
 */
async function mergeBatchResults(resultsDir: string, channel: string): Promise<void> {
  const batchFiles = fs.readdirSync(resultsDir).filter(file => file.startsWith('batch_') && file.endsWith('.json'));
  
  let allInvestments: any[] = [];
  
  // Read all batch files
  for (const file of batchFiles) {
    const filePath = path.join(resultsDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    allInvestments = allInvestments.concat(data);
  }
  
  // Save merged results using the standard function
  const { saveAIInvestmentData } = await import("../parsers/genAI.js");
  const finalFilePath = await saveAIInvestmentData(channel, allInvestments);
  
  console.log(`All batches merged successfully. Final results saved to: ${finalFilePath}`);
}

// Run the process
const channel = "https://t.me/cryptorank_fundraising"; // Change as needed
const messageLimit = 1000; // Adjust as needed
processBulkMessages(channel, messageLimit);