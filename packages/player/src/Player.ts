import type {
  IIterableSource,
  IteratorResult,
  MessageEvent,
  SubscribePayload,
  Time,
  Topic,
  TopicSelection,
} from '@rosbag-engine/parser'
import { PlayerPresence, type IterablePlayerState, type Player, type PlayerState, type Progress } from './types'
import { add, clampTime, compare, fromNanoSec } from '@foxglove/rostime'
import { delay } from './utils'

// 初始化后等待面板订阅的延迟时间(毫秒)
const START_DELAY_MS = 100
// 初始播放时向前跳过的纳秒数
const SEEK_ON_START_NS = BigInt(99 * 1e6)

export class RosbagPlayer implements Player {
  // 当前状态
  private state: IterablePlayerState = 'idle'
  // 下一个状态，用于状态转换
  private nextState?: IterablePlayerState
  // 数据源实例
  private dataSource: IIterableSource
  // 状态变化监听器
  private listener?: (state: PlayerState) => Promise<void>

  // 用于取消操作的控制器
  abort?: AbortController
  // 标记状态机是否正在运行
  runningState: boolean = false

  // 播放状态

  // 是否正在播放
  private isPlaying = false
  // 播放速度
  private speed = 1.0
  // 当前时间点
  private currentTime?: Time
  // 数据源起始时间
  private startTime?: Time
  // 数据源结束时间
  private endTime?: Time
  // 播放截止时间(可选)
  private untilTime?: Time
  // 跳转目标时间
  private seekTarget?: Time

  // 数据源中的主题列表
  private topics: Topic[] = []
  // 当前订阅的主题配置
  private subscriptions: SubscribePayload[] = []
  // 待发送的消息
  private messages: MessageEvent[] = []

  // 状态发送函数
  private queueEmitState: () => Promise<void>

  // 播放控制

  // 进度信息
  private progress: Progress = {}
  // 播放器状态(初始化中、存在、缓冲中、错误等)
  private presence = PlayerPresence.INITIALIZING;

  // 所有订阅主题的映射
  private allTopics: TopicSelection = new Map()
  // 消息迭代器
  private playbackIterator?: AsyncIterableIterator<Readonly<IteratorResult>>

  // 创建ROSBag播放器实例
  constructor(dataSource: IIterableSource) {
    this.dataSource = dataSource
    this.queueEmitState = this.emitStateImpl.bind(this)
  }

  // 向监听器发送当前状态，包括进度、消息、时间信息等
  private async emitStateImpl() {
    if (!this.listener) {
      return
    }

    const messages = this.messages

    // After we emit the messages we clear the outgoing message array so we do not emit the messages again
    // Use a stable EMPTY_ARRAY so we don't keep emitting a new messages reference as if messages have changed
    this.messages = []

    const data: PlayerState = {
      state: this.state,
      presence: this.presence,
      progress: this.progress,
      messages,
      currentTime: this.currentTime,
      startTime: this.startTime,
      endTime: this.endTime,
      isPlaying: this.isPlaying,
      speed: this.speed,
      topics: this.topics,
    }

    await this.listener(data)
  }

  // 初始化状态：从数据源获取时间范围、主题列表等信息
  private async stateInitialize(): Promise<void> {
    this.queueEmitState()

    try {
      const { start, end, topics } = await this.dataSource.initialize()

      if (this.seekTarget) {
        this.seekTarget = clampTime(this.seekTarget, start, end)
      }

      this.startTime = start
      this.endTime = end
      this.currentTime = this.seekTarget ?? start
      this.topics = topics

      const uniqueTopics = new Map<string, Topic>()
      for (const topic of topics) {
        uniqueTopics.set(topic.name, topic)
      }
      this.presence = PlayerPresence.PRESENT
    }
    catch (error) {
      console.error('Failed to initialize data source:', error)
    }

    this.queueEmitState()

    if (this.startTime) {
      await delay(START_DELAY_MS)
      this.setState('start-play')
    }
  }

