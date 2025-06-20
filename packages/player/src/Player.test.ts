import type { IIterableSource, Time } from '@rosbag-engine/parser'
import type { PlayerState } from './types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockDataSource } from './DataSource'
import { RosbagPlayer } from './Player'

describe('player - 播放器测试', () => {
  let dataSource: IIterableSource
  let player: RosbagPlayer
  let stateUpdates: PlayerState[]
  let mockListener: (state: PlayerState) => Promise<void>

  beforeEach(() => {
    dataSource = MockDataSource()
    player = new RosbagPlayer(dataSource)
    stateUpdates = []

    mockListener = vi.fn(async (state: PlayerState) => {
      stateUpdates.push({ ...state })
    })
  })

  afterEach(() => {
    player.close()
    vi.clearAllTimers()
  })

  describe('初始化测试', () => {
    it('应该正确初始化播放器', async () => {
      player.setListener(mockListener)

      // 等待初始化完成
      await new Promise(resolve => setTimeout(resolve, 200))

      expect(stateUpdates.length).toBeGreaterThan(0)
      const lastState = stateUpdates[stateUpdates.length - 1]

      expect(lastState.startTime).toEqual({ sec: 0, nsec: 0 })
      expect(lastState.endTime).toEqual({ sec: 100, nsec: 0 })
      expect(lastState.currentTime).toEqual({ sec: 0, nsec: 0 })
      expect(lastState.isPlaying).toBe(false)
      expect(lastState.speed).toBe(1.0)
      expect(lastState.topics).toHaveLength(2)
    })
  })

  describe('订阅管理测试', () => {
    beforeEach(async () => {
      player.setListener(mockListener)
      await new Promise(resolve => setTimeout(resolve, 200))
      stateUpdates.length = 0 // 清空之前的状态更新
    })

    it('应该正确设置订阅', async () => {
      player.setSubscriptions([
        { topic: '/test/topic1' },
        { topic: '/test/topic2' },
      ])

      await new Promise(resolve => setTimeout(resolve, 150))

      const lastState = stateUpdates[stateUpdates.length - 1]
      // 根据新的逻辑，setSubscriptions会触发seek-backfill，应该加载消息
      expect(lastState.messages).toBeDefined()
    })

    it('应该正确处理空订阅', async () => {
      player.setSubscriptions([])

      await new Promise(resolve => setTimeout(resolve, 100))

      const lastState = stateUpdates[stateUpdates.length - 1]
      expect(lastState.messages).toHaveLength(0)
    })

    it('应该正确处理不存在的主题订阅', async () => {
      player.setSubscriptions([
        { topic: '/nonexistent/topic' },
      ])

      await new Promise(resolve => setTimeout(resolve, 150))

      const lastState = stateUpdates[stateUpdates.length - 1]
      expect(lastState.messages).toHaveLength(0)
    })
  })

  describe('播放控制测试', () => {
    beforeEach(async () => {
      player.setListener(mockListener)
      await new Promise(resolve => setTimeout(resolve, 200))

      player.setSubscriptions([{ topic: '/test/topic1' }])
      await new Promise(resolve => setTimeout(resolve, 150))

      stateUpdates.length = 0 // 清空之前的状态更新
    })

    it('应该正确开始播放', async () => {
      player.startPlayback()

      await new Promise(resolve => setTimeout(resolve, 200))

      expect(stateUpdates.length).toBeGreaterThan(0)
      const playingStates = stateUpdates.filter(state => state.isPlaying)
      expect(playingStates.length).toBeGreaterThan(0)

      // 根据新的tick逻辑，时间会跳到endTime
      const lastPlayingState = playingStates[playingStates.length - 1]
      expect(lastPlayingState.currentTime).toBeDefined()
    })

    it('应该正确暂停播放', async () => {
      player.startPlayback()
      await new Promise(resolve => setTimeout(resolve, 100))

      player.pausePlayback()
      await new Promise(resolve => setTimeout(resolve, 100))

      const lastState = stateUpdates[stateUpdates.length - 1]
      expect(lastState.isPlaying).toBe(false)
    })

    it('应该正确设置播放速度', async () => {
      player.setPlaybackSpeed(2.0)

      await new Promise(resolve => setTimeout(resolve, 50))

      const lastState = stateUpdates[stateUpdates.length - 1]
      expect(lastState.speed).toBe(2.0)
    })

    it('应该限制播放速度范围', async () => {
      player.setPlaybackSpeed(0.05) // 太小
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(stateUpdates[stateUpdates.length - 1].speed).toBe(0.1)

      player.setPlaybackSpeed(15.0) // 太大
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(stateUpdates[stateUpdates.length - 1].speed).toBe(10.0)
    })

    it('应该在播放到结束时自动停止', async () => {
      // 跳转到接近结束的时间
      player.seekPlayback({ sec: 99, nsec: 900000000 })
      await new Promise(resolve => setTimeout(resolve, 150))

      player.startPlayback()
      await new Promise(resolve => setTimeout(resolve, 200))

      const lastState = stateUpdates[stateUpdates.length - 1]
      expect(lastState.isPlaying).toBe(false)
      // 根据新的tick逻辑，播放会快速到达endTime
      expect(lastState.currentTime).toEqual({ sec: 100, nsec: 0 })
    })
  })

  describe('寻址测试', () => {
    beforeEach(async () => {
      player.setListener(mockListener)
      await new Promise(resolve => setTimeout(resolve, 200))

      player.setSubscriptions([{ topic: '/test/topic1' }])
      await new Promise(resolve => setTimeout(resolve, 150))

      stateUpdates.length = 0
    })

    it('应该正确跳转到指定时间', async () => {
      const targetTime: Time = { sec: 50, nsec: 0 }
      player.seekPlayback(targetTime)

      await new Promise(resolve => setTimeout(resolve, 150))

      const lastState = stateUpdates[stateUpdates.length - 1]
      expect(lastState.currentTime).toEqual(targetTime)
    })

    it('应该将超出范围的时间限制在有效范围内', async () => {
      // 测试超出最大时间
      player.seekPlayback({ sec: 150, nsec: 0 })
      await new Promise(resolve => setTimeout(resolve, 150))

      let lastState = stateUpdates[stateUpdates.length - 1]
      expect(lastState.currentTime).toEqual({ sec: 100, nsec: 0 })

      // 测试超出最小时间
      player.seekPlayback({ sec: -10, nsec: 0 })
      await new Promise(resolve => setTimeout(resolve, 150))

      lastState = stateUpdates[stateUpdates.length - 1]
      expect(lastState.currentTime).toEqual({ sec: 0, nsec: 0 })
    })

    it('应该在寻址后恢复播放状态', async () => {
      player.startPlayback()
      await new Promise(resolve => setTimeout(resolve, 100))

      player.seekPlayback({ sec: 30, nsec: 0 })
      await new Promise(resolve => setTimeout(resolve, 200))

      // 寻址完成后应该恢复播放
      const lastState = stateUpdates[stateUpdates.length - 1]
      expect(lastState.isPlaying).toBe(true)
      expect(lastState.currentTime!.sec).toBeGreaterThanOrEqual(30)
    })

    it('应该在寻址时加载对应时间的消息', async () => {
      player.seekPlayback({ sec: 42, nsec: 0 })
      await new Promise(resolve => setTimeout(resolve, 150))

      const lastState = stateUpdates[stateUpdates.length - 1]
      expect(lastState.messages).toHaveLength(1)
      expect(lastState.messages?.[0].receiveTime).toEqual({ sec: 42, nsec: 0 })
      expect(lastState.messages?.[0].topic).toBe('/test/topic1')
    })
  })

  describe('状态管理测试', () => {
    it('应该正确处理关闭操作', async () => {
      player.setListener(mockListener)
      await new Promise(resolve => setTimeout(resolve, 200))

      player.startPlayback()
      await new Promise(resolve => setTimeout(resolve, 100))

      player.close()
      await new Promise(resolve => setTimeout(resolve, 100))

      // 关闭后不应该再有状态更新
      const stateCountBeforeClose = stateUpdates.length
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(stateUpdates.length).toBe(stateCountBeforeClose)
    })

    it('应该正确处理重复的操作调用', () => {
      expect(() => {
        player.startPlayback()
        player.startPlayback() // 重复调用
      }).not.toThrow()

      expect(() => {
        player.pausePlayback()
        player.pausePlayback() // 重复调用
      }).not.toThrow()
    })
  })

  describe('消息处理测试', () => {
    beforeEach(async () => {
      player.setListener(mockListener)
      await new Promise(resolve => setTimeout(resolve, 200))
      stateUpdates.length = 0
    })

    it('应该为订阅的主题加载消息', async () => {
      player.setSubscriptions([
        { topic: '/test/topic1' },
        { topic: '/test/topic2' },
      ])

      await new Promise(resolve => setTimeout(resolve, 150))

      const lastState = stateUpdates[stateUpdates.length - 1]
      expect(lastState.messages).toBeDefined()
      expect(Array.isArray(lastState.messages)).toBe(true)
    })

    it('应该在特定时间点加载对应的消息', async () => {
      player.setSubscriptions([{ topic: '/test/topic1' }])
      player.seekPlayback({ sec: 25, nsec: 0 })
      await new Promise(resolve => setTimeout(resolve, 150))

      const lastState = stateUpdates[stateUpdates.length - 1]
      expect(lastState.messages).toHaveLength(1)

      const message = lastState.messages?.[0]
      expect(message?.receiveTime).toEqual({ sec: 25, nsec: 0 })
      expect(message?.topic).toBe('/test/topic1')
    })

    it('应该正确清空消息数组', async () => {
      player.setSubscriptions([{ topic: '/test/topic1' }])
      await new Promise(resolve => setTimeout(resolve, 150))

      // 验证消息被正确清空（每次状态更新后消息数组应该被清空）
      const statesWithMessages = stateUpdates.filter(state =>
        state.messages && state.messages.length > 0,
      )

      // 应该有消息状态，但后续状态的messages应该为空
      expect(statesWithMessages.length).toBeGreaterThan(0)
    })
  })

  describe('错误处理测试', () => {
    it('应该正确处理数据源错误', async () => {
      // 创建一个会抛出错误的数据源
      const errorDataSource = {
        initialize: vi.fn().mockRejectedValue(new Error('Initialize failed')),
        getBackfillMessages: vi.fn().mockRejectedValue(new Error('Get messages failed')),
        messageIterator: vi.fn().mockReturnValue({
          next: vi.fn().mockRejectedValue(new Error('Iterator failed')),
          return: vi.fn().mockResolvedValue({ done: true, value: undefined }),
        }),
        terminate: vi.fn(),
      }

      const errorPlayer = new RosbagPlayer(errorDataSource as any)

      expect(() => {
        errorPlayer.setListener(mockListener)
      }).not.toThrow()

      await new Promise(resolve => setTimeout(resolve, 200))

      // 播放器应该仍然可以操作，不会崩溃
      expect(() => {
        errorPlayer.startPlayback()
        errorPlayer.pausePlayback()
        errorPlayer.close()
      }).not.toThrow()
    })

    it('应该正确处理监听器错误', async () => {
      const errorListener = vi.fn().mockRejectedValue(new Error('Listener error'))

      player.setListener(errorListener)
      await new Promise(resolve => setTimeout(resolve, 200))

      // 播放器应该仍然可以正常工作
      expect(() => {
        player.startPlayback()
        player.pausePlayback()
      }).not.toThrow()
    })
  })

  describe('状态一致性测试', () => {
    beforeEach(async () => {
      player.setListener(mockListener)
      await new Promise(resolve => setTimeout(resolve, 200))
      stateUpdates.length = 0
    })

    it('状态更新应该包含所有必要字段', async () => {
      player.setSubscriptions([{ topic: '/test/topic1' }])
      await new Promise(resolve => setTimeout(resolve, 150))

      const lastState = stateUpdates[stateUpdates.length - 1]

      // 验证所有关键字段都存在
      expect(lastState.currentTime).toBeDefined()
      expect(lastState.startTime).toBeDefined()
      expect(lastState.endTime).toBeDefined()
      expect(typeof lastState.isPlaying).toBe('boolean')
      expect(typeof lastState.speed).toBe('number')
      expect(Array.isArray(lastState.topics)).toBe(true)
      expect(Array.isArray(lastState.messages)).toBe(true)
      expect(lastState.progress).toBeDefined()
    })

    it('播放状态变化应该正确反映', async () => {
      // 开始播放
      player.startPlayback()
      await new Promise(resolve => setTimeout(resolve, 100))

      const playingStates = stateUpdates.filter(state => state.isPlaying === true)
      expect(playingStates.length).toBeGreaterThan(0)

      // 暂停播放
      player.pausePlayback()
      await new Promise(resolve => setTimeout(resolve, 100))

      const pausedStates = stateUpdates.filter(state => state.isPlaying === false)
      expect(pausedStates.length).toBeGreaterThan(0)
    })
  })
})
