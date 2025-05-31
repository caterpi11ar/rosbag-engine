// Worker 脚本内容，定义为字符串以便内联
export const workerScript = `
  // 通用任务处理 Worker
  self.onmessage = (event) => {
    const message = event.data;
    
    switch (message.type) {
      case 'task':
        handleTask(message.taskId, message.data);
        break;
      case 'cancel':
        self.postMessage({ type: 'cancelled' });
        break;
    }
  };

  async function handleTask(taskId, taskData) {
    try {
      // 如果提供了回调函数代码，则执行
      if (taskData.callbackFn) {
        // 将字符串函数转换为可执行函数
        const callbackFn = new Function('data', 'postProgress', taskData.callbackFn);
        
        // 定义进度报告函数
        const postProgress = (progress) => {
          self.postMessage({ 
            type: 'progress', 
            taskId, 
            data: progress 
          });
        };
        
        // 执行回调函数
        const result = await callbackFn(taskData.data, postProgress);
        
        // 发送结果
        self.postMessage({ 
          type: 'result', 
          taskId, 
          data: result 
        });
      } else {
        throw new Error('No callback function provided');
      }
    } catch (error) {
      // 发送错误
      self.postMessage({ 
        type: 'error', 
        taskId, 
        data: { 
          error: error instanceof Error ? error.message : String(error) 
        } 
      });
    }
  }
`

/**
 * 创建 Worker Blob URL
 * @returns Worker URL
 */
export function createWorkerUrl(): string {
  const blob = new Blob([workerScript], { type: 'application/javascript' })
  return URL.createObjectURL(blob)
}

/**
 * 清理 Worker URL
 * @param url Worker URL
 */
export function revokeWorkerUrl(url: string): void {
  URL.revokeObjectURL(url)
}
