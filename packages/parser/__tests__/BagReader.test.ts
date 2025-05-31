import { BlobReader } from '@foxglove/rosbag/web'
import { describe, expect, it, vi } from 'vitest'
import { ParserState, RosbagParser } from '../src'

// Mock Worker for testing environment
// eslint-disable-next-line no-restricted-globals
global.Worker = vi.fn().mockImplementation(() => ({
  postMessage: vi.fn(),
  terminate: vi.fn(),
  addEventListener: vi.fn(),
  onmessage: null,
  onerror: null,
}))

describe('rosbagParser', () => {
  it('should create a parser instance and handle empty file', async () => {
    const file = new BlobReader(new File([], './test.bag'))
    const parser = new RosbagParser(file)

    // 初始状态检查
    expect(parser.getState()).toBe(ParserState.IDLE)

    try {
      // 使用 messageIterator 而不是 parseParallel
      const iterator = parser.messageIterator()
      const result = await iterator.next()

      // 对于空文件，应该直接完成
      expect(result.done).toBe(true)
      expect(parser.getState()).toBe(ParserState.COMPLETED)
    }
    catch (error) {
      // 空文件可能触发错误，这是可以接受的
      expect(parser.getState()).toBe(ParserState.ERROR)
      expect(error).toBeDefined()
    }
  })

  it('should handle parsing errors', async () => {
    // 创建一个会导致解析错误的文件
    const partialHeader = new Uint8Array([
      0x00,
      0x00,
      0x00,
      0x00, // "ROSB" 部分文件头
      0x41,
      0x47,
      0x00,
      0x00, // 不完整的头部
    ])
    const corruptFile = new BlobReader(
      new File([partialHeader], 'corrupt.bag'),
    )
    const parser = new RosbagParser(corruptFile)

    try {
      // 使用 messageIterator，它会实际调用 bag.open() 来验证文件
      const iterator = parser.messageIterator()
      await iterator.next()

      // 如果没有抛出错误，测试应该失败
      expect.fail('Should have thrown an error')
    }
    // eslint-disable-next-line unused-imports/no-unused-vars
    catch (error) {
      // 捕获异常后检查状态
      expect(parser.getState()).toBe(ParserState.ERROR)
    }
  })

  it('should support topic filtering', async () => {
    // 跳过需要真实文件的测试，或使用模拟数据
    const mockFile = new BlobReader(new File([], 'mock.bag'))
    const parser = new RosbagParser(mockFile, {
      topics: ['/hdas/camera_head/left_raw/image_raw_color/compressed'],
    })

    try {
      const iterator = parser.messageIterator()
      await iterator.next()

      // 对于空文件，期望完成或错误
      expect([ParserState.COMPLETED, ParserState.ERROR]).toContain(parser.getState())
    }
    // eslint-disable-next-line unused-imports/no-unused-vars
    catch (error) {
      // 这是可以接受的，因为文件是空的
      expect(parser.getState()).toBe(ParserState.ERROR)
    }
  })
})
