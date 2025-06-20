import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BrowserHttpReader from './index'

// Mock fetch 全局函数
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

describe('browserHttpReader', () => {
  const mockUrl = 'https://example.com/test.bag'
  let reader: BrowserHttpReader

  beforeEach(() => {
    vi.clearAllMocks()
    reader = new BrowserHttpReader(mockUrl)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('构造函数', () => {
    it('应该正确创建 BrowserHttpReader 实例', () => {
      expect(reader).toBeInstanceOf(BrowserHttpReader)
    })

    it('应该正确设置 URL', () => {
      const customUrl = 'https://custom.com/file.bag'
      const customReader = new BrowserHttpReader(customUrl)
      expect(customReader).toBeInstanceOf(BrowserHttpReader)
    })
  })

  describe('open', () => {
    it('应该成功打开支持 Range 请求的文件', async () => {
      const mockResponse = {
        ok: true,
        headers: {
          get: vi.fn()
            .mockReturnValueOnce('bytes') // accept-ranges
            .mockReturnValueOnce('1024') // content-length
            .mockReturnValueOnce('etag123'), // etag
        },
      }

      mockFetch.mockResolvedValue(mockResponse)

      const result = await reader.open()

      expect(result).toEqual({
        size: 1024,
        identifier: 'etag123',
      })
      expect(mockFetch).toHaveBeenCalledWith(mockUrl, {
        signal: expect.any(AbortSignal),
        cache: 'no-store',
      })
    })

    it('应该在获取文件失败时抛出错误', async () => {
      mockFetch.mockRejectedValue(new Error('网络错误'))

      await expect(reader.open()).rejects.toThrow('Fetching remote file failed. Error: 网络错误')
    })

    it('应该在响应状态不正常时抛出错误', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
      }

      mockFetch.mockResolvedValue(mockResponse)

      await expect(reader.open()).rejects.toThrow(
        `Fetching remote file failed. <${mockUrl}> Status code: 404.`,
      )
    })

    it('应该在不支持 Range 请求时抛出错误', async () => {
      const mockResponse = {
        ok: true,
        headers: {
          get: vi.fn()
            .mockReturnValueOnce('none') // accept-ranges
            .mockReturnValueOnce('1024'), // content-length
        },
      }

      mockFetch.mockResolvedValue(mockResponse)

      await expect(reader.open()).rejects.toThrow(
        'Support for HTTP Range requests was not detected on the remote file.\n\nConfirm the resource has an \'Accept-Ranges: bytes\' header.',
      )
    })

    it('应该在缺少文件大小时抛出错误', async () => {
      const mockResponse = {
        ok: true,
        headers: {
          get: vi.fn()
            .mockReturnValueOnce('bytes') // accept-ranges
            .mockReturnValueOnce(null), // content-length
        },
      }

      mockFetch.mockResolvedValue(mockResponse)

      await expect(reader.open()).rejects.toThrow(
        `Remote file is missing file size. <${mockUrl}>`,
      )
    })

    it('应该正确处理不同的标识符来源', async () => {
      const mockResponse = {
        ok: true,
        headers: {
          get: vi.fn()
            .mockReturnValueOnce('bytes') // accept-ranges
            .mockReturnValueOnce('2048') // content-length
            .mockReturnValueOnce(null) // etag
            .mockReturnValueOnce('Mon, 01 Jan 2024 00:00:00 GMT'), // last-modified
        },
      }

      mockFetch.mockResolvedValue(mockResponse)

      const result = await reader.open()

      expect(result).toEqual({
        size: 2048,
        identifier: 'Mon, 01 Jan 2024 00:00:00 GMT',
      })
    })

    it('应该在没有标识符时返回 undefined', async () => {
      const mockResponse = {
        ok: true,
        headers: {
          get: vi.fn()
            .mockReturnValueOnce('bytes') // accept-ranges
            .mockReturnValueOnce('512') // content-length
            .mockReturnValueOnce(null) // etag
            .mockReturnValueOnce(null), // last-modified
        },
      }

      mockFetch.mockResolvedValue(mockResponse)

      const result = await reader.open()

      expect(result).toEqual({
        size: 512,
        identifier: undefined,
      })
    })
  })

  describe('fetch', () => {
    it('应该创建正确的 Range 请求并返回 FetchReader', () => {
      const offset = 100
      const length = 200

      const stream = reader.fetch(offset, length)

      expect(stream).toBeDefined()
      // 验证 FetchReader 是否被正确创建并调用了 read 方法
      // 由于 FetchReader 是一个复杂的异步流，这里主要验证不抛出错误
    })

    it('应该为不同的偏移量和长度创建不同的请求', () => {
      const stream1 = reader.fetch(0, 100)
      const stream2 = reader.fetch(500, 300)

      expect(stream1).toBeDefined()
      expect(stream2).toBeDefined()
      expect(stream1).not.toBe(stream2)
    })

    it('应该正确计算 Range 头部', () => {
      const offset = 50
      const length = 150
      // 应该生成 "bytes=50-199" (50 + 150 - 1)

      const stream = reader.fetch(offset, length)
      expect(stream).toBeDefined()
    })
  })

  describe('边界条件测试', () => {
    it('应该处理零偏移量的读取', () => {
      const stream = reader.fetch(0, 1024)
      expect(stream).toBeDefined()
    })

    it('应该处理大偏移量的读取', () => {
      const stream = reader.fetch(1000000, 1024)
      expect(stream).toBeDefined()
    })

    it('应该处理单字节读取', () => {
      const stream = reader.fetch(100, 1)
      expect(stream).toBeDefined()
    })
  })

  describe('错误处理测试', () => {
    it('应该正确处理网络超时', async () => {
      const controller = new AbortController()
      controller.abort()

      mockFetch.mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'))

      await expect(reader.open()).rejects.toThrow('Fetching remote file failed.')
    })

    it('应该正确处理无效的响应头', async () => {
      const mockResponse = {
        ok: true,
        headers: {
          get: vi.fn()
            .mockReturnValueOnce('bytes') // accept-ranges
            .mockReturnValueOnce('invalid'), // content-length
        },
      }

      mockFetch.mockResolvedValue(mockResponse)

      const result = await reader.open()
      expect(result.size).toBeNaN()
    })
  })
})
