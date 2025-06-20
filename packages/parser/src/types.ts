export interface Time {
  sec: number
  nsec: number
}

export interface MessageEvent<T = unknown> {
  topic: string
  receiveTime: Time
  sizeInBytes: number
  message: T
  schemaName?: string
}

export interface Topic {
  name: string
  schemaName: string
}

export interface Connection {
  conn: number
  topic: string
  md5sum?: string
  messageDefinition?: string
  type?: string
  callerid?: string
}

export interface DecompressHandlers {
  bz2?: (buffer: Uint8Array, size: number) => Uint8Array
  lz4?: (buffer: Uint8Array, size: number) => Uint8Array
}

export interface ParseOptions {
  parse?: boolean
  decompress?: DecompressHandlers
}

// 数据源输入类型
export type DataSourceInput
  = { type: 'file', file: File | Blob }
    | { type: 'url', url: string }
    | { type: 'stream', stream: ReadableStream, size?: number }

// 初始化结果
export interface Initalization {
  start: Time
  end: Time
  topics: Topic[]
}

/**
 * 主题订阅配置
 * 定义了需要订阅的主题及其预加载策略
 */
export interface SubscribePayload {
  /** 主题名称，对应ROSBag中的topic */
  topic: string

  /**
   * 预加载类型（可选）
   * - full: 完全预加载该主题的所有消息
   * - partial: 部分预加载，按需加载消息
   */
  preloadType?: 'full' | 'partial'
}

export type TopicSelection = Map<string, SubscribePayload>

// 消息迭代器参数
export interface MessageIteratorArgs {
  topics?: TopicSelection
  start?: Time
  end?: Time
  reverse?: boolean
  consumptionType?: 'full' | 'partial'
}

// 获取回填消息的参数
export interface GetBackfillMessagesArgs {
  topics: TopicSelection
  time: Time

  abortSignal?: AbortSignal
}

export type NotificationSeverity = 'error' | 'warn' | 'info'

export interface PlayerProblem {
  severity: NotificationSeverity
  message: string
  error?: Error
  tip?: string
}

// 迭代器结果
export type IteratorResult
  = | {
    type: 'message-event'
    msgEvent: MessageEvent
  }
  | {
    type: 'problem'
    /**
     * An ID representing the channel/connection where this problem came from. The app may choose
     * to display only a single problem from each connection to avoid overwhelming the user.
     */
    connectionId: number
    problem: PlayerProblem
  }
  | {
    type: 'stamp'
    stamp: Time
  }

export interface IMessageCursor {
  /**
   * Read the next message from the cursor. Return a result or undefined if the cursor is done
   */
  next(): Promise<IteratorResult | undefined>

  /**
   * Read the next batch of messages from the cursor. Return an array of results or undefined if the cursor is done.
   *
   * @param durationMs indicate the duration (in milliseconds) for the batch to stop waiting for
   * more messages and return. This duration tracks the receive time from the first message in the
   * batch.
   */
  nextBatch(durationMs: number): Promise<IteratorResult[] | undefined>

  /**
   * Read a batch of messages through end time (inclusive) or end of cursor
   *
   * return undefined when no more message remain in the cursor
   */
  readUntil(end: Time): Promise<IteratorResult[] | undefined>

  /**
   * End the cursor
   *
   * Release any held resources by the cursor.
   *
   * Calls to next() and readUntil() should return `undefined` after a cursor is ended as if the
   * cursor reached the end of its messages.
   */
  end(): Promise<void>
}

export type IsAny<Type> = 0 extends 1 & Type ? true : false
export type Primitive = string | number | boolean | bigint | symbol | undefined | null
export type AnyArray<Type = any> = Array<Type> | ReadonlyArray<Type>
export type Builtin = Primitive | Function | Date | Error | RegExp
export type IsTuple<Type> = Type extends readonly any[]
  ? any[] extends Type
    ? never
    : Type
  : never
export type IsUnknown<Type> = IsAny<Type> extends true
  ? false
  : unknown extends Type
    ? true
    : false

// Immutable 类型辅助
export type Immutable<Type> = Type extends Exclude<Builtin, Error>
  ? Type
  : Type extends Map<infer Keys, infer Values>
    ? ReadonlyMap<Immutable<Keys>, Immutable<Values>>
    : Type extends ReadonlyMap<infer Keys, infer Values>
      ? ReadonlyMap<Immutable<Keys>, Immutable<Values>>
      : Type extends WeakMap<infer Keys, infer Values>
        ? WeakMap<Immutable<Keys>, Immutable<Values>>
        : Type extends Set<infer Values>
          ? ReadonlySet<Immutable<Values>>
          : Type extends ReadonlySet<infer Values>
            ? ReadonlySet<Immutable<Values>>
            : Type extends WeakSet<infer Values>
              ? WeakSet<Immutable<Values>>
              : Type extends Promise<infer Value>
                ? Promise<Immutable<Value>>
                : Type extends AnyArray<infer Values>
                  ? Type extends IsTuple<Type>
                    ? { readonly [Key in keyof Type]: Immutable<Type[Key]> }
                    : ReadonlyArray<Immutable<Values>>
                  : Type extends object
                    ? { readonly [Key in keyof Type]: Immutable<Type[Key]> }
                    : IsUnknown<Type> extends true
                      ? unknown
                      : Readonly<Type>

/**
 * 可迭代数据源接口
 * 用于处理不同类型的数据源（文件、URL、流等）并提供统一的消息访问接口
 */
export interface IIterableSource {
  /**
   * 初始化数据源
   * @returns 返回包含开始时间、结束时间、主题列表、连接信息等的初始化结果
   */
  initialize(): Promise<Initalization>

  /**
   * 创建消息迭代器
   * @param args 迭代参数，包括主题过滤、时间范围、是否反向等配置
   * @returns 异步迭代器，用于逐个获取消息事件、问题报告或时间戳
   */
  messageIterator(
    args: Immutable<MessageIteratorArgs>,
  ): AsyncIterableIterator<Readonly<IteratorResult>>

  /**
   * 获取回填消息
   * 用于获取指定时间点之前的最新消息，通常用于初始化状态
   * @param args 包含主题列表、时间点和可选的取消信号
   * @returns 返回匹配条件的消息事件数组
   */
  getBackfillMessages(args: Immutable<GetBackfillMessagesArgs>): Promise<MessageEvent[]>

  /**
   * 获取消息游标（可选）
   * 提供更灵活的消息读取方式，支持批量读取和精确控制
   * @param args 迭代参数，包括可选的取消信号
   * @returns 消息游标对象，支持 next()、nextBatch() 等方法
   */
  getMessageCursor?: (
    args: Immutable<MessageIteratorArgs> & { abort?: AbortSignal },
  ) => IMessageCursor

  /**
   * 终止数据源（可选）
   * 清理资源并关闭连接，确保优雅地结束数据源操作
   */
  terminate?: () => Promise<void>
}

export interface IterableSourceInitializeArgs {
  file?: File
  url?: string
  files?: File[]
  params?: Record<string, string | undefined>

  api?: {
    baseUrl: string
    auth?: string
  }
}

export interface DataSourceFactoryInitializeArgs {
  file?: File
  files?: File[]
  params?: Record<string, string | undefined>
}
