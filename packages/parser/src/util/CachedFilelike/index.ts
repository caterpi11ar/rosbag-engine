import type { Filelike } from '@foxglove/rosbag'
import type { FileReader } from './types'

export default class CachedFilelike implements Filelike {
  fileReader: FileReader
  fileSize?: number

  constructor() {}

  public async open(): Promise<void> {
    if (!this.fileSize) {
      return
    }
    const { size } = await this.fileReader.open()
    this.fileSize = size
  }

  public size(): number {
    if (!this.fileSize) {
      throw new Error('CachedFilelike has not been opened')
    }
    return this.fileSize
  }

  public read(offset: number, length: number): Promise<Uint8Array> {
    if (length === 0) {
      return Promise.resolve(new Uint8Array())
    }

    const range = { start: offset, end: offset + length }

    if (offset < 0 || length < 0) {
      throw new Error('CachedFilelike#read invalid input')
    }

    // Potentially performance-sensitive; await can be expensive
    return new Promise((resolve, reject) => {
      this.open()
        .then(() => {
          const size = this.size()
          if (range.end > size) {
            reject(new Error(`CachedFilelike#read past size`))
          }
        })
        .catch((err) => {
          reject(err)
        })
    })
  }
}
