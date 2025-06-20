import { BagIterableSource } from '@rosbag-engine/parser'

export function MockDataSource() {
  return new BagIterableSource({
    type: 'url',
    url: 'https://a.com',
  })
}
