# @rosbag-engine/parser

专业的 ROS bag 数据流解析模块，基于 Foxglove 生态系统构建，提供高性能的流式数据处理和 Web Worker 支持。

## 特性

- 🚀 **流式解析**：支持大文件的流式处理和增量下载
- 🌐 **多数据源**：本地文件、远程 URL 支持
- ⚡ **高性能**：基于 Foxglove 的优化算法，支持内存缓存和重叠块检测
- 🔧 **Web Worker**：通过 Worker 隔离实现无阻塞的后台解析
- 💪 **TypeScript**：完整的类型定义
- 🛡️ **错误恢复**：完善的错误处理和连接恢复机制
- 📦 **批处理**：智能批处理优化渲染性能

## 依赖

本模块基于以下核心依赖：

- `@foxglove/rosbag` - ROS bag 文件解析
- `@foxglove/rosmsg` - ROS 消息定义解析
- `@foxglove/rosmsg-serialization` - ROS 消息序列化/反序列化
- `@rosbag-engine/downloader` - 流式下载和缓存功能
- `comlink` - Web Worker 通信
- `lz4js` - LZ4 解压缩支持

## 快速开始

### 基本使用

```typescript
import { RemoteDataSourceFactory } from '@rosbag-engine/parser'

const factory = new RemoteDataSourceFactory()

// 创建数据源
const dataSource = factory.initialize({
  params: { url: 'https://example.com/data.bag' }
})

// 初始化并获取文件信息
const info = await dataSource.initialize()
console.log(`Format: ${info.format}`)
console.log(`Topics: ${info.topics.map(t => t.name).join(', ')}`)
console.log(`Duration: ${info.endTime?.sec - info.startTime?.sec}s`)

// 遍历消息
for await (const result of dataSource.messageIterator({})) {
  if (result.type === 'message-event') {
    const message = result.msgEvent
    console.log(`${message.topic}: ${message.receiveTime.sec}s`)
    console.log('Message data:', message.message)
  }
}

await dataSource.terminate()
```

### 远程 ROS bag 文件处理

```typescript
// 处理远程 ROS bag 文件（自动使用流式下载和缓存）
const dataSource = factory.initialize({
  params: { url: 'https://cdn.example.com/large-dataset.bag' }
})

// 自动使用 200MB 缓存来优化下载性能
const info = await dataSource.initialize()
console.log(`Connections: ${info.connections.size}`)
console.log(`Start time: ${info.startTime?.sec}s`)
console.log(`End time: ${info.endTime?.sec}s`)

// 处理所有消息
for await (const result of dataSource.messageIterator({})) {
  if (result.type === 'message-event') {
    const message = result.msgEvent
    if (message.topic === '/camera/image_raw') {
      // 处理图像数据
      console.log(`Image size: ${message.sizeInBytes} bytes`)
    }
  }
}
```

### 消息过滤和时间范围查询

```typescript
const dataSource = factory.initialize({
  params: { url: 'https://example.com/data.bag' }
})

const info = await dataSource.initialize()

// 只读取特定时间段和话题的数据
const topicsSet = new Set(['/cmd_vel', '/odom'])
for await (const result of dataSource.messageIterator({
  topics: topicsSet,
  start: { sec: 1640000000, nsec: 0 },
  end: { sec: 1640000010, nsec: 0 }
})) {
  if (result.type === 'message-event') {
    const message = result.msgEvent
    console.log(`${message.topic} at ${message.receiveTime.sec}s`)

    // 根据消息类型处理
    if (message.schemaName === 'geometry_msgs/Twist') {
      const twist = message.message as any
      console.log(`Linear: ${twist.linear.x}, Angular: ${twist.angular.z}`)
    }
  }
}
```

### 使用消息游标进行精确控制

```typescript
const dataSource = factory.initialize({
  params: { url: 'https://example.com/data.bag' }
})

await dataSource.initialize()

// 创建消息游标
const cursor = dataSource.getMessageCursor({
  topics: new Set(['/camera/image']),
  start: { sec: 1640000000, nsec: 0 }
})

try {
  // 批量读取消息（17ms 批处理，优化渲染性能）
  const batch = await cursor.nextBatch(17)
  if (batch) {
    for (const result of batch) {
      if (result.type === 'message-event') {
        console.log(`Message: ${result.msgEvent.topic}`)
      }
    }
  }

  // 读取到指定时间
  const untilResults = await cursor.readUntil({ sec: 1640000005, nsec: 0 })
  console.log(`Read ${untilResults?.length} results until timestamp`)
}
finally {
  await cursor.end()
}
```

### 性能监控

