import { useState, useRef, useCallback, useEffect } from "react";
import "./App.css";
import { RemoteDataSourceFactory } from "@rosbag-engine/parser";
import { useCanvas } from "./useCanvas";

// 定义迭代器结果类型
interface MessageEvent {
  topic: string;
  message: {
    format?: string;
    data?: Uint8Array;
    header?: { stamp: { sec: number; nsec: number } };
  };
}

interface IteratorResult {
  type: string;
  msgEvent?: MessageEvent;
}

interface MessageData {
  timestamp: number;
  data: Uint8Array;
  format: string;
}

// 定义 Bag 信息类型
interface BagInfo {
  start: { sec: number; nsec: number };
  end: { sec: number; nsec: number };
  topics: Array<{ name: string; type: string }>;
  connections: Array<unknown>;
  [key: string]: unknown; // 允许其他可能的字段
}

function App() {
  const [url, setUrl] = useState('');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [downloadedMessages, setDownloadedMessages] = useState<MessageData[]>([]);
  const [downloadComplete, setDownloadComplete] = useState(false);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  const [bagInfo, setBagInfo] = useState<BagInfo | null>(null);
  const [availableTopics, setAvailableTopics] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  // 引用用于控制播放的状态
  const lastMessageTimeRef = useRef<number | null>(null);
  const lastRealTimeRef = useRef<number>(0);
  const downloadIteratorRef = useRef<AsyncIterator<IteratorResult> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentMessageIndexRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);
  const messagesBufferRef = useRef<MessageData[]>([]);
  const isStreamingRef = useRef<boolean>(false);

  const { canvasRef, containerRef, drawToCanvas } = useCanvas();

  // 获取元信息
  const fetchMetadata = useCallback(async () => {
    try {
      setIsLoadingMetadata(true);
      setError(null);
      
      // 创建数据源工厂
      const factory = new RemoteDataSourceFactory();

      // 初始化数据源
      const source = factory.initialize({ params: { url } });

      // 初始化数据源，获取bag信息
      const info = await source.initialize();
      console.log("Bag info:", info);
      setBagInfo(info as unknown as BagInfo);

      // 设置开始和结束时间
      const bagStartTime = info.start.sec + info.start.nsec / 1e9;
      const bagEndTime = info.end.sec + info.end.nsec / 1e9;
      setStartTime(bagStartTime);
      setEndTime(bagEndTime);

      // 获取可用话题
      const topics = info.topics
        .map((topic) => topic.name)
        .filter((item) => 
          item.includes("camera") || 
          item.includes("image") || 
          item.includes("rgb") ||
          item.includes("compressed") ||
          item.includes("color")
        );
      
      console.log("Available camera topics:", topics);
      setAvailableTopics(topics);

      if (topics.length === 0) {
        console.warn("没有找到图像相关的话题，将尝试使用第一个话题");
        if (info.topics.length > 0) {
          setAvailableTopics([info.topics[0].name]);
        } else {
          throw new Error("没有可用的话题");
        }
      }
      
      setIsLoadingMetadata(false);
      return { info, topics };
    } catch (err) {
      console.error("获取元信息失败:", err);
      setError(err instanceof Error ? err.message : "未知错误");
      setIsLoadingMetadata(false);
      throw err;
    }
  }, [url]);

  // 页面加载时获取元信息
  useEffect(() => {
    fetchMetadata().catch(() => {
      // 错误已在fetchMetadata中处理
    });
  }, [fetchMetadata]);

  // 处理播放速度变化
  const handleSpeedChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setPlaybackSpeed(Number(e.target.value));
  };

  // 暂停播放
  const handlePause = useCallback(() => {
    setIsPlaying(false);
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  // 流式播放：边下载边播放
  const startStreamingPlayback = useCallback(() => {
    if (isPlaying) return;
    
    isStreamingRef.current = true;
    setIsPlaying(true);
    
    // 如果是重新播放，从头开始
    if (currentMessageIndexRef.current >= messagesBufferRef.current.length || 
        currentMessageIndexRef.current === 0) {
      currentMessageIndexRef.current = 0;
      
      // 确保从头开始时进度条也重置
      if (messagesBufferRef.current.length > 0) {
        const firstMessage = messagesBufferRef.current[0];
        const firstTimestamp = firstMessage.timestamp;
        const initialProgress = ((firstTimestamp - startTime) / (endTime - startTime)) * 100;
        setPlaybackProgress(Math.min(Math.max(initialProgress, 0), 100));
      } else {
        setPlaybackProgress(0);
      }
    }
    // 否则从当前位置继续播放
    
    lastMessageTimeRef.current = null;
    lastRealTimeRef.current = Date.now();
    
    const playNextFrame = () => {
      // 如果播放已停止，退出循环
      if (!isStreamingRef.current) {
        return;
      }
      
      // 如果当前没有更多消息可播放，但下载仍在继续，则等待新消息
      if (currentMessageIndexRef.current >= messagesBufferRef.current.length) {
        if (!isDownloading && downloadComplete) {
          // 下载完成且没有更多消息，结束播放
          setIsPlaying(false);
          isStreamingRef.current = false;
          return;
        } else {
          // 下载仍在进行，等待新消息
          animationFrameRef.current = requestAnimationFrame(playNextFrame);
          return;
        }
      }
      
      const currentMessage = messagesBufferRef.current[currentMessageIndexRef.current];
      const messageTime = currentMessage.timestamp;
      
      // 控制播放速度
      if (lastMessageTimeRef.current !== null) {
        const messageTimeDiff = (messageTime - lastMessageTimeRef.current) * 1000; // 转换为毫秒
        const desiredDelay = messageTimeDiff / playbackSpeed; // 根据播放速度调整延迟
        
        const now = Date.now();
        const elapsedSinceLastMessage = now - lastRealTimeRef.current;
        
        if (elapsedSinceLastMessage < desiredDelay) {
          // 如果还没到播放时间，继续等待
          animationFrameRef.current = requestAnimationFrame(playNextFrame);
          return;
        }
      }
      
      // 更新最后一条消息的时间
      lastMessageTimeRef.current = messageTime;
      lastRealTimeRef.current = Date.now();
      
      // 绘制到画布
      if (currentMessage.data) {
        // 支持多种可能的图像格式
        const isImageFormat = 
          currentMessage.format === "jpeg" || 
          currentMessage.format === "jpg" || 
          currentMessage.format === "png" || 
          currentMessage.format === "compressed" ||
          currentMessage.format?.includes("image");
          
        if (isImageFormat) {
          try {
            drawToCanvas(currentMessage.data);
          } catch (err) {
            console.error("渲染图像失败:", err);
          }
        }
      }
      
      // 更新进度条 - 使用 requestAnimationFrame 确保UI更新同步
      requestAnimationFrame(() => {
        const progressPercentage = 
          ((messageTime - startTime) / (endTime - startTime)) * 100;
        setPlaybackProgress(Math.min(Math.max(progressPercentage, 0), 100));
      });
      
      // 移动到下一帧
      currentMessageIndexRef.current++;
      
      // 继续播放下一帧
      if (isStreamingRef.current) {
        animationFrameRef.current = requestAnimationFrame(playNextFrame);
      }
    };
    
    animationFrameRef.current = requestAnimationFrame(playNextFrame);
  }, [isPlaying, isDownloading, downloadComplete, playbackSpeed, startTime, endTime, drawToCanvas]);

  // 停止下载
  const stopDownload = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsDownloading(false);
  }, []);

  // 开始下载
  const handleDownload = useCallback(async () => {
    try {
      // 如果已经在下载，则停止
      if (isDownloading) {
        stopDownload();
        return;
      }
      
      // 重置状态
      messagesBufferRef.current = [];
      setDownloadedMessages([]);
      setDownloadProgress(0);
      setPlaybackProgress(0);
      currentMessageIndexRef.current = 0;
      lastMessageTimeRef.current = null;
      setDownloadComplete(false);
      setError(null);
      
      // 如果还没有获取元信息，先获取
      let topics = availableTopics;
      if (!bagInfo) {
        try {
          const metadataResult = await fetchMetadata();
          topics = metadataResult.topics;
        } catch (err) {
          console.error("获取元信息失败:", err);
          setError("获取元信息失败，请重试");
          return;
        }
      }

      // 如果没有可用话题，退出
      if (topics.length === 0) {
        setError("没有可用的话题");
        return;
      }

      setIsDownloading(true);

      // 创建数据源工厂
      const factory = new RemoteDataSourceFactory();

      // 初始化数据源
      const source = factory.initialize({ params: { url } });

      // 确保数据源已初始化
      try {
        // 无论是否有bagInfo，都需要初始化source以确保worker正确设置
        await source.initialize();
      } catch (err) {
        console.error("初始化数据源失败:", err);
        setError("初始化数据源失败，请重试");
        setIsDownloading(false);
        return;
      }

      const topicsMap = new Map(
        // 只测试第一个
        topics.slice(0, 1).map((topic) => [topic, { topic }])
      );
      
      // 创建可以中断的控制器
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      // 获取迭代器
      try {
        downloadIteratorRef.current = source.messageIterator({
          topics: topicsMap,
        }) as AsyncIterator<IteratorResult>;
      } catch (err) {
        console.error("创建迭代器失败:", err);
        setError("创建迭代器失败，请重试");
        setIsDownloading(false);
        return;
      }
      
      let updateCounter = 0;
      let firstMessageProcessed = false;
      
      try {
        while (!signal.aborted) {
          const result = await downloadIteratorRef.current.next();
          
          if (result.done) {
            setDownloadComplete(true);
            setIsDownloading(false);
            // 最后一次更新消息列表
            setDownloadedMessages([...messagesBufferRef.current]);
            break;
          }
          
          if (result.value.type !== "message-event") continue;
          
          const message = result.value.msgEvent?.message;
          
          if (message?.header?.stamp && message.data) {
            const timestamp = message.header.stamp.sec + message.header.stamp.nsec / 1e9;
            
            // 记录第一个消息的格式，帮助调试
            if (messagesBufferRef.current.length === 0) {
              console.log("First message format:", message.format);
              console.log("First message data length:", message.data.length);
              firstMessageProcessed = true;
            }
            
            // 保存消息到缓冲区
            const newMessage = {
              timestamp,
              data: message.data,
              format: message.format || "unknown"
            };
            
            messagesBufferRef.current.push(newMessage);
            
            // 更新下载进度
            const progressPercentage =
              ((timestamp - startTime) / (endTime - startTime)) * 100;
            setDownloadProgress(Math.min(Math.max(progressPercentage, 0), 100));
            
            // 每10条消息更新一次状态，避免频繁更新导致性能问题
            updateCounter++;
            if (updateCounter % 10 === 0) {
              setDownloadedMessages([...messagesBufferRef.current]);
            }
            
            // 如果是第一条消息且没有在播放，自动开始流式播放
            if (firstMessageProcessed && !isPlaying && messagesBufferRef.current.length === 1) {
              // 确保播放进度从0开始
              setPlaybackProgress(0);
              startStreamingPlayback();
              firstMessageProcessed = false; // 防止重复触发
            }
          }
        }
      } catch (err) {
        if (signal.aborted) {
          console.log("下载被中断");
        } else {
          console.error("下载错误:", err);
        }
      } finally {
        setIsDownloading(false);
        // 确保最后一次更新包含所有消息
        setDownloadedMessages([...messagesBufferRef.current]);
      }
    } catch (err) {
      console.error("初始化失败:", err);
      setIsDownloading(false);
      setError(err instanceof Error ? err.message : "下载失败");
    }
  }, [url, isDownloading, stopDownload, endTime, startTime, isPlaying, startStreamingPlayback, bagInfo, availableTopics, fetchMetadata]);

  // 开始播放并自动触发下载
  const handlePlayButton = useCallback(async () => {
    if (isPlaying) {
      // 如果正在播放，则暂停
      handlePause();
      return;
    }
    
    if (messagesBufferRef.current.length > 0) {
      // 如果已经有下载的消息，直接开始播放
      startStreamingPlayback();
    } else {
      // 如果没有消息，先开始下载
      if (!isDownloading) {
        // 直接调用函数，不通过依赖
        handleDownload();
        // 注意：下载会自动触发播放，所以这里不需要调用startStreamingPlayback
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, isDownloading, handlePause, startStreamingPlayback]);

  // 清理资源
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      isStreamingRef.current = false;
    };
  }, []);

  // 格式化时间显示
  const formatTime = (timeInSeconds: number) => {
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  };

  // 格式化日期显示
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString();
  };

  return (
    <div className="app">
      <h1 style={{ textAlign: "center", marginBottom: "30px" }}>
        🎬 ROSBag 远程播放器
      </h1>

      {/* URL输入和控制区域 */}
      <div
        style={{
          padding: "20px",
          border: "1px solid #e5e7eb",
          borderRadius: "8px",
          marginBottom: "20px",
          backgroundColor: "#f9fafb",
        }}
      >
        <div style={{ marginBottom: "16px" }}>
          <p style={{ marginBottom: "8px", fontWeight: "bold" }}>
            ROSBag文件URL:
          </p>
          <div style={{ display: "flex", gap: "10px" }}>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="请输入ROSBag文件的HTTP URL"
              style={{ flex: 1, padding: "8px" }}
            />
            <button
              onClick={fetchMetadata}
              disabled={isLoadingMetadata}
              style={{ padding: "8px 16px" }}
            >
              {isLoadingMetadata ? "加载中..." : "获取信息"}
            </button>
          </div>
        </div>
        
        {/* 元信息显示区域 */}
        {isLoadingMetadata ? (
          <div style={{ textAlign: "center", padding: "20px" }}>
            <div style={{ 
              width: "30px", 
              height: "30px", 
              borderRadius: "50%", 
              border: "3px solid #e5e7eb",
              borderTopColor: "#3b82f6",
              margin: "0 auto 10px",
              animation: "spin 1s linear infinite"
            }}></div>
            <p>正在加载元信息...</p>
          </div>
        ) : error ? (
          <div style={{ color: "#ef4444", padding: "10px", backgroundColor: "#fee2e2", borderRadius: "4px", marginBottom: "16px" }}>
            错误: {error}
          </div>
        ) : bagInfo && (
          <div style={{ 
            marginBottom: "16px", 
            padding: "10px", 
            backgroundColor: "#f3f4f6", 
            borderRadius: "4px",
            fontSize: "14px"
          }}>
            <h3 style={{ margin: "0 0 8px 0" }}>Bag 信息</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <div>开始时间: {formatDate(bagInfo.start.sec)}</div>
              <div>结束时间: {formatDate(bagInfo.end.sec)}</div>
              <div>总时长: {formatTime(endTime - startTime)}</div>
              <div>话题数量: {bagInfo.topics?.length || 0}</div>
            </div>
            {availableTopics.length > 0 && (
              <div style={{ marginTop: "8px" }}>
                <div>可用图像话题: {availableTopics.length}</div>
                <div style={{ fontSize: "12px", color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {availableTopics[0]}
                </div>
              </div>
            )}
          </div>
        )}
        
        <div style={{ marginBottom: "16px" }}>
          <p style={{ marginBottom: "8px", fontWeight: "bold" }}>
            播放速度:
          </p>
          <select 
            value={playbackSpeed} 
            onChange={handleSpeedChange}
            style={{ padding: "8px" }}
          >
            <option value={0.25}>0.25x</option>
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
          </select>
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={handlePlayButton}
            disabled={isLoadingMetadata || (!bagInfo && !isDownloading)}
            style={{ 
              padding: "8px 16px",
              backgroundColor: isPlaying ? "#e5e7eb" : "#3b82f6",
              color: isPlaying ? "#1f2937" : "#ffffff",
              border: "none",
              borderRadius: "4px",
              fontWeight: "bold",
              cursor: (!isLoadingMetadata && (bagInfo || isDownloading)) ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: "100px",
              opacity: (!isLoadingMetadata && (bagInfo || isDownloading)) ? 1 : 0.5
            }}
          >
            {isDownloading && !isPlaying ? (
              <>
                <span style={{ marginRight: "8px" }}>准备中...</span>
                <div style={{ 
                  width: "16px", 
                  height: "16px", 
                  borderRadius: "50%", 
                  border: "2px solid #ffffff",
                  borderTopColor: "transparent",
                  animation: "spin 1s linear infinite"
                }}></div>
                <style>{`
                  @keyframes spin {
                    to { transform: rotate(360deg); }
                  }
                `}</style>
              </>
            ) : isPlaying ? (
              "暂停"
            ) : (
              "播放"
            )}
          </button>
          
          {isDownloading && (
            <button
              onClick={stopDownload}
              style={{ padding: "8px 16px" }}
            >
              停止下载
            </button>
          )}
        </div>
      </div>

      {/* 集成的进度条 - 视频网站风格 */}
      <div style={{ marginBottom: "20px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "5px",
          }}
        >
          <span>{formatTime((endTime - startTime) * (playbackProgress / 100))}</span>
          <span>{formatTime(endTime - startTime)}</span>
        </div>
        <div
          style={{
            width: "100%",
            height: "10px",
            backgroundColor: "#2a2a2a",
            borderRadius: "5px",
            overflow: "hidden",
            position: "relative",
            cursor: "pointer",
          }}
        >
          {/* 下载进度 - 暗色 */}
          <div
            style={{
              position: "absolute",
              width: `${downloadProgress}%`,
              height: "100%",
              backgroundColor: "#4a4a4a",
              transition: "width 0.3s ease",
              zIndex: 1,
            }}
          ></div>
          
          {/* 播放进度 - 亮色 */}
          <div
            style={{
              position: "absolute",
              width: `${playbackProgress}%`,
              height: "100%",
              backgroundColor: "#3b82f6",
              transition: isPlaying ? "none" : "width 0.3s ease", // 播放时禁用过渡效果
              zIndex: 2,
            }}
          >
            {/* 进度条指示器 - 集成到进度条内部 */}
            {isPlaying && (
              <div
                style={{
                  position: "absolute",
                  right: "-6px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: "12px",
                  height: "12px",
                  borderRadius: "50%",
                  backgroundColor: "#ffffff",
                  boxShadow: "0 0 4px rgba(0,0,0,0.5)",
                  zIndex: 3,
                }}
              ></div>
            )}
          </div>
        </div>
        
        {/* 下载和播放状态信息 */}
        <div style={{ 
          display: "flex", 
          justifyContent: "space-between",
          marginTop: "8px",
          fontSize: "14px", 
          color: "#6b7280" 
        }}>
          <div>
            已下载: {downloadProgress.toFixed(1)}%
            {downloadComplete && " (已完成)"}
          </div>
          <div>
            已下载 {downloadedMessages.length} 条消息
            {isPlaying && ` | 正在播放第 ${currentMessageIndexRef.current + 1} 条`}
          </div>
        </div>
      </div>

      <div
        className="flex-1 flex flex-shrink-0 items-center justify-center"
        ref={containerRef}
        style={{ minHeight: "400px" }}
      >
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

export default App;

