import type { Filelike, FileReader } from "./types";

/**
 * CachedFilelike 提供了一个带缓存的文件类接口，用于高效读取文件数据
 * 
 * 该类实现了一个缓存机制，以减少冗余文件读取并提高文件对象的整体读取性能
 * 
 * @implements {Filelike}
 */
export default class CachedFilelike implements Filelike {
  /** 
   * 负责实际文件数据检索的文件读取器 
   * @private
   */
  #fileReader: FileReader;

  /** 
   * 文件的总大小（以字节为单位） 
   * @private
   */
  #fileSize?: number;

  /** 
   * 上一次已解析读取请求的结束位置
   * 对潜在的预读优化很有用 
   * @private
   */
  #lastResolvedCallbackEnd?: number;

  /** 
   * 创建一个新的 CachedFilelike 实例
   * 
   * @constructor
   * @param {Object} options - 构造函数配置选项
   * @param {FileReader} options.fileReader - 用于读取文件的文件读取器
   */
  constructor(options: { fileReader: FileReader }) {
    this.#fileReader = options.fileReader;
  }

  /**
   * 打开文件并初始化文件元数据
   * 
   * 此方法检索文件大小并为读取文件做准备。
   * 该方法是幂等的，可以安全地多次调用。
   * 
   * @returns {Promise<void>} 一个在文件打开时解析的 Promise
   * @throws {Error} 如果打开文件时出现问题
   */
  public async open(): Promise<void> {
    if (!this.#fileSize) {
      return;
    }
    const { size } = await this.#fileReader.open();
    this.#fileSize = size;
  }

  /**
   * 检索文件的总大小（以字节为单位）
   * 
   * @returns {number} 文件大小（字节）
   * @throws {Error} 如果文件尚未打开
   */
  public size(): number {
    if (!this.#fileSize) {
      throw new Error("CachedFilelike 尚未打开");
    }
    return this.#fileSize;
  }

  /**
   * 从文件中读取指定范围的字节
   * 
   * 此方法提供了一种异步读取文件特定部分的方式。
   * 处理了零长度读取和越界读取等边缘情况。
   * 
   * @param {number} offset - 开始读取的字节位置
   * @param {number} length - 要读取的字节数
   * @returns {Promise<Uint8Array>} 解析为读取字节的 Promise
   * @throws {Error} 如果读取参数无效或超出文件大小
   */
  public read(offset: number, length: number): Promise<Uint8Array> {
    // 处理零长度读取
    if (length === 0) {
      return Promise.resolve(new Uint8Array());
    }

    // 定义读取范围
    const range = { start: offset, end: offset + length };

    // 验证读取参数
    if (offset < 0 || length < 0) {
      throw new Error("CachedFilelike#read 输入无效");
    }

    // 可能是性能敏感操作；await 可能会很昂贵
    return new Promise((resolve, reject) => {
      this.open()
        .then(() => {
          const size = this.size();
          
          // 检查读取范围是否超出文件大小
          if (range.end > size) {
            reject(new Error(`CachedFilelike#read 超出文件大小`));
          }

          // 跟踪最后解析的读取结束位置
          this.#lastResolvedCallbackEnd = range.end;

          /** 待实现 */
          const buffer = new Uint8Array([]);

          resolve(buffer);
        })
        .catch((err) => {
          reject(err);
        });
    });
  }
}
