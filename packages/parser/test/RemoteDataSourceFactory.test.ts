import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteDataSourceFactory } from '../src/adapters/RemoteDataSourceFactory'
import { WorkerIterableSource } from '../src/adapters/WorkerIterableSource'

// 测试用的 URL 常量
const TEST_URL = 'https://a.com'

// 模拟 Worker 构造函数
vi.mock('worker_threads', () => {
  return {
    Worker: vi.fn(),
  }
})

// 模拟 URL 对象
class MockURL {
  pathname: string

  constructor(url: string) {
    this.pathname = url
  }
}

// 模拟 Worker
class MockWorker {
  url: string
  options: any

  constructor(url: string, options: any) {
    this.url = url
    this.options = options
  }
}

describe('remoteDataSourceFactory', () => {
  let factory: RemoteDataSourceFactory

  // 在每个测试前重置
  beforeEach(() => {
    factory = new RemoteDataSourceFactory()

    // 模拟 URL 构造函数
    globalThis.URL = MockURL as any

    // 模拟 Worker 构造函数
    globalThis.Worker = MockWorker as any

    // 清除所有模拟的调用记录
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('initialize', () => {
    it('应该在没有提供 URL 参数时抛出错误', () => {
      expect(() => {
        factory.initialize({})
      }).toThrow('Missing url argument')
    })

    it('应该在不支持的文件扩展名时抛出错误', () => {
      // 修改 URL 对象以返回不支持的扩展名
      globalThis.URL = class MockURLUnknown {
        pathname: string
        constructor(_urlString: string) {
          this.pathname = '/file.unknown'
        }
      } as any

      expect(() => {
        factory.initialize({ params: { url: TEST_URL } })
      }).toThrow('Unsupported extension: .unknown')
    })

    it('应该正确创建 .bag 文件的 WorkerIterableSource', () => {
      // 模拟 WorkerIterableSource 构造函数
      const mockWorkerIterableSource = vi.fn()
      vi.mock('../src/adapters/WorkerIterableSource', () => {
        return {
          WorkerIterableSource: mockWorkerIterableSource,
        }
      })

      // 确保 URL 对象返回 .bag 扩展名
      globalThis.URL = class MockURLBag {
        pathname: string
        constructor(_urlString: string) {
          this.pathname = '/file.bag'
        }
      } as any

      factory.initialize({ params: { url: TEST_URL } })
    })

    it('应该处理带有查询参数的 URL', () => {
      // 模拟 URL 对象以返回正确的 pathname
      globalThis.URL = class MockURLWithQuery {
        pathname: string
        constructor(_urlString: string) {
          this.pathname = '/file.bag'
        }
      } as any

      // 模拟 WorkerIterableSource
      vi.mock('../src/adapters/WorkerIterableSource', () => {
        return {
          WorkerIterableSource: vi.fn().mockImplementation(() => ({})),
        }
      })

      factory.initialize({ params: { url: TEST_URL } })

      // 验证 WorkerIterableSource 构造函数被正确调用
      expect(vi.mocked(WorkerIterableSource)).toHaveBeenCalledWith({
        initWorker: expect.any(Function),
        initArgs: { url: TEST_URL },
      })

      // 恢复原始 WorkerIterableSource
      vi.mocked(WorkerIterableSource).mockRestore()
    })
  })

  describe('extname 函数', () => {
    // 测试内部 extname 函数的行为
    // 注意：这是一个私有函数，我们通过测试其行为间接测试它

    it('应该正确处理没有扩展名的路径', () => {
      // 修改 URL 对象以返回没有扩展名的路径
      globalThis.URL = class MockURLNoExt {
        pathname: string
        constructor(_urlString: string) {
          this.pathname = '/file'
        }
      } as any

      expect(() => {
        factory.initialize({ params: { url: TEST_URL } })
      }).toThrow('Unsupported extension:')
    })

    it('应该正确处理以点结尾的路径', () => {
      // 修改 URL 对象以返回以点结尾的路径
      globalThis.URL = class MockURLDotEnding {
        pathname: string
        constructor(_urlString: string) {
          this.pathname = '/file.'
        }
      } as any

      expect(() => {
        factory.initialize({ params: { url: TEST_URL } })
      }).toThrow('Unsupported extension:')
    })

    it('应该正确处理有扩展名的路径', () => {
      // 模拟 WorkerIterableSource
      vi.mock('../src/adapters/WorkerIterableSource', () => {
        return {
          WorkerIterableSource: vi.fn().mockImplementation(() => ({})),
        }
      })

      // 确保 URL 对象返回 .bag 扩展名
      globalThis.URL = class MockURLBag {
        pathname: string
        constructor(_urlString: string) {
          this.pathname = '/file.bag'
        }
      } as any

      factory.initialize({ params: { url: TEST_URL } })

      // 如果没有抛出错误，则表示扩展名被正确处理
      expect(vi.mocked(WorkerIterableSource)).toHaveBeenCalled()

      // 恢复原始 WorkerIterableSource
      vi.mocked(WorkerIterableSource).mockRestore()
    })
  })
})
