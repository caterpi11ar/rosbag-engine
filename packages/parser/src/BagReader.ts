import type {
  Filelike,
  MessageEvent as RosBagMessageEvent,
} from '@foxglove/rosbag'
import type {
  BagParserOptions,
  ParseResult,
  ParserStatistics,
  WorkerMessage,
} from './types'
import { Bag } from '@foxglove/rosbag'
import { decompress } from 'lz4js'
import { ParserState, WorkerMessageTypes } from './types'
import { createWorkerUrl, revokeWorkerUrl } from './worker-script'

/** ROSBag 解析器 */
class RosbagParser {
  /** ROSBag 实例 */
  private bag: Bag

  /** 解析配置 */
  private options: BagParserOptions

  /** 当前解析状态 */
  private state: ParserState = ParserState.IDLE

  /** 取消标志 */
  private isCancelled: boolean = false

  /** Web Worker */
  private worker: Worker | null = null

  /** Worker URL，用于清理资源 */
  private workerUrl: string | null = null

  /** 解析统计信息 */
  private statistics: ParserStatistics = {
    totalMessages: 0,
    processedMessages: 0,
    topics: new Set(),
    state: ParserState.IDLE,
  }

  /** 任务映射 */
  private tasks: Map<
    string,
    {
      resolve: (value: any) => void
      reject: (error: Error) => void
    }
  > = new Map()

  /**
   * 构造函数
   * @param file ROSBag 文件
   * @param options 解析配置
   */
  constructor(file: Filelike, options: BagParserOptions = {}) {
    this.options = {
      // 默认并发数
      concurrency: navigator.hardwareConcurrency || 4,
      // 默认空 Topic 列表
      topics: [],
      // 默认空钩子
      hooks: {},
      ...options,
    }

    // 创建 Bag 实例，支持 LZ4 解压
    this.bag = new Bag(file, {
      decompress: {
        lz4: (buffer: Uint8Array) => Uint8Array.from(decompress(buffer)),
      },
    })
  }

  /**
   * 异步消息迭代器
   * 提供逐消息处理的生成器接口
   */
  async* messageIterator(): AsyncGenerator<
    RosBagMessageEvent,
    ParserStatistics
  > {
    try {
      // 重置取消状态
      this.isCancelled = false

      // 触发开始钩子
      await this.options.hooks?.onStart?.()
      this.state = ParserState.PARSING

      // 打开 Bag 文件
      await this.bag.open()

      // 迭代消息
      for await (const message of this.bag.messageIterator()) {
        // 检查是否取消
        if (this.isCancelled) {
          this.state = ParserState.CANCELLED
          await this.options.hooks?.onCancel?.()
          break
        }

        // 应用 Topic 过滤
        if (this.shouldIncludeMessage(message)) {
          // 触发消息处理钩子
          await this.options.hooks?.onMessageStart?.()
          await this.options.hooks?.onMessage?.(message)

          // 产生消息
          yield message

          await this.options.hooks?.onMessageEnd?.()

          // 更新统计
          this.updateStatistics(message)
        }
      }

      // 触发结束钩子
      await this.options.hooks?.onEnd?.()
      this.state = ParserState.COMPLETED

      return this.statistics
    }
    catch (error) {
      // 错误处理
      this.state = ParserState.ERROR
      this.statistics.error = error as Error
      await this.options.hooks?.onError?.(error as Error)
      throw error
    }
  }

  /**
   * 初始化 Worker
   * @private
   */
  private initWorker(): Worker {
    if (this.worker)
      return this.worker

    // 创建 Worker URL
    this.workerUrl = createWorkerUrl()

    // 创建 Worker
    this.worker = new Worker(this.workerUrl)

    // 配置消息处理
    this.worker.onmessage = this.handleWorkerMessage.bind(this)
    this.worker.onerror = this.handleWorkerError.bind(this)

    return this.worker
  }

  /**
   * 处理 Worker 消息
   * @param event Worker 消息事件
   * @private
   */
  private handleWorkerMessage(event: globalThis.MessageEvent): void {
    const message = event.data as WorkerMessage
    const taskId = message.taskId

    if (!taskId || !this.tasks.has(taskId))
      return

    const { resolve, reject } = this.tasks.get(taskId)!

    switch (message.type) {
      case WorkerMessageTypes.RESULT:
        // 处理任务结果
        this.state = ParserState.COMPLETED
        // eslint-disable-next-line no-case-declarations
        const result = message.data as ParseResult
        if (result?.statistics) {
          this.statistics = {
            totalMessages: result.statistics.totalMessages,
            processedMessages: result.statistics.totalMessages,
            topics: new Set(result.statistics.topics),
            state: ParserState.COMPLETED,
          }
        }
        resolve(result)
        this.tasks.delete(taskId)
        break

      case WorkerMessageTypes.ERROR:
        // 处理错误
        this.state = ParserState.ERROR
        // eslint-disable-next-line no-case-declarations
        const error = new Error(message.data?.error || 'Unknown error')
        this.statistics.error = error
        reject(error)
        this.tasks.delete(taskId)
        break

      case WorkerMessageTypes.CANCELLED:
        // 处理取消
        this.state = ParserState.CANCELLED
        resolve(this.statistics)
        this.tasks.delete(taskId)
        break
    }
  }

