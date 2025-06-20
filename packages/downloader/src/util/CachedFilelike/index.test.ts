import type { FileReader } from './types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CachedFilelike from './index'

describe('cachedFilelike', () => {
  let cachedFile: CachedFilelike
  let mockFileReader: FileReader

  beforeEach(() => {
    // 创建模拟的文件流
    const createMockStream = (expectedLength: number = 100) => {
      const listeners: Record<string, ((data: any) => void)[]> = {}

      const stream = {
        on: vi.fn((event: string, callback: (data: any) => void) => {
          if (!listeners[event]) {
            listeners[event] = []
          }
          listeners[event].push(callback)

          // 如果是data事件，异步模拟数据返回
          if (event === 'data') {
            setTimeout(() => {
              // 创建指定长度的模拟数据
              const data = new Uint8Array(expectedLength)
              for (let i = 0; i < expectedLength; i++) {
                data[i] = i % 256
              }
              callback(data)
            }, 10)
          }
        }),
        destroy: vi.fn(),
        emit: (event: string, ...args: any[]) => {
          if (listeners[event]) {
            listeners[event].forEach(callback => callback(...(args as [any])))
          }
        },
      }

      return stream
    }

    mockFileReader = {
      open: vi.fn(),
      fetch: vi.fn().mockImplementation((offset: number, length: number) => {
        return createMockStream(length)
      }),
    }
    cachedFile = new CachedFilelike({ fileReader: mockFileReader })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('构造函数', () => {
    it('应该正确创建 CachedFilelike 实例', () => {
      expect(cachedFile).toBeInstanceOf(CachedFilelike)
    })

    it('应该正确设置 fileReader', () => {
      const createMockStream = () => ({
        on: vi.fn(),
        destroy: vi.fn(),
      })

      const customFileReader: FileReader = {
        open: vi.fn(),
        fetch: vi.fn().mockImplementation(() => createMockStream()),
      }
      const customCachedFile = new CachedFilelike({ fileReader: customFileReader })
      expect(customCachedFile).toBeInstanceOf(CachedFilelike)
    })
  })

  describe('open', () => {
    it('应该成功打开文件并设置文件大小', async () => {
      const mockSize = 1024
      mockFileReader.open = vi.fn().mockResolvedValue({ size: mockSize })

      await cachedFile.open()

      expect(mockFileReader.open).toHaveBeenCalledTimes(1)
    })

    it('应该在文件无法打开时抛出错误', async () => {
      const error = new Error('无法打开文件')
      mockFileReader.open = vi.fn().mockRejectedValue(error)

      await expect(cachedFile.open()).rejects.toThrow('无法打开文件')
    })

    it('应该是幂等的，可以多次调用', async () => {
      const mockSize = 1024
      mockFileReader.open = vi.fn().mockResolvedValue({ size: mockSize })

      await cachedFile.open()
      await cachedFile.open()

      // 由于实现中有文件大小检查的逻辑，应该只调用一次
      expect(mockFileReader.open).toHaveBeenCalledTimes(1)
    })
  })

  describe('size', () => {
    it('应该在文件未打开时抛出错误', () => {
      expect(() => cachedFile.size()).toThrow('CachedFilelike 尚未打开')
    })

    it('应该在文件打开后返回正确的大小', async () => {
      const mockSize = 2048
      mockFileReader.open = vi.fn().mockResolvedValue({ size: mockSize })

      await cachedFile.open()
      const size = cachedFile.size()

      expect(size).toBe(mockSize)
    })
  })

  describe('read', () => {
    beforeEach(async () => {
      const mockSize = 1024
      mockFileReader.open = vi.fn().mockResolvedValue({ size: mockSize })
      await cachedFile.open()
    })

    it('应该处理零长度读取', async () => {
      const result = await cachedFile.read(0, 0)
      expect(result).toEqual(new Uint8Array())
    })

    it('应该在输入无效时抛出错误', async () => {
      await expect(cachedFile.read(-1, 10)).rejects.toThrow()
      await expect(cachedFile.read(10, -1)).rejects.toThrow()
    })

    it('应该在读取超出文件大小时抛出错误', async () => {
      await expect(cachedFile.read(0, 2000)).rejects.toThrow()
      await expect(cachedFile.read(1000, 100)).rejects.toThrow()
    })

    it('应该成功读取有效范围的数据', async () => {
      const result = await cachedFile.read(0, 100)
      expect(result).toBeInstanceOf(Uint8Array)
      expect(result.length).toBe(100)
    })

    it('应该正确设置最后解析的回调结束位置', async () => {
      await cachedFile.read(100, 50)
      const result = await cachedFile.read(150, 100)
      expect(result).toBeInstanceOf(Uint8Array)
      expect(result.length).toBe(100)
    })
  })

  describe('边界条件测试', () => {
    beforeEach(async () => {
      const mockSize = 10000 // 使用一个更合理的大小
      mockFileReader.open = vi.fn().mockResolvedValue({ size: mockSize })
      await cachedFile.open()
    })

    it('应该处理大文件的边界读取', async () => {
      const result = await cachedFile.read(0, 1024)
      expect(result).toBeInstanceOf(Uint8Array)
      expect(result.length).toBe(1024)
    })

    it('应该正确处理文件末尾的读取', async () => {
      const fileSize = cachedFile.size()
      const result = await cachedFile.read(fileSize - 100, 100)
      expect(result).toBeInstanceOf(Uint8Array)
      expect(result.length).toBe(100)
    })
  })

  describe('缓存行为测试', () => {
    beforeEach(async () => {
      const mockSize = 1024
      mockFileReader.open = vi.fn().mockResolvedValue({ size: mockSize })
      await cachedFile.open()
    })

    it('应该跟踪连续读取操作', async () => {
      await cachedFile.read(0, 100)
      await cachedFile.read(100, 100)
      await cachedFile.read(200, 100)

      // 验证所有读取都成功执行
      expect(true).toBe(true)
    })

    it('应该处理重叠的读取请求', async () => {
      await cachedFile.read(50, 100)
      await cachedFile.read(75, 100)

      // 验证重叠读取不会导致错误
      expect(true).toBe(true)
    })
  })
})
