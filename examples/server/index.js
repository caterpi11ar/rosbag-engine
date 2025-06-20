import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// 获取当前脚本的目录路径
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 解析命令行参数
const port = process.argv[2] || 8000

// 创建 HTTP 服务器
const server = http.createServer(async (req, res) => {
  // 允许跨域请求
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET')

  // 只处理 GET 请求
  if (req.method !== 'GET') {
    res.statusCode = 405
    res.end('Method Not Allowed')
    return
  }

  // 解析请求路径
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`)
  const filePath = path.join(__dirname, `.${parsedUrl.pathname}`)

  try {
    // 检查文件是否存在并获取文件信息
    const stats = await fs.stat(filePath)

    // 确保请求的是文件而不是目录
    if (!stats.isFile()) {
      res.statusCode = 403
      res.end('Forbidden')
      return
    }

    // 处理 Range 请求头
    const range = req.headers.range

    if (!range) {
      // 普通请求（无 Range 头）- 返回完整文件
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader('Content-Length', stats.size)
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`)
      res.setHeader('Accept-Ranges', 'bytes')

      // 创建文件流并管道到响应
      const fileStream = createReadStream(filePath)
      fileStream.pipe(res)

      // 处理流错误
      fileStream.on('error', (err) => {
        console.error('File stream error:', err)
        res.statusCode = 500
        res.end('Internal Server Error')
      })

      return
    }

    // 解析 Range 请求头
    const parts = range.replace(/bytes=/, '').split('-')
    const start = Number.parseInt(parts[0], 10)
    const end = parts[1] ? Number.parseInt(parts[1], 10) : stats.size - 1

    // 验证范围有效性
    if (start >= stats.size) {
      res.statusCode = 416
      res.setHeader('Content-Range', `bytes */${stats.size}`)
      res.end('Requested Range Not Satisfiable')
      return
    }

    // 计算实际范围和内容长度
    const contentLength = end - start + 1

    // 返回 206 Partial Content
    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`)
    res.setHeader('Content-Length', contentLength)
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`)
    res.setHeader('Accept-Ranges', 'bytes')

    // 创建文件流并设置起始位置
    const fileStream = createReadStream(filePath, { start, end })
    fileStream.pipe(res)

    // 处理流错误
    fileStream.on('error', (err) => {
      console.error('File stream error:', err)
      res.statusCode = 500
      res.end('Internal Server Error')
    })
  }
  catch (err) {
    // 处理各种错误情况
    if (err.code === 'ENOENT') {
      res.statusCode = 404
      res.end('File Not Found')
    }
    else if (err.code === 'EACCES') {
      res.statusCode = 403
      res.end('Access Denied')
    }
    else {
      console.error('Server error:', err)
      res.statusCode = 500
      res.end('Internal Server Error')
    }
  }
})

// 启动服务器
server.listen(port, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${port}/`)
  console.log(`Also accessible at http://localhost:${port}/`)
  console.log('Press Ctrl+C to stop the server')
})

// 处理未捕获的异常
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err)
  process.exit(1) // 可选：根据需要决定是否退出进程
})

// 处理未处理的 Promise 拒绝
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
})
