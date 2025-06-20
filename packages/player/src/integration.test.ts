import type { PlayerState } from './types'
import { describe, expect, it } from 'vitest'
import { MockDataSource } from './DataSource'
import { RosbagPlayer } from './index'

describe('integration - 集成测试', () => {
  it('应该支持完整的播放流程', async () => {
    // 创建播放器
    const dataSource = MockDataSource()
    const player = new RosbagPlayer(dataSource)

    const states: PlayerState[] = []

    // 设置监听器
    player.setListener(async (state) => {
      states.push({ ...state })
    })

    // 等待初始化
    await new Promise(resolve => setTimeout(resolve, 200))

    // 验证初始状态
    expect(states.length).toBeGreaterThan(0)

    // 设置订阅
    player.setSubscriptions([
      { topic: '/test/topic1' },
      { topic: '/test/topic2' },
    ])

    await new Promise(resolve => setTimeout(resolve, 200))

    // 验证订阅后有消息（现在setSubscriptions会触发seek-backfill）
    const afterSubscription = states[states.length - 1]
    expect(afterSubscription.messages).toBeDefined()
    expect(Array.isArray(afterSubscription.messages)).toBe(true)
    expect(afterSubscription.messages?.length).toBe(0)
    expect(afterSubscription.isPlaying).toBe(false)

    // 开始播放
    player.startPlayback()
    await new Promise(resolve => setTimeout(resolve, 5000))
    // await new Promise(resolve => setTimeout(resolve, 200))

    // 验证播放状态
    const playingStates = states.filter(s => s.isPlaying)
    expect(playingStates.length).toBeGreaterThan(0)

    // // 暂停播放
    // player.pausePlayback()
    // await new Promise(resolve => setTimeout(resolve, 100))

    // // 验证暂停状态
    // const finalState = states[states.length - 1]
    // expect(finalState.isPlaying).toBe(false)

    // 清理
    player.close()
  })

  it('应该支持动态更改订阅', async () => {
    const dataSource = MockDataSource()
    const player = new RosbagPlayer(dataSource)

    const states: PlayerState[] = []
    player.setListener(async (state) => {
      states.push({ ...state })
    })

    await new Promise(resolve => setTimeout(resolve, 200))

    // 初始订阅一个主题
    player.setSubscriptions([{ topic: '/test/topic1' }])
    await new Promise(resolve => setTimeout(resolve, 200))

    let currentState = states[states.length - 1]
    expect(currentState.messages?.length).toBe(0)

    // 更改为订阅两个主题
    player.setSubscriptions([
      { topic: '/test/topic1' },
      { topic: '/test/topic2' },
    ])
    await new Promise(resolve => setTimeout(resolve, 200))

    currentState = states[states.length - 1]
    expect(currentState.messages?.length).toBe(0)

    // 取消所有订阅
    player.setSubscriptions([])
    await new Promise(resolve => setTimeout(resolve, 200))

    currentState = states[states.length - 1]
    expect(currentState.messages?.length).toBe(0)

    player.close()
  })

  it('应该正确处理播放速度变化', async () => {
    const dataSource = MockDataSource()
    const player = new RosbagPlayer(dataSource)

    const states: PlayerState[] = []
    player.setListener(async (state) => {
      states.push({ ...state })
    })

    await new Promise(resolve => setTimeout(resolve, 200))

    // 测试设置不同的播放速度
    player.setPlaybackSpeed(2.0)
    await new Promise(resolve => setTimeout(resolve, 100))

    let currentState = states[states.length - 1]
    expect(currentState.speed).toBe(2.0)

    // 测试速度限制
    player.setPlaybackSpeed(0.05) // 太小，应该被限制为0.1
    await new Promise(resolve => setTimeout(resolve, 100))

    currentState = states[states.length - 1]
    expect(currentState.speed).toBe(0.1)

    player.setPlaybackSpeed(15.0) // 太大，应该被限制为10.0
    await new Promise(resolve => setTimeout(resolve, 100))

    currentState = states[states.length - 1]
    expect(currentState.speed).toBe(10.0)

    player.close()
  })

  it('应该正确处理错误恢复', async () => {
    const dataSource = MockDataSource()
    const player = new RosbagPlayer(dataSource)

    const states: PlayerState[] = []
    player.setListener(async (state) => {
      states.push({ ...state })
    })

    await new Promise(resolve => setTimeout(resolve, 200))

    // 确保播放器初始化成功
    expect(states.length).toBeGreaterThan(0)

    // 测试设置无效订阅（不存在的主题）
    player.setSubscriptions([{ topic: '/nonexistent/topic' }])
    await new Promise(resolve => setTimeout(resolve, 150))

    // 播放器应该仍然可以正常工作
    const currentState = states[states.length - 1]
    expect(currentState.messages?.length).toBe(0)

    // 设置有效订阅应该可以恢复
    player.setSubscriptions([{ topic: '/test/topic1' }])
    await new Promise(resolve => setTimeout(resolve, 150))

    const recoveredState = states[states.length - 1]
    expect(recoveredState.messages?.length).toBe(0)

    player.close()
  })
})
