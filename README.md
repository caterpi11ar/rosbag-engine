# ROSBag Engine

## 项目简介 (Project Overview)

ROSBag Engine 是一个专为浏览器环境设计的 ROSBag 解析、播放和渲染引擎。支持高性能的数据处理、跨框架兼容性。

ROSBag Engine is a high-performance ROSBag parsing, playback, and rendering engine designed for browser environments, supporting zero-copy memory management and cross-framework compatibility.

## 主要功能 (Key Features)

- 🚀 高性能 ROSBag 解析
- 🎨 跨框架渲染支持 (Vue, React)
- ⏱️ 精确时间同步和插值
- 🔌 可扩展的插件系统

## 项目架构 (Project Architecture)

```
rosbag-engine/
├── packages/
│   ├── parser/       # ROSBag 解析模块 (Parsing Module)
│   ├── player/       # 播放控制模块 (Playback Control Module)
│   └── downloader/   # 远程文件流式下载模块 (Download Engine)
├── examples/
│   ├── vue/          # Vue 集成示例 (Vue Integration Example)
│   └── react/        # React 集成示例 (React Integration Example)
└── scripts/          # 脚本 (Scripts)
```

## 快速开始 (Quick Start)

### 先决条件 (Prerequisites)

- Node.js 18+
- pnpm 8+

### 安装 (Installation)

```bash
# 克隆仓库 (Clone Repository)
git clone https://github.com/caterpi11ar/rosbag-engine
cd rosbag-engine

# 安装依赖 (Install Dependencies)
pnpm install

# 构建项目 (Build Project)
pnpm run build
```

### 开发 (Development)

```bash
# 启动开发模式 (Start Development Mode)
pnpm run dev

# 运行测试 (Run Tests)
pnpm run test
```
