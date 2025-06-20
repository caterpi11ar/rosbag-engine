import { useCallback, useRef } from 'react'

export function useCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const isJPEG = useCallback((data: Uint8Array) => {
    // 检查 JPEG 文件头 (FF D8 FF) 255, 216, 255
    return data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF
  }, [])
  
  const isPNG = useCallback((data: Uint8Array) => {
    // 检查 PNG 文件头 (89 50 4E 47 0D 0A 1A 0A) 137, 80, 78, 71, 13, 10, 26, 10
    return data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47 &&
           data[4] === 0x0D && data[5] === 0x0A && data[6] === 0x1A && data[7] === 0x0A
  }, [])
  
  const getImageType = useCallback((data: Uint8Array) => {
    if (isJPEG(data)) return 'image/jpeg'
    if (isPNG(data)) return 'image/png'
    // 默认尝试JPEG
    return 'image/jpeg'
  }, [isJPEG, isPNG])

  const drawToCanvas = useCallback(
    async (data: Uint8Array, onError?: () => void) => {
      try {
        // 防御性检查
        if (!containerRef.current) {
          return
        }

        if (!data || data?.length === 0)
          return

        // 尝试检测图像类型
        const imageType = getImageType(data)
        
        // 1. 解码图像
        let blob: Blob | null = new Blob([data], { type: imageType })
        
        try {
          const bitmap = await createImageBitmap(blob)
          
          if (!canvasRef.current) {
            return () => {
              bitmap.close()
              blob = null
            }
          }
  
          // 2. 获取渲染上下文
          const canvas = canvasRef.current
          const ctx = canvas.getContext('2d')
          if (!ctx)
            throw new Error('Canvas context unavailable')
  
          // 3. 自适应尺寸计算
          const calculateDimensions = (bitmap: ImageBitmap) => {
            const containerElem = containerRef.current
  
            if (!containerElem)
              return
  
            const dpr = window.devicePixelRatio || 1
            const containerWidth = containerElem.clientWidth
            const containerHeight = containerElem.clientHeight
            const aspectRatio = bitmap.height / bitmap.width
  
            // 计算基础尺寸
            let cssWidth = containerWidth
            let cssHeight = cssWidth * aspectRatio
  
            // 高度超过容器时切换模式
            if (cssHeight > containerHeight) {
              cssHeight = containerHeight
              cssWidth = cssHeight / aspectRatio
            }
  
            // HiDPI 适配
            return {
              cssWidth,
              cssHeight,
              renderWidth: Math.floor(cssWidth * dpr),
              renderHeight: Math.floor(cssHeight * dpr),
            }
          }
  
          // 4. 渲染函数（带尺寸缓存优化）
          let lastDimensions = { cssWidth: 0, cssHeight: 0 }
          const render = (bitmap: ImageBitmap) => {
            const dimensions = calculateDimensions(bitmap)
  
            if (!dimensions)
              return
  
            // 仅尺寸变化时更新
            if (
              dimensions.cssWidth !== lastDimensions.cssWidth
              || dimensions.cssHeight !== lastDimensions.cssHeight
            ) {
              canvas.style.width = `${dimensions.cssWidth}px`
              canvas.style.height = `${dimensions.cssHeight}px`
              canvas.width = dimensions.renderWidth
              canvas.height = dimensions.renderHeight
  
              lastDimensions = dimensions
            }
  
            // 高质量绘制
            ctx.save()
            ctx.imageSmoothingEnabled = true
            ctx.imageSmoothingQuality = 'high'
            ctx.clearRect(0, 0, dimensions.renderWidth, dimensions.renderHeight)
            ctx.drawImage(
              bitmap,
              0,
              0,
              bitmap.width,
              bitmap.height,
              0,
              0,
              dimensions.renderWidth,
              dimensions.renderHeight,
            )
            ctx.restore()
          }
  
          // 5. 使用 ResizeObserver 替代 window.resize
          const resizeObserver = new ResizeObserver(() => {
            render(bitmap)
          })
  
          // 初始渲染
          render(bitmap)
          resizeObserver.observe(containerRef.current)
  
          // 返回清理函数
          return () => {
            resizeObserver.disconnect()
            bitmap.close()
            blob = null
          }
        } catch (error) {
          console.error('解码图像失败，尝试其他格式:', error)
          // 如果解码失败，尝试其他格式
          blob = new Blob([data], { type: 'image/jpeg' })
          const bitmap = await createImageBitmap(blob).catch(() => {
            throw new Error('无法解码图像数据')
          })
          
          if (!canvasRef.current) {
            bitmap.close()
            blob = null
            return
          }
          
          const canvas = canvasRef.current
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('Canvas context unavailable')
          
          ctx.drawImage(bitmap, 0, 0)
          bitmap.close()
          blob = null
        }
      }
      catch (error) {
        console.error('Rendering failed:', error)
        onError?.()

        // 强制清空画布
        if (!canvasRef.current)
          return

        // 保留容器尺寸但清空内容
        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')

        // 方法1：通过绘图上下文清空
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height)
        }
        // 方法2：重置尺寸
        else {
          canvas.width = canvas.clientWidth
          canvas.height = canvas.clientHeight
        }

        // 可选：显示错误状态
        if (canvasRef.current) {
          const ctx = canvasRef.current.getContext('2d')
          if (ctx && containerRef.current) {
            // canvas.width = containerRef.current.clientWidth
            // canvas.height = containerRef.current.clientHeight

            /** 绘制背景 */
            ctx.fillStyle = '#fff'
            ctx.fillRect(
              0,
              0,
              canvasRef.current.width,
              canvasRef.current.height,
            )

            ctx.fillStyle = '#ff0000'
            ctx.textAlign = 'center'
            ctx.font = 'bold 16px Arial'

            /** 绘制报错信息 */
            ctx.fillText(
              'Image decoding failed',
              canvasRef.current.width / 2,
              canvasRef.current.height / 2,
            )
          }
        }
      }
    },
    [getImageType],
  )

  return {
    canvasRef,
    containerRef,
    drawToCanvas,
  }
}
