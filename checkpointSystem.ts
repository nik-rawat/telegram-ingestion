import fs from 'fs';
import path from 'path';
import { ensureDirectoryExists } from './dataService';

interface CheckpointData {
  channel: string;
  totalProcessed: number;
  lastBatchIndex: number;
  lastProcessedTime: string;
  batchSize: number;
  errors: Array<{
    batch: number;
    message: string;
    time: string;
  }>;
}

/**
 * Manage checkpoints for large processing jobs
 */
export class CheckpointManager {
  private checkpointPath: string;
  private data: CheckpointData;
  
  constructor(channel: string, batchSize: number) {
    const checkpointDir = './checkpoints';
    ensureDirectoryExists(checkpointDir);
    
    // Create a safe filename from the channel
    const safeChannel = channel.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    this.checkpointPath = path.join(checkpointDir, `${safeChannel}_checkpoint.json`);
    
    // Initialize or load data
    if (fs.existsSync(this.checkpointPath)) {
      this.data = JSON.parse(fs.readFileSync(this.checkpointPath, 'utf8'));
    } else {
      this.data = {
        channel: channel,
        totalProcessed: 0,
        lastBatchIndex: -1, // Start with -1 to indicate nothing processed yet
        lastProcessedTime: new Date().toISOString(),
        batchSize: batchSize,
        errors: []
      };
      this.saveCheckpoint();
    }
  }
  
  /**
   * Get the next batch index to process
   */
  getNextBatchIndex(): number {
    return this.data.lastBatchIndex + 1;
  }
  
  /**
   * Update checkpoint after a successful batch
   */
  updateCheckpoint(batchIndex: number, messagesProcessed: number): void {
    this.data.lastBatchIndex = batchIndex;
    this.data.totalProcessed += messagesProcessed;
    this.data.lastProcessedTime = new Date().toISOString();
    this.saveCheckpoint();
  }
  
  /**
   * Record an error
   */
  recordError(batchIndex: number, error: any): void {
    this.data.errors.push({
      batch: batchIndex,
      message: error.toString(),
      time: new Date().toISOString()
    });
    this.saveCheckpoint();
  }
  
  /**
   * Save checkpoint to disk
   */
  private saveCheckpoint(): void {
    fs.writeFileSync(this.checkpointPath, JSON.stringify(this.data, null, 2), 'utf8');
  }
  
  /**
   * Get total processed count
   */
  getTotalProcessed(): number {
    return this.data.totalProcessed;
  }
  
  /**
   * Reset checkpoint (for fresh start)
   */
  reset(): void {
    this.data.totalProcessed = 0;
    this.data.lastBatchIndex = -1;
    this.data.lastProcessedTime = new Date().toISOString();
    this.data.errors = [];
    this.saveCheckpoint();
  }
}