  // 跳转回填状态：获取指定时间点的历史消息
  private async stateSeekBackfill() {
    if (!this.startTime || !this.endTime) {
      throw new Error('invariant: stateSeekBackfill prior to initialization')
    }

    if (!this.seekTarget) {
      return
    }

    // Ensure the seek time is always within the data source bounds
    const targetTime = clampTime(this.seekTarget, this.startTime, this.endTime)

    const seekAckTimeout = setTimeout(() => {
      this.presence = PlayerPresence.BUFFERING
      this.messages = []
      this.currentTime = targetTime
      this.queueEmitState()
    }, 100)

    try {
      this.abort = new AbortController()
      const messages = await this.dataSource.getBackfillMessages({
        topics: this.allTopics,
        time: targetTime,
        abortSignal: this.abort.signal,
      })

      clearTimeout(seekAckTimeout)

      if (this.nextState) {
        return
      }

      this.messages = messages
      this.currentTime = targetTime
      this.presence = PlayerPresence.PRESENT
      this.queueEmitState()
      await this.resetPlaybackIterator()
      this.setState(this.isPlaying ? 'play' : 'idle')
    }
    catch (err) {
      if (this.nextState && err instanceof Error && err.name === 'AbortError') {
        console.log('Aborted backfill')
      }
      else {
        throw err
      }
      console.error(err)
    }
    finally {
      if (this.nextState !== 'seek-backfill') {
        this.seekTarget = undefined
      }
      this.abort = undefined
    }
  }

  // 播放状态：连续播放数据，直到暂停或到达结束时间
  private async statePlay() {
    if (!this.currentTime) {
      throw new Error('Invariant: currentTime not set before statePlay')
    }
    if (!this.startTime || !this.endTime) {
      throw new Error('Invariant: start & end should be set before statePlay')
    }

    const allTopics = this.allTopics
    console.log('==============statePlay==============', this.currentTime, this.endTime)
    
    try {
      while (this.isPlaying && !this.nextState) {
        if (compare(this.currentTime, this.endTime) >= 0) {
          this.setState('idle')
          return
        }
  
        const start = Date.now()
  
        await this.tick()
        if (this.nextState) {
          return
        }
  
        if (this.allTopics !== allTopics) {
          this.setState('reset-playback-iterator')
          return
        }
  
        const time = Date.now() - start
  
        if (time < 16) {
          await delay(16 - time)
        }
      }
    } catch (error) {
      console.error(error)
      this.queueEmitState()
    }
  }

  // 关闭状态：清理资源，终止数据源
  private async stateClose() {
    this.isPlaying = false
    await this.dataSource.terminate?.()
    await this.playbackIterator?.return?.()
    this.playbackIterator = undefined
  }

  // 重置播放迭代器：在跳转或订阅变化后重新创建迭代器
  private async resetPlaybackIterator() {
    if (!this.currentTime) {
      throw new Error('Invariant: Tried to reset playback iterator with no current time.')
    }

    const next = add(this.currentTime, { sec: 0, nsec: 1 })

    await this.playbackIterator?.return?.()

    this.playbackIterator = this.dataSource.messageIterator({
      topics: this.allTopics,
      start: next,
      consumptionType: 'partial',
    })
  }

  // 重置播放迭代器状态：处理订阅变化后的迭代器重置
  private async stateResetPlaybackIterator() {
    if (!this.currentTime) {
      throw new Error('Invariant: Tried to reset playback iterator with no current time.')
    }

    await this.resetPlaybackIterator()
    this.setState(this.isPlaying ? 'play' : 'idle')
  }

  // 空闲状态：等待用户操作
  private async stateIdle() {
    if (this.abort !== undefined) {
      throw new Error('Invariant: some other abort controller exists')
    }

    this.isPlaying = false
    this.presence = PlayerPresence.PRESENT

    // set the latest value of the loaded ranges for the next emit state
    this.progress = {
      ...this.progress,
    }

    const abort = (this.abort = new AbortController())
    const aborted = new Promise((resolve) => {
      abort.signal.addEventListener('abort', resolve)
    })

    this.queueEmitState()
    await aborted
  }

