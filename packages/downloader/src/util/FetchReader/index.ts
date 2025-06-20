import type { EventTypes } from './types'
import { EventEmitter } from 'eventemitter3'

export default class FetchReader extends EventEmitter<EventTypes> {
  #response: Promise<Response>
  #reader?: ReadableStreamDefaultReader<Uint8Array>
  #controller: AbortController
  #aborted: boolean = false
  #url: string

  public constructor(url: string, options?: RequestInit) {
    super()
    this.#url = url
    this.#controller = new AbortController()
    this.#response = fetch(url, { ...options, signal: this.#controller.signal })
  }

  // you can only call getReader once on a response body
  // so keep a local copy of the reader and return it after the first call to get a reader
  async #getReader(): Promise<ReadableStreamDefaultReader<Uint8Array> | undefined> {
    if (this.#reader) {
      return this.#reader
    }
    let data: Response
    try {
      data = await this.#response
    }
    catch (err) {
      const error = err instanceof Error ? err : new Error(`GET <${this.#url}> failed: ${err}`)
      this.emit('error', error)
      return undefined
    }
    if (!data.ok) {
      const errMsg = data.statusText
      this.emit(
        'error',
        new Error(
          `GET <$${this.#url}> failed with status ${data.status}${errMsg ? ` (${errMsg})` : ``}`,
        ),
      )
      return undefined
    }

    if (!data.body) {
      this.emit('error', new Error(`GET <${this.#url}> succeeded, but returned no data`))
      return undefined
    }

    // The fetch succeeded, but there might still be an error streaming.
    try {
      // When a stream is closed or errors, any reader it is locked to is released.
      // If the getReader method is called on an already locked stream, an exception will be thrown.
      // This is caused by server-side errors, but we should catch it anyway.
      this.#reader = data.body.getReader()
    }
    catch (err) {
      this.emit('error', new Error(`GET <${this.#url}> succeeded, but failed to stream: ${err}`))
      return undefined
    }

    return this.#reader
  }

  public read(): void {
    this.#getReader()
      .then((reader) => {
        // if no reader is returned then we've encountered an error
        if (!reader) {
          return
        }
        reader
          .read()
          .then(({ done, value }) => {
            // no more to read, signal stream is finished
            if (done) {
              this.emit('end')
              return
            }
            this.emit('data', value)
            this.read()
          })
          .catch((unk) => {
            // canceling the xhr request causes the promise to reject
            if (this.#aborted) {
              this.emit('end')
              return
            }
            const err = unk instanceof Error ? unk : new Error(unk as string)
            this.emit('error', err)
          })
      })
      .catch((unk) => {
        const err = unk instanceof Error ? unk : new Error(unk as string)
        this.emit('error', err)
      })
  }

  public destroy(): void {
    this.#aborted = true
    this.#controller.abort()
  }
}
