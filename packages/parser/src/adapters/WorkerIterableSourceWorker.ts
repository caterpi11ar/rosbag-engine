import type { TransferHandler } from 'comlink'
import type {
  GetBackfillMessagesArgs,
  IIterableSource,
  IMessageCursor,
  Immutable,
  Initalization,
  IteratorResult,
  MessageEvent,
  MessageIteratorArgs,
} from '../types'
import * as Comlink from 'comlink'

import { IteratorCursor } from '../adapters/IteratorCursor'

const isAbortSignal = (val: unknown): val is AbortSignal => val instanceof AbortSignal

const abortSignalTransferHandler: TransferHandler<AbortSignal, [boolean, MessagePort]> = {
  canHandle: isAbortSignal,
  deserialize: ([aborted, msgPort]) => {
    const controller = new AbortController()

    if (aborted) {
      controller.abort()
    }
    else {
      msgPort.onmessage = () => {
        controller.abort()
      }
    }

    return controller.signal
  },
  serialize: (abortSignal) => {
    const { port1, port2 } = new MessageChannel()
    abortSignal.addEventListener('abort', () => {
      port1.postMessage('aborted')
    })

    return [[abortSignal.aborted, port2], [port2]]
  },
}

export class WorkerIterableSourceWorker implements IIterableSource {
  protected _source: IIterableSource

  public constructor(source: IIterableSource) {
    this._source = source
  }

  public async initialize(): Promise<Initalization> {
    return await this._source.initialize()
  }

  public messageIterator(
    args: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult>> & Comlink.ProxyMarked {
    return Comlink.proxy(this._source.messageIterator(args))
  }

  public async getBackfillMessages(
    args: Omit<GetBackfillMessagesArgs, 'abortSignal'>,
    // abortSignal is a separate argument so it can be proxied by comlink since AbortSignal is not
    // clonable (and needs to signal across the worker boundary)
    abortSignal?: AbortSignal,
  ): Promise<MessageEvent[]> {
    return await this._source.getBackfillMessages({
      ...args,
      abortSignal,
    })
  }

  public getMessageCursor(
    args: Omit<Immutable<MessageIteratorArgs>, 'abort'>,
    abort?: AbortSignal,
  ): IMessageCursor & Comlink.ProxyMarked {
    const iter = this._source.messageIterator(args)
    const cursor = new IteratorCursor(iter, abort)
    return Comlink.proxy(cursor)
  }
}

Comlink.transferHandlers.set('abortsignal', abortSignalTransferHandler)
