import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteFileReadable } from './index'

// Mock 依赖模块
vi.mock('../BrowserHttpReader', () => ({
  default: vi.fn(),
}))

vi.mock('../CachedFilelike', () => ({
  default: vi.fn(),
}))

describe('remoteFileReadable', () => {
  const mockUrl = 'http://192.168.10.148:8000/test-small.bag'
  let remoteFile: RemoteFileReadable
  let mockBrowserHttpReaderInstance: any
  let mockCachedFilelikeInstance: any
  let MockBrowserHttpReader: any
  let MockCachedFilelike: any

  beforeEach(async () => {
    // 重置所有 mock
    vi.clearAllMocks()

    // 动态导入 mock 的模块
    const BrowserHttpReaderModule = await import('../BrowserHttpReader')
    const CachedFilelikeModule = await import('../CachedFilelike')

    MockBrowserHttpReader = BrowserHttpReaderModule.default
    MockCachedFilelike = CachedFilelikeModule.default

    // 创建 mock 实例
    mockBrowserHttpReaderInstance = {
      open: vi.fn(),
      fetch: vi.fn(),
    }

    mockCachedFilelikeInstance = {
      open: vi.fn(),
      size: vi.fn(),
      read: vi.fn(),
    }

    // Mock 构造函数
    MockBrowserHttpReader.mockImplementation(() => mockBrowserHttpReaderInstance)
    MockCachedFilelike.mockImplementation(() => mockCachedFilelikeInstance)

    remoteFile = new RemoteFileReadable(mockUrl)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('构造函数', () => {
    it('应该正确创建 RemoteFileReadable 实例', () => {
      expect(MockBrowserHttpReader).toHaveBeenCalledWith(mockUrl)
      expect(MockCachedFilelike).toHaveBeenCalledWith({
        fileReader: mockBrowserHttpReaderInstance,
      })
    })
  })

  describe('open', () => {
    it('应该成功打开远程文件', async () => {
      mockCachedFilelikeInstance.open.mockResolvedValue(undefined)

      await expect(remoteFile.open()).resolves.toBeUndefined()
      expect(mockCachedFilelikeInstance.open).toHaveBeenCalledTimes(1)
    })

    it('应该在文件无法打开时抛出错误', async () => {
      const error = new Error('无法打开文件')
      mockCachedFilelikeInstance.open.mockRejectedValue(error)

      await expect(remoteFile.open()).rejects.toThrow('无法打开文件')
      expect(mockCachedFilelikeInstance.open).toHaveBeenCalledTimes(1)
    })
  })

  describe('size', () => {
    it('应该返回文件大小的 BigInt 值', async () => {
      const mockSize = 1024
      mockCachedFilelikeInstance.size.mockReturnValue(mockSize)

      const size = await remoteFile.size()

      expect(size).toBe(BigInt(mockSize))
      expect(mockCachedFilelikeInstance.size).toHaveBeenCalledTimes(1)
    })

    it('应该正确处理大文件大小', async () => {
      const mockSize = Number.MAX_SAFE_INTEGER - 1
      mockCachedFilelikeInstance.size.mockReturnValue(mockSize)

      const size = await remoteFile.size()

      expect(size).toBe(BigInt(mockSize))
    })
  })

  describe('read', () => {
    it('应该成功读取指定范围的数据', async () => {
      const mockData = new Uint8Array([1, 2, 3, 4])
      const offset = 100n
      const size = 4n

      mockCachedFilelikeInstance.read.mockResolvedValue(mockData)

      const result = await remoteFile.read(offset, size)

      expect(result).toBe(mockData)
      expect(mockCachedFilelikeInstance.read).toHaveBeenCalledWith(
        Number(offset),
        Number(size),
      )
    })

    it('应该在读取范围太大时抛出错误', async () => {
      const offset = BigInt(Number.MAX_SAFE_INTEGER)
      const size = 1n

      await expect(remoteFile.read(offset, size)).rejects.toThrow(
        `Read too large: offset ${offset}, size ${size}`,
      )
      expect(mockCachedFilelikeInstance.read).not.toHaveBeenCalled()
    })

    it('应该在偏移量过大时抛出错误', async () => {
      const offset = BigInt(Number.MAX_SAFE_INTEGER - 100)
      const size = 200n

      await expect(remoteFile.read(offset, size)).rejects.toThrow(
        `Read too large: offset ${offset}, size ${size}`,
      )
    })

    it('应该正确处理零大小读取', async () => {
      const mockData = new Uint8Array([])
      const offset = 0n
      const size = 0n

      mockCachedFilelikeInstance.read.mockResolvedValue(mockData)

      const result = await remoteFile.read(offset, size)

      expect(result).toBe(mockData)
      expect(mockCachedFilelikeInstance.read).toHaveBeenCalledWith(0, 0)
    })

    it('应该在底层读取失败时传播错误', async () => {
      const error = new Error('读取失败')
      const offset = 0n
      const size = 100n

      mockCachedFilelikeInstance.read.mockRejectedValue(error)

      await expect(remoteFile.read(offset, size)).rejects.toThrow('读取失败')
    })
  })

  describe('边界条件测试', () => {
    it('应该正确处理最大安全整数边界', async () => {
      const offset = BigInt(Number.MAX_SAFE_INTEGER - 1)
      const size = 1n
      const mockData = new Uint8Array([42])

      mockCachedFilelikeInstance.read.mockResolvedValue(mockData)

      const result = await remoteFile.read(offset, size)

      expect(result).toBe(mockData)
      expect(mockCachedFilelikeInstance.read).toHaveBeenCalledWith(
        Number.MAX_SAFE_INTEGER - 1,
        1,
      )
    })

    it('应该正确处理零偏移量的读取', async () => {
      const offset = 0n
      const size = 1024n
      const mockData = new Uint8Array(1024)

      mockCachedFilelikeInstance.read.mockResolvedValue(mockData)

      const result = await remoteFile.read(offset, size)

      expect(result).toBe(mockData)
      expect(mockCachedFilelikeInstance.read).toHaveBeenCalledWith(0, 1024)
    })
  })
})
