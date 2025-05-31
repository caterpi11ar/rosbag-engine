import type { MessageEvent as RosBagMessageEvent } from '@foxglove/rosbag'

/** 生命周期钩子接口，提供解析过程中的回调 */
export interface BagParserHooks {
  /** 解析开始前调用 */
  onStart?: () => void | Promise<void>
  /** 每个消息处理开始前调用 */
  onMessageStart?: () => void | Promise<void>
  /** 消息处理时调用 */
  onMessage?: (message: RosBagMessageEvent) => void | Promise<void>
  /** 每个消息处理结束后调用 */
  onMessageEnd?: () => void | Promise<void>
  /** 解析完成时调用 */
  onEnd?: () => void | Promise<void>
  /** 发生错误时调用 */
  onError?: (error: Error) => void | Promise<void>
  /** 解析取消时调用 */
  onCancel?: () => void | Promise<void>
}

/** 解析配置选项 */
export interface BagParserOptions {
  /** 并发处理配置 */
  concurrency?: number | 'auto'

  /** 需要解析的 Topic 列表 */
  topics?: string[]

  /** 队列最大长度 */
  maxQueueSize?: number

  /** 生命周期钩子 */
  hooks?: BagParserHooks
}

/** 解析器状态枚举 */
export enum ParserState {
  /** 空闲状态 */
  IDLE,
  /** 正在解析 */
  PARSING,
  /** 解析完成 */
  COMPLETED,
  /** 已取消 */
  CANCELLED,
  /** 异常状态 */
  ERROR,
}

/** 解析统计信息 */
export interface ParserStatistics {
  /** 总消息数 */
  totalMessages: number
  /** 已处理消息数 */
  processedMessages: number
  /** 涉及的 Topic */
  topics: Set<string>
  /** 当前解析状态 */
  state: ParserState
  /** 错误信息 */
  error?: Error
}

// 定义 Worker 消息类型
export const WorkerMessageTypes = {
  TASK: 'task',
  CANCEL: 'cancel',
  RESULT: 'result',
  ERROR: 'error',
  CANCELLED: 'cancelled',
} as const

export type WorkerMessageType = typeof WorkerMessageTypes[keyof typeof WorkerMessageTypes]

export interface WorkerMessage {
  type: WorkerMessageType
  taskId?: string
  data?: any
}

// 定义解析结果接口
export interface ParseResult {
  messages: RosBagMessageEvent[]
  statistics: {
    totalMessages: number
    topics: string[]
  }
}

export interface WorkerTask {
  id: string
  action: string
  data?: any
  // 序列化的回调函数，将在 Worker 内执行
  callbackFn?: string
}
