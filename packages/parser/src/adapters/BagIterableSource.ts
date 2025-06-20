import type {
  DataSourceInput,
  GetBackfillMessagesArgs,
  IIterableSource,
  Initalization,
  IteratorResult,
  MessageEvent,
  MessageIteratorArgs,
  Topic,
} from '../types'
import { Bag, type Filelike } from '@foxglove/rosbag'
import { BlobReader } from '@foxglove/rosbag/web'
import { parse as parseMessageDefinition } from '@foxglove/rosmsg'
import { MessageReader } from '@foxglove/rosmsg-serialization'
import { compare } from '@foxglove/rostime'
import { BrowserHttpReader, CachedFilelike } from '@rosbag-engine/downloader'
import { decompress } from 'lz4js'

// ROS bag 数据源实现
export class BagIterableSource implements IIterableSource {
  private bag?: Bag
  private readersByConnectionId = new Map<number, MessageReader>()
  private datatypesByConnectionId = new Map<number, string>()
  private messageSizeEstimateByTopic: Record<string, number> = {}

  constructor(private input: DataSourceInput) {}

  private async createRemoteFileLike(url: string): Promise<Filelike> {
    const fileReader = new BrowserHttpReader(url)
    const remoteReader = new CachedFilelike({
      fileReader,
      cacheSizeInBytes: 1024 * 1024 * 200, // 200MiB,
    })

    // 调用 open 方法，检查是否可以访问远程文件
    await remoteReader.open()
    return remoteReader
  }

  async initialize(): Promise<Initalization> {
    try {
      let fileLike: Filelike

      // 根据输入类型创建相应的 fileLike 对象
      switch (this.input.type) {
        case 'file':
          fileLike = new BlobReader(this.input.file)
          break

        case 'url':
          fileLike = await this.createRemoteFileLike(this.input.url)
          break

        case 'stream':
          throw new Error('Stream input not yet supported for ROS bags')

        default:
          throw new Error('Unsupported input type')
      }

      // 创建 bag 实例
      this.bag = new Bag(fileLike, {
        parse: false, // 延迟解析以提高性能
        decompress: {
          /** 兼容windows下lz4解压 */
          lz4: (buffer: Uint8Array) => Uint8Array.from(decompress(buffer)),
        },
      })

      await this.bag.open()

      const topics = new Map<string, Topic>()

      // 为每个连接创建消息读取器
      for (const [id, connection] of this.bag.connections) {
        const schemaName = connection.type
        if (!schemaName) {
          continue
        }

        const existingTopic = topics.get(connection.topic)
        if (!existingTopic) {
          topics.set(connection.topic, { name: connection.topic, schemaName })
        }

        const parsedDefinition = parseMessageDefinition(
          connection.messageDefinition,
        )
        const reader = new MessageReader(parsedDefinition)
        this.readersByConnectionId.set(id, reader)

        this.datatypesByConnectionId.set(id, schemaName)
      }

      return {
        start: this.bag.startTime ?? { sec: 0, nsec: 0 },
        end: this.bag.endTime ?? { sec: 0, nsec: 0 },
        topics: Array.from(topics.values()),
      }
    }
    catch (error) {
      throw new Error(`Failed to initialize ROS bag: ${error}`)
    }
  }

  async* messageIterator(
    args: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult>> {
    if (!this.bag) {
      throw new Error('Data source not initialized')
    }

    const end = args.end

    const iterator = this.bag.messageIterator({
      topics: args.topics ? Array.from(args.topics.keys()) : undefined,
      reverse: args.reverse,
      start: args.start,
    })

    for await (const bagMsgEvent of iterator) {
      const connectionId = bagMsgEvent.connectionId
      const reader = this.readersByConnectionId.get(connectionId)

      if (end && compare(bagMsgEvent.timestamp, end) > 0) {
        return
      }

      const schemaName = this.datatypesByConnectionId.get(connectionId)

      if (!schemaName) {
        return
      }

      if (reader) {
        const dataCopy = bagMsgEvent.data.slice()
        const parsedMessage = reader.readMessage(dataCopy)

        const msgSizeEstimate
          = this.messageSizeEstimateByTopic[bagMsgEvent.topic]

        yield {
          type: 'message-event',
          msgEvent: {
            topic: bagMsgEvent.topic,
            receiveTime: bagMsgEvent.timestamp,
            sizeInBytes: Math.max(bagMsgEvent.data.byteLength, msgSizeEstimate),
            message: parsedMessage,
            schemaName,
          },
        }
      }
    }
  }

  async getBackfillMessages(
    args: GetBackfillMessagesArgs,
  ): Promise<MessageEvent[]> {
    if (!this.bag) {
      throw new Error('Data source not initialized')
    }

    const messages: MessageEvent[] = []

    // 为每个话题单独获取最新消息
    // 这样避免了为了找到一个话题的旧消息而遍历大量无关消息
    for (const entry of args.topics.entries()) {
      const iterator = this.messageIterator({
        topics: new Map([entry]),
        start: args.time,
        reverse: true,
      })

      for await (const result of iterator) {
        if (result.type === 'message-event') {
          messages.push(result.msgEvent)
        }
        break
      }
    }

    messages.sort((a, b) => compare(a.receiveTime, b.receiveTime))

    return messages
  }
}
