import { fetchTelegramMessages } from "./telegram";
import { saveMessagesToFile, saveInvestmentData } from "./dataService";

async function main() {
  try {
    // Replace with the actual channel username or ID
    const channel = "https://t.me/cryptorank_fundraising";
    const messages = await fetchTelegramMessages(channel, 1000);
    
    // Save the messages to a file
    if (messages.length > 0) {
      const filePath = saveMessagesToFile(channel, messages);
      console.log(`Successfully fetched ${messages.length} messages from ${channel}`);
      console.log(`Data saved to: ${filePath}`);
      
      // Separate investment data extraction
      const investmentFilePath = saveInvestmentData(channel, messages);
      console.log(`Investment data saved to: ${investmentFilePath}`);
    } else {
      console.log("No messages were retrieved");
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

main();