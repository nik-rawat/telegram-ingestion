import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { createInterface } from "readline";
import dotenv from "dotenv";
import { analyzeText, ExtractedEntities } from "./nlpService";
dotenv.config();

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH as string;
const sessionStr = process.env.TELEGRAM_SESSION;

// Maximum number of retry attempts
const MAX_RETRIES = 2;

// Helper function for prompting user input
function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// Add a sleep function for backoff
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Add a function to create and connect the client with retry logic
async function createTelegramClient(retryCount = 0): Promise<TelegramClient> {
  if (!sessionStr || typeof sessionStr !== "string" || sessionStr.length < 10) {
    console.warn("TELEGRAM_SESSION is not set or invalid. Interactive login will be required.");
  }
  
  const stringSession = new StringSession(sessionStr || "");
  
  try {
    const client = new TelegramClient(stringSession, apiId, apiHash, { 
      connectionRetries: 3, // Reduce retries
      timeout: 30, // Lower timeout
      useWSS: true,
      autoReconnect: false, // Disable auto-reconnect
      floodSleepThreshold: 60, // Increase flood sleep threshold
    });
    
    await client.start({
      phoneNumber: async () => {
        return process.env.TELEGRAM_PHONE || await prompt("Please enter your phone number: ");
      },
      phoneCode: async () => {
        return await prompt("Please enter the code you received: ");
      },
      onError: (err) => console.error("Login error:", err),
    });
    
    // If we're here, we're logged in!
    // If this was a new login, save the session for future use
    if (!sessionStr || sessionStr.length < 10) {
      console.log("New session string (add this to your .env file):");
      console.log(`TELEGRAM_SESSION=${client.session.save()}`);
    }
    
    // Disable automatic update handling
    client.setParseMode("markdown");
    
    return client;
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      console.log(`Connection attempt ${retryCount + 1} failed, retrying in ${2 ** retryCount} seconds...`);
      await sleep(2000 * (2 ** retryCount)); // Exponential backoff
      return createTelegramClient(retryCount + 1);
    } else {
      console.error("Failed to connect after multiple attempts");
      throw error;
    }
  }
}

// Updated message interface with NLP data
export interface TelegramMessage {
  id: string;
  date: string;
  senderId: string;
  senderName: string;
  text: string;
  entities?: ExtractedEntities;
}

export async function fetchTelegramMessages(channel: string, limit = 100): Promise<TelegramMessage[]> {
  let client: TelegramClient | null = null;
  let retries = 0;
  const messages: TelegramMessage[] = [];
  
  try {
    client = await createTelegramClient();
    
    // First, collect all messages with improved error handling
    let offset = 0;
    let fetchedCount = 0;
    
    while (fetchedCount < limit) {
      try {
        const batchSize = Math.min(50, limit - fetchedCount); // Smaller batch size
        console.log(`Fetching messages ${fetchedCount + 1} to ${fetchedCount + batchSize}...`);
        
        let messageBatch = [];
        
        // Use getMessages instead of iterMessages for better timeout handling
        const result = await client.getMessages(channel, {
          limit: batchSize, 
          offsetId: offset,
          waitTime: 15 // Lower wait time
        });
        
        if (Array.isArray(result)) {
          for (const message of result) {
            if (message.message) {
              messageBatch.push({
                id: message.id.toString(),
                date: new Date(message.date * 1000).toISOString(),
                senderId: message.senderId?.toString() || "",
                senderName: (message.sender as any)?.username || 
                           (typeof message.sender === 'object' && message.sender && 'firstName' in message.sender ? 
                           message.sender.firstName : ""),
                text: message.message.substring(0, 300),
              });
              
              // Update offset for pagination
              if (parseInt(message.id.toString()) < offset || offset === 0) {
                offset = parseInt(message.id.toString());
              }
            }
          }
        }
        
        messages.push(...messageBatch);
        fetchedCount += messageBatch.length;
        
        if (messageBatch.length === 0) {
          // No more messages to fetch
          console.log("No more messages to fetch");
          break;
        }
        
        // Increase delay between batches to avoid rate limits
        await sleep(2000);
        
      } catch (error: any) {
        if (error.message && error.message.includes('TIMEOUT')) {
          console.log("Timeout occurred, moving on without retrying");
          // Continue with messages we've already collected
          break;
        } else {
          console.error("Error fetching messages:", error.message);
          break;
        }
      }
    }
    
    // Then process each message with NLP
    console.log("Processing messages with NLP...");
    const processedCount = Math.min(messages.length, 100); // Limit to 100 for processing
    for (let i = 0; i < processedCount; i++) {
      if (i % 10 === 0) {
        console.log(`Processed ${i}/${processedCount} messages`);
      }
      try {
        messages[i].entities = await analyzeText(messages[i].text);
      } catch (err) {
        console.error(`Failed to process message ${messages[i].id}:`, err);
      }
    }
    
    return messages.slice(0, processedCount);
  } catch (error) {
    console.error("Error in fetchTelegramMessages:", error);
    return messages; // Return any messages we managed to collect
  } finally {
    // Ensure client is completely disconnected
    if (client) {
      try {
        // Force disconnect first
        await client.disconnect();
        
        // Manually destroy any lingering connections and cancel tasks
        if (client._connection) {
          // With this line - using type assertion to bypass TypeScript check
          (client._connection as any).disconnect?.();
        }
        
        // Access internal state and clean up any pending tasks
        const internalClient = client as any;
        if (internalClient._sender && internalClient._sender.connection) {
          internalClient._sender.connection.disconnect();
        }
        
        // Clear any update loops or pending promises
        if (internalClient._updates) {
          internalClient._updates._updateLoop = null;
          internalClient._updates._stateChanged = [];
          internalClient._updates._dispatching = false;
        }
        
        // Close the session to free resources
        client.session.close();
        
        console.log("Client completely disconnected and resources freed");
        
        // Set to null to help garbage collection
        client = null;
      } catch (e) {
        console.error("Error during complete client cleanup:", e);
      }
    }
  }
}