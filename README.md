# 追毫中枢 · 舰船工具

舰船 / 搭载系统 / 加点树 / 战报分析 / 人员档案，一个零依赖的 Python 网页服务。

- 后端：Python 3.11+（只用标准库 `http.server` + `sqlite3`，无第三方包）
- 前端：原生 HTML/CSS/JS，SSE 实时刷新
- 数据：单文件 SQLite（`data.db`），默认端口 **8787**

## 本地运行

```bash
python -X utf8 server.py 8787
# 浏览器打开 http://127.0.0.1:8787
```

首次启动会自动建库并写入示例数据，默认账号：

| 账号 | 口令 | 角色 |
|---|---|---|
| `admin` | `admin123` | 管理员 |
| `editor` | `editor123` | 编辑 |
| `viewer` | `viewer123` | 只读 |

> 首次登录后请立刻修改密码（≥8 位，不能是常见弱口令）。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `FT_HOST` | `127.0.0.1` | 监听地址，局域网/容器用 `0.0.0.0` |
| `FT_PORT` | `8787` | 端口（也可用第一个命令行参数） |
| `FT_DATA` | 程序目录 | 数据库与 logs 的存放目录（容器里指向挂载卷） |
| `FT_IDLE_EXIT` | `1` | `1`=页面全关后自动退出；**服务器上设 `0`** |
| `FT_IDLE_SEC` | `120` | 空闲多少秒后退出（仅上面为 1 时生效） |
| `TZ` | 系统 | 日志时区，建议 `Asia/Shanghai` |

## 部署

见 [部署指南](https://github.com/)（同目录 `部署说明`）：

- **Render / Railway / Fly.io**：识别根目录 `Dockerfile`，挂载卷到 `/data`，设 `FT_DATA=/data`。
- **自己的服务器**：`deploy/github/docker-compose.yml` + `Caddyfile`，`docker compose up -d --build`。
- **不要提交 `data.db`**：里面有人员手机号/微信/QQ，仓库里用 `.gitignore` 挡住了。

## 目录

```
server.py     HTTP 路由与业务（登录/权限/数据/战报/审计/SSE）
db.py         数据库路径与连接
schema.py     建表语句与初始数据
engine.py     数值计算（DPM / EHP / 维修）
util.py       小工具
static/       前端页面
deploy/github 容器与反代配置、备份脚本
```