```typescript
const dataSource = factory.initialize({
  params: { url: 'https://example.com/data.bag' }
})

await dataSource.initialize()

// 监控消息处理性能
let messageCount = 0
let totalSize = 0
const startTime = Date.now()

for await (const result of dataSource.messageIterator({})) {
  if (result.type === 'message-event') {
    messageCount++
    totalSize += result.msgEvent.sizeInBytes

    if (messageCount % 1000 === 0) {
      const elapsed = (Date.now() - startTime) / 1000
      console.log(`Processed ${messageCount} messages in ${elapsed}s`)
      console.log(`Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`)
      console.log(`Rate: ${(messageCount / elapsed).toFixed(2)} msg/s`)
    }
  }
}
```

## API 参考

### RemoteDataSourceFactory

远程数据源工厂，用于创建基于 Web Worker 的数据源。

#### 方法

- `initialize(args: DataSourceFactoryInitializeArgs)` - 创建数据源实例

### IDataSourceFactory

数据源工厂接口。

```typescript
interface IDataSourceFactory {
  initialize: (args: DataSourceFactoryInitializeArgs) => WorkerIterableSource
}
```

### DataSourceFactoryInitializeArgs

数据源初始化参数。

```typescript
interface DataSourceFactoryInitializeArgs {
  file?: File
  files?: File[]
  params?: Record<string, string | undefined>
}
```

### IIterableSource

可迭代数据源接口，基于 Foxglove 标准。

#### 方法

- `initialize()` - 初始化数据源
- `messageIterator(args: MessageIteratorArgs)` - 创建消息迭代器
- `getMessageCursor(args: MessageIteratorArgs & { abort?: AbortSignal })` - 创建消息游标
- `getBackfillMessages(args: GetBackfillMessagesArgs)` - 获取回填消息
- `terminate()` - 终止数据源

### IMessageCursor

消息游标接口，提供精确的消息控制。

#### 方法

- `next()` - 读取下一条消息
- `nextBatch(durationMs: number)` - 读取一批消息（按时长）
- `readUntil(end: Time)` - 读取到指定时间
- `end()` - 结束游标并释放资源

### Initalization

初始化结果对象。

```typescript
interface Initalization {
  startTime?: Time
  endTime?: Time
  topics: Topic[]
  connections: Map<number, Connection>
  messageCount?: number
  format: string
}
```

### MessageEvent

消息事件对象。

```typescript
interface MessageEvent<T = unknown> {
  topic: string
  receiveTime: Time
  sizeInBytes: number
  message: T
  schemaName?: string
}
```

### IteratorResult

迭代器结果，支持多种类型。

```typescript
type IteratorResult
  = | { type: 'message-event', msgEvent: MessageEvent }
    | { type: 'problem', connectionId: number, problem: PlayerProblem }
    | { type: 'stamp', stamp: Time }
```

### MessageIteratorArgs

消息迭代器参数。

```typescript
interface MessageIteratorArgs {
  topics?: ReadonlySet<string>
  start?: Time
  end?: Time
  reverse?: boolean
  consumptionType?: 'full' | 'partial'
}
```

### Time

时间戳定义。

```typescript
interface Time {
  sec: number
  nsec: number
}
```

## ROS bag 格式支持

### ✅ 完整支持特性

- **自动检测**：通过 `.bag` 扩展名自动识别
- **流式下载**：支持大文件的增量下载和缓存
- **消息解析**：完整的 ROS 消息定义解析和反序列化
- **性能优化**：重叠块检测、消息大小缓存
- **LZ4 解压**：支持 LZ4 压缩的 bag 文件
- **Web Worker**：后台解析，不阻塞主线程

### 支持的消息类型

本模块支持所有标准 ROS 消息类型，包括但不限于：

- `std_msgs/*` - 标准消息
- `geometry_msgs/*` - 几何消息（Pose, Twist, Transform 等）
- `sensor_msgs/*` - 传感器消息（Image, PointCloud2, LaserScan 等）
- `nav_msgs/*` - 导航消息（OccupancyGrid, Odometry, Path 等）
- 自定义消息类型

### 性能特性

- **智能缓存**：200MB 缓存策略，优化网络 I/O
- **重叠块检测**：自动检测和警告性能问题
- **消息大小估算**：缓存估算结果，提高迭代性能
- **批处理优化**：17ms 批处理策略，优化渲染性能
- **内存优化**：避免数据拷贝和内存泄漏
- **错误恢复**：连接解析失败时的 graceful 降级

## Web Worker 架构

本模块使用 Web Worker 架构，确保解析过程不会阻塞主线程：