  /**
   * 处理 Worker 错误
   * @param error Worker 错误事件
   * @private
   */
  private handleWorkerError(error: ErrorEvent): void {
    this.state = ParserState.ERROR
    this.statistics.error = new Error(error.message)

    // 拒绝所有未完成的任务
    for (const { reject } of this.tasks.values()) {
      reject(this.statistics.error!)
    }

    // 清空任务队列
    this.tasks.clear()
  }

  /**
   * 在 Worker 中执行任务
   * @param action 动作名称
   * @param data 任务数据
   * @param callbackFn 回调函数字符串
   * @private
   */
  private executeInWorker<T>(
    action: string,
    data: any,
    callbackFn: string,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const worker = this.initWorker()
      const taskId = `task_${Date.now()}_${Math.random()}`

      // 注册任务
      this.tasks.set(taskId, { resolve, reject })

      // 发送任务
      worker.postMessage({
        type: WorkerMessageTypes.TASK,
        taskId,
        data: {
          action,
          data,
          callbackFn,
        },
      })
    })
  }

  /**
   * 通过 Web Worker 并行解析
   * @returns 解析统计信息
   */
  async parseParallel(): Promise<ParserStatistics> {
    this.state = ParserState.PARSING

    try {
      // 触发开始钩子
      await this.options.hooks?.onStart?.()

      // 序列化 ROSBag 处理逻辑
      const processBagCallback = `
        async function(data, progressCallback) {
          try {
            // 自定义 lz4 解压函数不在这里实现，而是由上层提供
            const messages = [];
            const topics = new Set();
            const { fileData, topicFilter } = data;
            
            // 这里应该是简化的处理逻辑
            // 实际上这里可以添加自定义的消息处理代码
            
            return {
              messages,
              statistics: {
                totalMessages: messages.length,
                topics: Array.from(topics)
              }
            };
          } catch (error) {
            throw error;
          }
        }
      `

      // 由于无法直接传递文件对象和 Bag 实例，需要先读取为 ArrayBuffer
      let fileBuffer: ArrayBuffer

      if (this.bag instanceof Blob) {
        fileBuffer = await this.bag.arrayBuffer()
      }
      else if (this.bag instanceof ArrayBuffer) {
        fileBuffer = this.bag
      }
      else {
        // 此处简化，实际可能需要更复杂的转换
        throw new TypeError('Unsupported bag file type')
      }

      // 执行 Worker 任务
      const result = await this.executeInWorker<ParseResult>(
        'processBag',
        {
          fileData: fileBuffer,
          topicFilter: this.options.topics,
        },
        processBagCallback,
      )

      // 更新统计信息
      if (result.statistics) {
        this.statistics = {
          totalMessages: result.statistics.totalMessages,
          processedMessages: result.statistics.totalMessages,
          topics: new Set(result.statistics.topics),
          state: ParserState.COMPLETED,
        }
      }

      // 触发结束钩子
      await this.options.hooks?.onEnd?.()

      return this.statistics
    }
    catch (error) {
      // 错误处理
      this.state = ParserState.ERROR
      this.statistics.error = error as Error
      await this.options.hooks?.onError?.(error as Error)
      throw error
    }
  }

  /** 取消解析 */
  cancel(): void {
    this.isCancelled = true
    this.state = ParserState.CANCELLED

    // 如果使用 Web Worker，发送取消消息
    if (this.worker) {
      this.worker.postMessage({ type: WorkerMessageTypes.CANCEL })
    }
  }

  /** 清理资源 */
  dispose(): void {
    // 终止 Worker
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }

    // 清理 Worker URL
    if (this.workerUrl) {
      revokeWorkerUrl(this.workerUrl)
      this.workerUrl = null
    }

    // 清空任务队列
    this.tasks.clear()
  }

  /** 获取当前解析状态 */
  getState(): ParserState {
    return this.state
  }

  /** 获取解析统计信息 */
  getStatistics(): ParserStatistics {
    return this.statistics
  }

  /**
   * 消息过滤
   * @param message 待过滤消息
   * @private
   */
  private shouldIncludeMessage(message: RosBagMessageEvent): boolean {
    const { topics } = this.options

    return !topics?.length || topics.includes(message.topic)
  }

  /**
   * 更新解析统计信息
   * @param message 处理的消息
   * @private
   */
  private updateStatistics(message: RosBagMessageEvent): void {
    this.statistics.totalMessages++
    this.statistics.processedMessages++
    this.statistics.topics.add(message.topic)
  }
}

export { ParserState, RosbagParser }
