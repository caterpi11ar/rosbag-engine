# @rosbag-engine/parser

ROSBag 文件解析器模块，提供高效的远程文件读取和缓存机制，专为处理大型 ROSBag 文件而设计。

## 🚀 核心特性

- **远程文件读取**: 支持 HTTP Range 请求，可直接读取网络上的 ROSBag 文件
- **智能缓存**: 实现了高效的缓存机制，减少重复的网络请求
- **流式处理**: 基于事件的流式数据处理，支持大文件解析
- **TypeScript 支持**: 完整的 TypeScript 类型定义
- **浏览器兼容**: 专为浏览器环境优化，支持现代 Web 标准

## 📦 安装

```bash
npm install @rosbag-engine/parser
```

## 🏗️ 核心架构

### 1. RemoteFileReadable - 远程文件读取器

`RemoteFileReadable` 是最高层的接口，提供简单易用的远程文件读取功能。

```typescript
import { RemoteFileReadable } from '@rosbag-engine/parser'

const reader = new RemoteFileReadable('https://example.com/data.bag')

// 打开文件
await reader.open()

// 获取文件大小
const size = await reader.size()

// 读取指定范围的数据
const data = await reader.read(0n, 1024n)
```

**核心功能:**
- 自动处理文件打开和大小获取
- 支持大文件（使用 BigInt 处理超大偏移量）
- 内置错误处理和验证

### 2. CachedFilelike - 缓存文件接口

`CachedFilelike` 实现了智能缓存机制，是整个系统的核心。

```typescript
import { BrowserHttpReader, CachedFilelike } from '@rosbag-engine/parser'

const fileReader = new BrowserHttpReader('https://example.com/data.bag')
const cachedFile = new CachedFilelike({ fileReader })

await cachedFile.open()
const data = await cachedFile.read(offset, length)
```

**核心功能:**
- **缓存策略**: 实现 LRU 缓存，优化内存使用
- **预读机制**: 智能预测下一个可能读取的数据块
- **错误恢复**: 支持网络断线重连和错误重试
- **性能优化**: 避免重复下载已缓存的数据

### 3. BrowserHttpReader - HTTP 读取器

`BrowserHttpReader` 处理 HTTP Range 请求，实现精确的字节范围读取。

```typescript
import { BrowserHttpReader } from '@rosbag-engine/parser'

const reader = new BrowserHttpReader('https://example.com/data.bag')

// 验证服务器支持 Range 请求
const { size, identifier } = await reader.open()

// 获取指定范围的数据流
const stream = reader.fetch(1024, 512)
```

**核心功能:**
- **Range Request 支持**: 自动检测服务器是否支持字节范围请求
- **智能验证**: 使用 GET + abort 而非 HEAD 请求，提高兼容性
- **缓存控制**: 使用 'no-store' 避免浏览器缓存干扰
- **错误处理**: 详细的错误信息和状态码处理

### 4. FetchReader - 流式数据读取器

`FetchReader` 基于 EventEmitter 实现流式数据读取。

```typescript
import { FetchReader } from '@rosbag-engine/parser'

const reader = new FetchReader('https://example.com/data.bag', {
  headers: { range: 'bytes=0-1023' }
})

reader.on('data', (chunk) => {
  console.log('收到数据:', chunk)
})

reader.on('error', (error) => {
  console.error('读取错误:', error)
})

reader.on('end', () => {
  console.log('读取完成')
})

reader.read()
```

**核心功能:**
- **事件驱动**: 基于 EventEmitter 的异步事件处理
- **流控制**: 支持暂停、恢复和取消操作
- **错误处理**: 完善的错误捕获和状态管理
- **资源管理**: 自动清理和资源释放

## 🔧 使用示例

### 基本用法

```typescript
import { RemoteFileReadable } from '@rosbag-engine/parser'

async function readRosbagFile() {
  const reader = new RemoteFileReadable('https://example.com/data.bag')

  try {
    await reader.open()
    const fileSize = await reader.size()
    console.log(`文件大小: ${fileSize} 字节`)

    // 读取文件头部
    const header = await reader.read(0n, 1024n)
    console.log('文件头部:', header)
  }
  catch (error) {
    console.error('读取失败:', error)
  }
}
```

### 高级缓存配置

```typescript
import { BrowserHttpReader, CachedFilelike } from '@rosbag-engine/parser'

const fileReader = new BrowserHttpReader('https://example.com/large-file.bag')
const cachedFile = new CachedFilelike({
  fileReader,
  // 可以在此处添加缓存配置选项
})

// 顺序读取优化
let offset = 0
const chunkSize = 4096

while (offset < fileSize) {
  const chunk = await cachedFile.read(offset, chunkSize)
  // 处理数据块
  processChunk(chunk)
  offset += chunkSize
}
```

### 事件监听和错误处理

```typescript
import { FetchReader } from '@rosbag-engine/parser'

function createStreamReader(url: string) {
  const reader = new FetchReader(url)

  reader.on('data', (chunk) => {
    // 处理数据流
    console.log(`接收到 ${chunk.length} 字节`)
  })

  reader.on('error', (error) => {
    console.error('流读取错误:', error.message)
    // 实现重试逻辑
    setTimeout(() => reader.read(), 1000)
  })

  reader.on('end', () => {
    console.log('数据流读取完成')
    reader.destroy()
  })

  return reader
}
```

## 🧪 测试

运行测试套件：

```bash
npm test
```

测试覆盖核心功能：
- 远程文件读取
- 缓存机制验证
- 错误处理测试
- 流式数据处理
- 边界条件测试

## 📋 API 参考

### RemoteFileReadable

| 方法 | 参数 | 返回值 | 描述 |
|------|------|--------|------|
| `constructor(url)` | `url: string` | - | 创建远程文件读取器 |
| `open()` | - | `Promise<void>` | 打开文件连接 |
| `size()` | - | `Promise<bigint>` | 获取文件大小 |
| `read(offset, size)` | `offset: bigint, size: bigint` | `Promise<Uint8Array>` | 读取指定范围数据 |

### CachedFilelike

| 方法 | 参数 | 返回值 | 描述 |
|------|------|--------|------|
| `constructor(options)` | `{ fileReader: FileReader }` | - | 创建缓存文件接口 |
| `open()` | - | `Promise<void>` | 初始化文件元数据 |
| `size()` | - | `number` | 获取文件大小 |
| `read(offset, length)` | `offset: number, length: number` | `Promise<Uint8Array>` | 读取数据（带缓存） |

### BrowserHttpReader

| 方法 | 参数 | 返回值 | 描述 |
|------|------|--------|------|
| `constructor(url)` | `url: string` | - | 创建 HTTP 读取器 |
| `open()` | - | `Promise<{size: number, identifier?: string}>` | 验证文件并获取信息 |
| `fetch(offset, length)` | `offset: number, length: number` | `FileStream` | 获取数据流 |

### FetchReader

| 方法 | 参数 | 返回值 | 描述 |
|------|------|--------|------|
| `constructor(url, options?)` | `url: string, options?: RequestInit` | - | 创建流读取器 |
| `read()` | - | `void` | 开始读取数据流 |
| `destroy()` | - | `void` | 销毁读取器并释放资源 |

## 🔗 相关项目

这个模块是 `rosbag-engine` 项目的一部分，专门处理 ROSBag 文件的解析和读取。

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

> 该项目专为处理大型 ROSBag 文件而优化，提供了完整的远程文件读取和缓存解决方案。