```typescript
// Worker 在后台处理繁重的解析工作
const source = new WorkerIterableSource({
  initWorker: () => new Worker(/* worker script */),
  initArgs: { url: 'https://example.com/data.bag' }
})

// 主线程通过 Comlink 与 Worker 通信
const info = await source.initialize()

// 消息迭代器自动处理 Worker 通信
for await (const result of source.messageIterator({})) {
  // 处理解析结果
}
```

### Worker 通信

- 使用 `comlink` 实现类型安全的 Worker 通信
- 自动处理 Worker 生命周期管理
- 支持中断信号（AbortSignal）
- 资源自动清理和释放

## 与现有代码集成

本模块设计为与您现有的流式下载功能无缝集成：

```typescript
// 使用您现有的 BrowserHttpReader 和 CachedFilelike
import { BrowserHttpReader, CachedFilelike } from '@rosbag-engine/downloader'

// BagIterableSource 中的集成示例
const fileReader = new BrowserHttpReader(url)
const cachedReader = new CachedFilelike({
  fileReader,
  cacheBlockSize: 1024 * 1024 * 200 // 200MB 缓存
})

await cachedReader.open()
// 自动享受增量下载和智能缓存的好处
```

## 性能优化

### 网络优化

- **智能缓存**：200MB 默认缓存，可配置
- **增量下载**：只下载需要的数据块
- **连接复用**：高效的 HTTP 连接管理
- **断线重连**：自动重连和恢复机制

### 内存优化

- **流式处理**：避免大文件的内存占用
- **数据拷贝优化**：避免保持对大块数据的引用
- **Web Worker 隔离**：主线程内存压力减少
- **消息估算缓存**：避免重复计算消息大小

### 渲染优化

- **批处理策略**：17ms 批处理优化 60fps 渲染
- **时间切片**：避免长时间阻塞主线程
- **重叠块检测**：性能问题自动检测和警告

## 错误处理

```typescript
try {
  const dataSource = factory.initialize({
    params: { url: 'https://example.com/data.bag' }
  })

  const info = await dataSource.initialize()

  for await (const result of dataSource.messageIterator({})) {
    if (result.type === 'problem') {
      console.warn(`Connection ${result.connectionId}:`, result.problem.message)
      continue
    }

    if (result.type === 'message-event') {
      // 处理消息...
    }
  }
}
catch (error) {
  if (error.message.includes('Failed to initialize ROS bag')) {
    console.error('ROS bag 文件初始化失败:', error.message)
  }
  else if (error.message.includes('Unsupported extension')) {
    console.error('不支持的文件格式')
  }
  else if (error.message.includes('Missing url argument')) {
    console.error('缺少 URL 参数')
  }
  else {
    console.error('未知错误:', error)
  }
}

// 监听解析警告
// 重叠块警告会自动输出到 console.warn
```

## 调试和监控

```typescript
// 启用详细日志
const dataSource = factory.initialize({
  params: { url: 'https://example.com/data.bag' }
})

const info = await dataSource.initialize()

console.log('Data source info:', {
  format: info.format,
  topicCount: info.topics.length,
  connectionCount: info.connections.size,
  duration: info.endTime && info.startTime
    ? info.endTime.sec - info.startTime.sec
    : 'unknown'
})

// 监控消息处理和问题
const topicStats = new Map<string, number>()
const problemStats = new Map<number, number>()

for await (const result of dataSource.messageIterator({})) {
  switch (result.type) {
    case 'message-event': {
      const count = topicStats.get(result.msgEvent.topic) || 0
      topicStats.set(result.msgEvent.topic, count + 1)
      break
    }
    case 'problem': {
      const count = problemStats.get(result.connectionId) || 0
      problemStats.set(result.connectionId, count + 1)
      console.warn(`Connection ${result.connectionId}:`, result.problem.message)
      break
    }
    case 'stamp': {
      console.log(`Time stamp: ${result.stamp.sec}.${result.stamp.nsec}`)
      break
    }
  }
}

console.log('Topic statistics:', Object.fromEntries(topicStats))
console.log('Problem statistics:', Object.fromEntries(problemStats))
```

## 开发计划

- [x] ✅ 完成 ROS bag 格式支持（基于 @foxglove/rosbag）
- [x] ✅ 集成流式下载和缓存功能
- [x] ✅ 实现 Web Worker 架构
- [x] ✅ 实现性能优化和错误处理
- [x] ✅ 消息游标和批处理支持
- [ ] 🚧 完成 MCAP 格式支持
- [ ] 📋 添加本地文件支持
- [ ] 📋 实现消息转换和导出功能
- [ ] 📋 添加数据可视化支持
- [ ] 📋 优化大文件处理性能
- [ ] 📋 添加 ROS 2 bag 支持

## 许可证

Mozilla Public License 2.0
