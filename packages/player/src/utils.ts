import type { Time } from '@rosbag-engine/parser'

// 时间转换为毫秒
export function timeToMillis(time: Time): number {
  return time.sec * 1000 + time.nsec / 1000000
}

// 毫秒转换为时间
export function millisToTime(millis: number): Time {
  const sec = Math.floor(millis / 1000)
  const nsec = (millis % 1000) * 1000000
  return { sec, nsec }
}

// 延迟函数
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 计算时间差（秒）
export function timeDifferenceInSeconds(start: Time, end: Time): number {
  const startMs = timeToMillis(start)
  const endMs = timeToMillis(end)
  return (endMs - startMs) / 1000
}

// 格式化时间显示
export function formatTime(time: Time): string {
  return `${time.sec}.${Math.floor(time.nsec / 1000000).toString().padStart(3, '0')}`
}

// 创建相对时间（从0开始）
export function createRelativeTime(absoluteTime: Time, startTime: Time): Time {
  const startMs = timeToMillis(startTime)
  const currentMs = timeToMillis(absoluteTime)
  const relativeMs = currentMs - startMs
  return millisToTime(Math.max(0, relativeMs))
}
