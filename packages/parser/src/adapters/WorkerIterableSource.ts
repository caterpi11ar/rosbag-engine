import type {
  GetBackfillMessagesArgs,
  IIterableSource,
  IMessageCursor,
  Immutable,
  Initalization,
  IterableSourceInitializeArgs,
  IteratorResult,
  MessageEvent,
  MessageIteratorArgs,
  Time,
} from '../types'
import type { WorkerIterableSourceWorker } from './WorkerIterableSourceWorker'
import * as Comlink from 'comlink'

interface ConstructorArgs {
  initWorker: () => Worker
  initArgs: Immutable<IterableSourceInitializeArgs>
}

export class WorkerIterableSource implements IIterableSource {
  readonly #args: ConstructorArgs
  #sourceWorkerRemote?: Comlink.Remote<WorkerIterableSourceWorker>
  #disposeRemote?: () => void

  public constructor(args: ConstructorArgs) {
    this.#args = args
  }

  public async initialize(): Promise<Initalization> {
    this.#disposeRemote?.()

    // 启动 worker
    const worker = this.#args.initWorker()

    const wrapped = Comlink.wrap<
      (args: Immutable<IterableSourceInitializeArgs>) => Comlink.Remote<WorkerIterableSourceWorker>
    >(worker)

    this.#disposeRemote = () => wrapped[Comlink.releaseProxy]()
    this.#sourceWorkerRemote = await wrapped(this.#args.initArgs)
    return await this.#sourceWorkerRemote.initialize()
  }

  public async* messageIterator(
    args: Immutable<MessageIteratorArgs>,
  ): AsyncIterableIterator<Readonly<IteratorResult>> {
    if (this.#sourceWorkerRemote === undefined) {
      throw new Error(`WorkerIterableSource is not initialized`)
    }

    const cursor = this.getMessageCursor(args)
    try {
      for (;;) {
        // The fastest framerate that studio renders at is 60fps. So to render a frame studio needs
        // at minimum ~16 milliseconds of messages before it will render a frame. Here we fetch
        // batches of 17 milliseconds so that one batch fetch could result in one frame render.
        // Fetching too much in a batch means we cannot render until the batch is returned.
        const results = await cursor.nextBatch(17 /* milliseconds */)
        if (!results || results.length === 0) {
          break
        }
        yield* results
      }
    }
    finally {
      await cursor.end()
    }
  }

  public getMessageCursor(
    args: Immutable<MessageIteratorArgs> & { abort?: AbortSignal },
  ): IMessageCursor {
    if (this.#sourceWorkerRemote === undefined) {
      throw new Error('WorkerIterableSource is not initialized')
    }

    const { abort, ...rest } = args
    // getMessageCursor is a Remote function, not a property, so we must call it directly

    const messageCursorPromise = this.#sourceWorkerRemote.getMessageCursor(rest, abort)

    const cursor: IMessageCursor = {
      async next() {
        const messageCursor = await messageCursorPromise
        return await messageCursor.next()
      },

      async nextBatch(durationMs: number) {
        const messageCursor = await messageCursorPromise
        return await messageCursor.nextBatch(durationMs)
      },

      async readUntil(end: Time) {
        const messageCursor = await messageCursorPromise
        return await messageCursor.readUntil(end)
      },

      async end() {
        const messageCursor = await messageCursorPromise
        try {
          await messageCursor.end()
        }
        finally {
          messageCursor[Comlink.releaseProxy]()
        }
      },
    }

    return cursor
  }

  public async getBackfillMessages(
    args: GetBackfillMessagesArgs,
  ): Promise<MessageEvent[]> {
    if (this.#sourceWorkerRemote === undefined) {
      throw new Error('WorkerIterableSource is not initialized')
    }
    const { abortSignal, ...rest } = args
    return await this.#sourceWorkerRemote.getBackfillMessages(rest, abortSignal)
  }

  public async terminate(): Promise<void> {
    this.#disposeRemote?.()
    this.#disposeRemote = undefined
    this.#sourceWorkerRemote = undefined
  }
}
