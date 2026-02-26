const EventEmitter = require('events');

class RequestQueue extends EventEmitter {
  constructor(maxSize, logger) {
    super();
    this.queue = [];
    this.maxSize = maxSize;
    this.logger = logger;
    this.processing = false;
  }

  addRequest(request) {
    if (this.queue.length >= this.maxSize) {
      this.logger.log('WARN', `Queue is full (${this.maxSize}), rejecting request from user ${request.userId}`);
      this.emit('queueFull', request);
      return false;
    }

    request.status = 'queued';
    this.queue.push(request);
    
    this.logger.log('INFO', `Request added to queue from user ${request.userId}, position: ${this.queue.length}`);
    this.emit('requestAdded', request, this.queue.length);

    // Start processing if not already processing
    if (!this.processing) {
      this.processNext();
    }

    return true;
  }

  async processNext() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    const request = this.queue.shift();
    request.status = 'processing';

    this.logger.log('INFO', `Processing request from user ${request.userId}`);
    this.emit('requestStarted', request);

    try {
      // The actual processing is handled by listeners of 'requestStarted'
      // We just wait for completion or failure
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Request timeout'));
        }, request.timeout || 300000);

        const onComplete = () => {
          clearTimeout(timeout);
          this.removeListener('processingComplete', onComplete);
          this.removeListener('processingFailed', onFailed);
          resolve();
        };

        const onFailed = (error) => {
          clearTimeout(timeout);
          this.removeListener('processingComplete', onComplete);
          this.removeListener('processingFailed', onFailed);
          reject(error);
        };

        this.once('processingComplete', onComplete);
        this.once('processingFailed', onFailed);
      });

      request.status = 'completed';
      this.logger.log('INFO', `Request completed for user ${request.userId}`);
      this.emit('requestCompleted', request);

    } catch (error) {
      request.status = 'failed';
      this.logger.log('ERROR', `Request failed for user ${request.userId}: ${error.message}`);
      this.emit('requestFailed', request, error);
    } finally {
      this.processing = false;
      
      // Process next request in queue
      if (this.queue.length > 0) {
        setImmediate(() => this.processNext());
      }
    }
  }

  getQueuePosition(userId) {
    const index = this.queue.findIndex(req => req.userId === userId);
    return index === -1 ? -1 : index + 1;
  }

  isEmpty() {
    return this.queue.length === 0 && !this.processing;
  }

  getQueueSize() {
    return this.queue.length;
  }

  markProcessingComplete() {
    this.emit('processingComplete');
  }

  markProcessingFailed(error) {
    this.emit('processingFailed', error);
  }
}

module.exports = RequestQueue;
