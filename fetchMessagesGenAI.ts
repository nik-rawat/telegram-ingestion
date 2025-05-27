import { fetchTelegramMessages } from "./telegram";
import { saveMessagesToFile } from "./dataService";
import { saveAIInvestmentData } from "./genAI";

async function main() {
  try {
    // Process both channels
    const channels = [
      "https://t.me/cryptorank_fundraising",
      "https://t.me/crypto_fundraising"
    ];
    
    for (const channel of channels) {
      console.log(`Processing channel: ${channel}`);
      
      // Fetch messages from Telegram
      const messages = await fetchTelegramMessages(channel, 100); // Limit to 100 messages for API cost management
      
      // Save the raw messages to a file
      if (messages.length > 0) {
        const filePath = saveMessagesToFile(channel, messages);
        console.log(`Successfully fetched ${messages.length} messages from ${channel}`);
        console.log(`Data saved to: ${filePath}`);
        
        // Process investment data with Gemini AI
        console.log("Processing investment data with Gemini AI...");
        const investmentFilePath = await saveAIInvestmentData(channel, messages);
        console.log(`AI-processed investment data saved to: ${investmentFilePath}`);
      } else {
        console.log("No messages were retrieved");
      }
      
      // Add a delay between processing different channels
      if (channels.indexOf(channel) < channels.length - 1) {
        console.log("Waiting 5 seconds before processing next channel...");
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
  } catch (error) {
    console.error("Error:", error);
  }
}

main();