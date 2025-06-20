import type {
  MessageEvent,
  SubscribePayload,
  Time,
  Topic,
} from '@rosbag-engine/parser'

/**
 * 播放器状态接口
 * 包含播放器的完整状态信息，用于UI显示和控制逻辑
 */
export interface PlayerState {
  /** 当前状态 */
  state: IterablePlayerState

  /** 当前播放时间点，未初始化时为undefined */
  currentTime?: Time

  /** ROSBag文件的开始时间，未初始化时为undefined */
  startTime?: Time

  /** ROSBag文件的结束时间，未初始化时为undefined */
  endTime?: Time

  /** 当前是否正在播放 */
  isPlaying?: boolean

  /** 播放速度倍率，范围通常为0.1-10.0 */
  speed?: number

  /** ROSBag文件中可用的主题列表 */
  topics?: Topic[]

  /** 当前时间点订阅主题的消息数据 */
  messages?: MessageEvent[]

  /** 播放器进度信息 */
  progress?: Progress
  
  /** 播放器存在状态 */
  presence?: PlayerPresence
}

/**
 * 播放器存在状态枚举
 * 表示播放器当前的可用性和运行状态
 */
export enum PlayerPresence {
  /** 不存在 - 播放器未连接或不可用 */
  NOT_PRESENT = "NOT_PRESENT",
  
  /** 初始化中 - 播放器正在初始化 */
  INITIALIZING = "INITIALIZING",
  
  /** 重新连接中 - 播放器正在尝试重新连接 */
  RECONNECTING = "RECONNECTING",
  
  /** 缓冲中 - 播放器正在加载数据 */
  BUFFERING = "BUFFERING",
  
  /** 存在 - 播放器可用且正常运行 */
  PRESENT = "PRESENT",
  
  /** 错误 - 播放器遇到错误 */
  ERROR = "ERROR",
}

/**
 * 播放器能力枚举
 * 定义播放器支持的功能特性，用于功能检测和UI适配
 */
export enum PlayerCapabilities {
  /** 支持设置播放速度 */
  setSpeed = 'setSpeed',

  /** 支持播放控制（播放/暂停/跳转） */
  playbackControl = 'playbackControl',
}

/**
 * 播放器状态机状态类型
 * 定义播放器内部状态机的可能状态
 */
export type IterablePlayerState
  = | 'preinit'
    | 'initialize'
    | 'start-play'
    | 'idle'
    | 'seek-backfill'
    | 'play'
    | 'close'
    | 'reset-playback-iterator'

/**
 * 播放器核心接口
 * 定义了ROSBag播放器必须实现的基本功能
 *
 * ## 设计模式
 * 采用观察者模式，通过listener回调通知状态变化
 *
 * ## 使用流程
 * 1. 设置监听器: setListener()
 * 2. 配置订阅: setSubscriptions()
 * 3. 控制播放: startPlayback() / pausePlayback() / seekPlayback()
 * 4. 清理资源: close()
 */
export interface Player {
  /**
   * 设置状态变化监听器
   * @param listener - 状态变化回调函数，播放器状态更新时会被调用
   */
  setListener(listener: (state: PlayerState) => Promise<void>): void

  /**
   * 关闭播放器并清理资源
   * 停止所有活动并释放相关资源
   */
  close(): void

  /**
   * 开始播放ROSBag
   * 从当前时间点开始按设定速度播放
   */
  startPlayback(): void

  /**
   * 暂停播放
   * 停止播放但保持当前时间位置
   */
  pausePlayback(): void

  /**
   * 跳转到指定时间点
   * @param time - 目标时间点，会被限制在有效时间范围内
   */
  seekPlayback(time: Time): void

  /**
   * 设置播放速度
   * @param speed - 播放速度倍率，通常限制在0.1-10.0范围内
   */
  setPlaybackSpeed(speed: number): void

  /**
   * 设置订阅的主题
   * 只有订阅的主题才会加载和显示消息
   * @param subscriptions - 订阅配置数组
   */
  setSubscriptions(subscriptions: SubscribePayload[]): void
}

/**
 * 进度信息类型
 * 包含加载进度和缓存状态
 */
export type Progress = Readonly<{
  /** 已完全加载的时间范围 */
  fullyLoadedFractionRanges?: Range[]

  /** 内存使用信息，如预加载或缓冲消息占用的内存大小 */
  readonly memoryInfo?: Record<string, number>
}>

/**
 * 范围类型
 * 表示一个时间或进度范围
 */
export interface Range {
  /** 范围起始值 */
  start: number
  
  /** 范围结束值 */
  end: number
}
