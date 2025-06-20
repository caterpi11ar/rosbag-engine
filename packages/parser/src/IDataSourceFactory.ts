import type { WorkerIterableSource } from './adapters/WorkerIterableSource'
import type { DataSourceFactoryInitializeArgs } from './types'

export interface IDataSourceFactory {
  /**
   * Initialize the source.
   */
  initialize: (args: DataSourceFactoryInitializeArgs) => WorkerIterableSource
}
