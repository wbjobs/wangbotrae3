const { Worker } = require('worker_threads');
const path = require('path');

class ComputeWorkerPool {
  constructor(maxWorkers = 3) {
    this.maxWorkers = maxWorkers;
    this.activeWorkers = 0;
    this.queue = [];
    
    console.log(`[WorkerPool] 初始化 - 最大并发数: ${maxWorkers}`);
  }

  submit(taskFn, data) {
    return new Promise((resolve, reject) => {
      const task = {
        taskFn: taskFn.toString(),
        data,
        resolve,
        reject
      };
      
      this.queue.push(task);
      console.log(`[WorkerPool] 任务入队 - 队列长度: ${this.queue.length}, 活跃Worker: ${this.activeWorkers}`);
      
      this.processQueue();
    });
  }

  processQueue() {
    while (this.activeWorkers < this.maxWorkers && this.queue.length > 0) {
      const task = this.queue.shift();
      this.executeTask(task);
    }
  }

  executeTask(task) {
    this.activeWorkers++;
    console.log(`[WorkerPool] 启动任务 - 活跃Worker: ${this.activeWorkers}/${this.maxWorkers}`);
    
    const workerCode = `
      const { parentPort, workerData } = require('worker_threads');
      
      ${task.taskFn}
      
      const taskFn = eval('(' + workerData.taskFn + ')');
      
      try {
        const result = taskFn(workerData.data);
        parentPort.postMessage({ success: true, result });
      } catch (error) {
        parentPort.postMessage({ success: false, error: error.message });
      }
    `;
    
    const worker = new Worker(workerCode, {
      eval: true,
      workerData: {
        taskFn: task.taskFn,
        data: task.data
      }
    });
    
    worker.on('message', (message) => {
      this.activeWorkers--;
      worker.terminate();
      
      if (message.success) {
        task.resolve(message.result);
      } else {
        task.reject(new Error(message.error));
      }
      
      console.log(`[WorkerPool] 任务完成 - 活跃Worker: ${this.activeWorkers}/${this.maxWorkers}`);
      this.processQueue();
    });
    
    worker.on('error', (error) => {
      this.activeWorkers--;
      worker.terminate();
      task.reject(error);
      
      console.error(`[WorkerPool] Worker错误:`, error.message);
      this.processQueue();
    });
    
    worker.on('exit', (code) => {
      if (code !== 0) {
        this.activeWorkers = Math.max(0, this.activeWorkers - 1);
        this.processQueue();
      }
    });
  }

  getStatus() {
    return {
      activeWorkers: this.activeWorkers,
      maxWorkers: this.maxWorkers,
      queueLength: this.queue.length
    };
  }
}

class InProcessWorkerPool {
  constructor(maxWorkers = 3) {
    this.maxWorkers = maxWorkers;
    this.running = 0;
    this.queue = [];
    
    console.log(`[InProcessPool] 初始化 - 最大并发数: ${maxWorkers}`);
  }

  submit(taskFn, data) {
    return new Promise((resolve, reject) => {
      this.queue.push({ taskFn, data, resolve, reject });
      this._process();
    });
  }

  _process() {
    while (this.running < this.maxWorkers && this.queue.length > 0) {
      const { taskFn, data, resolve, reject } = this.queue.shift();
      this.running++;
      console.log(`[InProcessPool] 启动任务 - 并发: ${this.running}/${this.maxWorkers}`);
      
      setImmediate(() => {
        try {
          const result = taskFn(data);
          if (result && typeof result.then === 'function') {
            result
              .then(r => { this._finish(resolve, r); })
              .catch(e => { this._finish(reject, e); });
          } else {
            this._finish(resolve, result);
          }
        } catch (error) {
          this._finish(reject, error);
        }
      });
    }
  }

  _finish(callback, value) {
    this.running--;
    console.log(`[InProcessPool] 任务完成 - 并发: ${this.running}/${this.maxWorkers}`);
    callback(value);
    this._process();
  }

  getStatus() {
    return {
      activeWorkers: this.running,
      maxWorkers: this.maxWorkers,
      queueLength: this.queue.length
    };
  }
}

const pool = new InProcessWorkerPool(3);

module.exports = { ComputeWorkerPool, InProcessWorkerPool, pool };
