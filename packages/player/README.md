# Rosbag Player

这是一个基于状态机设计的ROS包播放器实现。它提供了完整的播放控制功能，包括播放、暂停、跳转和速度调整。

## 架构概览

### 核心组件

1. **RosbagPlayer** - 主播放器类，实现了状态机和播放控制逻辑
2. **IIterableSource** - 数据源接口，用于从不同来源读取ROS消息
3. **PlayerState** - 播放器状态接口，包含完整的状态信息

### 状态机

播放器使用状态机模型管理不同的操作状态：

- `idle` - 空闲状态，等待用户操作
- `initialize` - 初始化数据源
- `start-play` - 开始播放准备
- `play` - 正在播放
- `seek-backfill` - 跳转并加载历史消息
- `close` - 关闭并清理资源
- `reset-playback-iterator` - 重置播放迭代器

### 主要功能

#### 播放控制
- `startPlayback()` - 开始播放
- `pausePlayback()` - 暂停播放
- `seekPlayback(time)` - 跳转到指定时间
- `setPlaybackSpeed(speed)` - 设置播放速度

#### 订阅管理
- `setSubscriptions(subscriptions)` - 设置主题订阅

#### 状态监听
- `setListener(callback)` - 设置状态变化监听器

## 使用示例

```typescript
import { RemoteDataSourceFactory } from '@rosbag-engine/parser'
import { RosbagPlayer } from '@rosbag-engine/player'

// 创建数据源
const factory = new RemoteDataSourceFactory()
const dataSource = factory.initialize({
  params: { url: 'http://example.com/my-rosbag.bag' }
})

// 创建播放器
const player = new RosbagPlayer(dataSource)

// 设置状态监听
player.setListener(async (state) => {
  console.log('当前时间:', state.currentTime)
  console.log('是否播放:', state.isPlaying)
  console.log('消息数量:', state.messages?.length || 0)
})

// 设置订阅
player.setSubscriptions([
  { topic: '/robot/pose' },
  { topic: '/robot/imu' }
])

// 控制播放
player.startPlayback()
player.setPlaybackSpeed(2.0)
player.seekPlayback({ sec: 10, nsec: 0 })
player.pausePlayback()

// 使用完毕后关闭
player.close()
```

## 与React集成

可以使用`useRosbagPlayer`钩子在React应用中集成播放器：

```typescript
import { useRosbagPlayer } from '@rosbag-engine/player/react'

function MyComponent() {
  const {
    playerState,
    isInitialized,
    startPlayback,
    pausePlayback,
    seekPlayback,
    setSubscriptions
  } = useRosbagPlayer({
    dataSource,
    autoInitialize: true
  })

  // 使用播放器功能...
}
```

## 数据源

播放器支持多种数据源：

1. **远程数据源** - 通过HTTP/HTTPS加载远程ROS包文件
2. **本地文件** - 读取本地ROS包文件
3. **模拟数据源** - 用于测试的模拟数据

## 性能优化

- 使用状态机模型避免复杂的条件逻辑
- 延迟加载和处理消息以提高性能
- 支持消息过滤以减少内存使用

## 核心文件结构

```
src/
├── Player.ts          # 主播放器实现 (RosbagPlayer)
├── DataSource.ts      # 数据源实现 (MockDataSource)
├── types.ts           # 类型定义
├── utils.ts           # 工具函数
└── index.ts           # 导出接口
```

## 扩展能力

当前的简化实现可以通过以下方式扩展：

1. **添加缓存层** - 实现消息缓存以提高性能
2. **增强错误处理** - 添加更完善的错误管理
3. **支持更多数据源** - 扩展数据源接口支持不同格式
4. **优化性能** - 添加预加载和内存管理策略

## API 文档

详细的 API 文档请参考各个组件的 TypeScript 类型定义。所有接口都有完整的类型支持。

### 主要接口

- `Player` - 播放器接口定义
- `DataSource` - 数据源接口定义
- `PlayerState` - 播放器状态类型
- `Time` - 时间类型定义