  // 运行状态机：处理状态转换和执行
  async runState() {
    if (this.runningState) {
      return
    }

    this.runningState = true
    try {
      while (this.nextState) {
        const state = (this.state = this.nextState)
        this.nextState = undefined

        if (state !== 'idle' && state !== 'play' && this.playbackIterator) {
          await this.playbackIterator.return?.()
          this.playbackIterator = undefined
        }

        switch (state) {
          case 'preinit':
            this.queueEmitState()
            break
          case 'initialize':
            await this.stateInitialize()
            break
          case 'start-play':
            await this.stateStartPlay()
            break
          case 'idle':
            await this.stateIdle()
            break
          case 'seek-backfill':
            await this.stateSeekBackfill()
            break
          case 'play':
            await this.statePlay()
            break
          case 'close':
            await this.stateClose()
            break
          case 'reset-playback-iterator':
            await this.stateResetPlaybackIterator()
            break
        }
      }
    }
    catch (error) {
      console.error(error)
      this.queueEmitState()
    }
    finally {
      this.runningState = false
    }
  }

  // 设置下一个状态并触发状态机运行
  setState(newState: IterablePlayerState) {
    if (this.nextState === 'close') {
      return
    }
    this.nextState = newState
    this.abort?.abort()
    this.abort = undefined
    void this.runState()
  }

  // 设置状态变化监听器，并开始初始化
  public setListener(listener: (state: PlayerState) => Promise<void>): void {
    if (this.listener) {
      throw new Error('Cannot setListener again')
    }
    this.listener = listener
    this.setState('initialize')
  }

  // 初始播放状态：加载初始消息并准备播放
  private async stateStartPlay(): Promise<void> {
    if (!this.startTime || !this.endTime) {
      throw new Error('Invariant: start and end must be set')
    }

    if (this.seekTarget) {
      this.setState('seek-backfill')
      return
    }

    if (this.playbackIterator) {
      throw new Error('Invariant. playbackIterator was already set')
    }

    const stopTime = clampTime(
      add(this.startTime, fromNanoSec(SEEK_ON_START_NS)),
      this.startTime,
      this.endTime,
    )

    this.playbackIterator = this.dataSource.messageIterator({
      topics: this.allTopics,
      start: this.startTime,
      consumptionType: 'partial',
    })

    this.messages = []
    const messageEvents: MessageEvent[] = []

    const tickTimeout = setTimeout(() => {
      this.presence = PlayerPresence.BUFFERING
      this.queueEmitState()
    }, 100)

    try {
      for (;;) {
        const result = await this.playbackIterator.next()
        if (result.done === true) {
          break
        }
        const iterResult = result.value
        // Bail if a new state is requested while we are loading messages
        // This usually happens when seeking before the initial load is complete
        if (this.nextState) {
          return
        }

        if (iterResult.type === 'message-event') {
        // The message is past the tick end time, we need to save it for next tick
          if (compare(iterResult.msgEvent.receiveTime, stopTime) > 0) {
            break
          }

          messageEvents.push(iterResult.msgEvent)
        }
      }
    }
    catch (error) {
      console.error(error)
    }
    finally {
      clearTimeout(tickTimeout)
    }

    this.currentTime = stopTime
    this.messages = messageEvents
    this.presence = PlayerPresence.PRESENT
    this.queueEmitState()
    this.setState('idle')
  }

  // 暂停播放：停止播放并保持当前时间位置
  pausePlayback(): void {
    if (!this.isPlaying) {
      return
    }

    this.isPlaying = false
    this.untilTime = undefined

    if (this.state === 'play') {
      this.setState('idle')
    }
    else {
      this.queueEmitState() // update isPlaying state to UI
    }
  }

