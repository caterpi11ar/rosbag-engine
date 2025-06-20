import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FetchReader from './index'

// Mock fetch 全局函数
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

describe('fetchReader', () => {
  const mockUrl = 'http://192.168.10.148/test-small.bag'
  let reader: FetchReader

  beforeEach(() => {
    vi.clearAllMocks()
    reader = new FetchReader(mockUrl)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    reader.destroy()
  })

  it('应该正确创建实例', () => {
    expect(reader).toBeInstanceOf(FetchReader)
    expect(() => new FetchReader(mockUrl, { headers: { test: 'value' } })).not.toThrow()
  })

  it('应该成功读取数据流', () => {
    const mockResponse = {
      ok: true,
      body: {
        getReader: () => ({
          read: () => Promise.resolve({ done: true }),
        }),
      },
    }

    mockFetch.mockResolvedValue(mockResponse)

    // 验证 read 方法可以调用不报错
    expect(() => reader.read()).not.toThrow()
  })

  it('应该正确销毁', () => {
    expect(() => reader.destroy()).not.toThrow()
  })
})
