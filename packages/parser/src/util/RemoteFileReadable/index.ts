import BrowserHttpReader from '../BrowserHttpReader'
import CachedFilelike from '../CachedFilelike'

export class RemoteFileReadable {
  #remoteReader: CachedFilelike

  public constructor(url: string) {
    const fileReader = new BrowserHttpReader(url)
    this.#remoteReader = new CachedFilelike({
      fileReader,
    })
  }

  public async open(): Promise<void> {
    await this.#remoteReader.open() // Important that we call this first, because it might throw an error if the file can't be read.
  }

  public async size(): Promise<bigint> {
    return BigInt(this.#remoteReader.size())
  }

  public async read(offset: bigint, size: bigint): Promise<Uint8Array> {
    if (offset + size > Number.MAX_SAFE_INTEGER) {
      throw new Error(`Read too large: offset ${offset}, size ${size}`)
    }
    return await this.#remoteReader.read(Number(offset), Number(size))
  }
}