  // 跳转到指定时间
  public seekPlayback(time: Time): void {
    if (!this.startTime || !this.endTime) {
      throw new Error('invariant: initialized but no start/end set')
    }

    const targetTime = clampTime(time, this.startTime, this.endTime)

    if (this.currentTime && compare(this.currentTime, targetTime) === 0) {
      return
    }
    this.seekTarget = targetTime
    this.untilTime = undefined
    this.setState('seek-backfill')
  }

  // 设置播放速度(0.1-10.0)
  setPlaybackSpeed(speed: number): void {
    this.speed = Math.max(0.1, Math.min(10.0, speed))
    this.queueEmitState()
  }

  // 设置订阅主题：只有订阅的主题才会加载和显示消息
  setSubscriptions(subscriptions: SubscribePayload[]): void {
    this.subscriptions = subscriptions

    const allTopics: Map<string, SubscribePayload> = new Map(
      this.subscriptions.map(subscription => [
        subscription.topic,
        subscription,
      ]),
    )

    this.allTopics = allTopics

    if (
      this.state === 'idle'
      || this.state === 'seek-backfill'
      || this.state === 'play'
      || this.state === 'start-play'
    ) {
      if (!this.isPlaying && this.currentTime) {
        this.seekTarget = this.currentTime
        this.untilTime = undefined
        // Trigger a seek backfill to load any missing messages and reset the forward iterator
        this.setState('seek-backfill')
      }
    }
  }

  // 关闭播放器：清理资源并终止数据源
  close(): void {
    this.setState('close')
  }

  // 开始播放实现：可指定播放截止时间
  startPlayImpl(opt?: { untilTime: Time }): void {
    if (this.isPlaying || !this.startTime || !this.endTime) {
      return
    }
    console.log('============startPlayImpl===========', this)
    if (opt?.untilTime) {
      if (this.currentTime && compare(opt.untilTime, this.currentTime) <= 0) {
        throw new Error('Invariant: playUntil time must be after the current time')
      }
      this.untilTime = clampTime(opt.untilTime, this.startTime, this.endTime)
    }
    this.isPlaying = true

    if (this.state === 'idle' && (!this.nextState || this.nextState === 'idle')) {
      this.setState('play')
    }
    else {
      this.queueEmitState()
    }
  }

  // 开始播放：从当前时间点开始播放
  public startPlayback(): void {
    this.startPlayImpl()
  }

  // 播放时钟周期：读取一个时间片段的消息并更新时间
  private async tick(): Promise<void> {
    if (!this.isPlaying) {
      return
    }

    if (!this.startTime || !this.endTime) {
      throw new Error('Invariant: start & end should be set before tick()')
    }

    if (!this.currentTime) {
      throw new Error('Invariant: Tried to play with no current time.')
    }

    const end: Time = clampTime(this.currentTime, this.startTime, this.untilTime ?? this.endTime)

    const messageEvents: MessageEvent[] = []

    const tickTimeout = setTimeout(() => {
      this.presence = PlayerPresence.BUFFERING
      this.queueEmitState()
    }, 500)

    // Read from the iterator through the end of the tick time
    try {
      for (;;) {
        if (!this.playbackIterator) {
          throw new Error('Invariant. this._playbackIterator is undefined.')
        }

        const result = await this.playbackIterator.next()
        if (result.done === true || this.nextState) {
          break
        }
        const iterResult = result.value

        if (iterResult.type === 'message-event') {
          messageEvents.push(iterResult.msgEvent)
        }
      }
    }
    catch (error) {
      console.error(error)
    }
    finally {
      clearTimeout(tickTimeout)
    }

    this.presence = PlayerPresence.PRESENT

    if (this.nextState) {
      return
    }

    this.currentTime = end
    this.messages = messageEvents
    this.queueEmitState()

    if (this.untilTime && compare(this.currentTime, this.untilTime) >= 0) {
      this.pausePlayback()
    }
  }
}
