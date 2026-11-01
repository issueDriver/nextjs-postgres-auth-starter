# 词间运行说明

页面已接入 PostgreSQL 真实数据和 NextAuth 认证。书籍、封面、词数、单词详情和学习进度均来自数据库；没有内置演示账号或浏览器本地词库。

## 配置与启动

配置 `.env` 中的 `POSTGRES_URL` 和 `AUTH_SECRET`，保留已有连接信息，不将真实凭据提交到 Git。数据库已初始化时，无需重复迁移。

```bash
pnpm install
pnpm db:check
pnpm exec next dev --hostname 127.0.0.1 --port 3001
```

访问 http://127.0.0.1:3001 。新环境的数据库初始化步骤见 [数据库迁移说明](./database.md)，应用请求不会自动建表、发布词书或修改词库顺序。

生产环境需设置 `AUTH_URL` 和 `APP_ORIGIN` 为实际站点来源，例如 `https://vocabulary.example.com`。自定义学习写接口仅接受 JSON 和配置允许的 Origin；不以任意请求 Host 决定可信来源。开发环境默认允许 localhost 和 127.0.0.1 的 3000、3001 端口。

## 数据与账号

首页只展示 `books.status = 'published'` 的词书；草稿仍留在数据库，不会自动发布。封面优先使用数据库中的 HTTPS URL，缺失或加载失败时以真实书名、标签回退展示。

从「我的」注册邮箱账号，成功后切回登录。密码在服务端以 bcrypt 哈希保存；登录后使用 NextAuth 的 HttpOnly 会话 cookie，客户端不保存密码或密码哈希。不同账号的学习进度按服务端 session 用户 ID 隔离。

学习确认写入 `user_book_progress`，刷新、退出后重新登录和同一账号跨设备访问均读取该表。目录、详情和学习快照 GET 不写进度；实际显示学习卡片后才登记访问；只有确认成功才增加已学数。学习事务按书、用户进度依次加锁，重复提交同一单词不会重复增加已学数。

学习卡片和单词详情均提供英音、美音播放。客户端使用当前 `headWord` 构造 `https://dict.youdao.com/dictvoice?audio={word}&type={1|2}`，其中词头进行 URL 查询参数编码，`type=1` 为英音、`type=2` 为美音。音频由客户端直接向有道请求并在用户点击后播放，不依赖数据库 `speech` 字段，不写学习进度或最近学习时间；切换单词、口音或离开页面时停止上一段音频。音频请求失败时可重试。

`user_word_progress`、`study_sessions`、`study_events` 目前仍仅预建，不参与本期游标写入。

## 接口与代码

| 文件或路径 | 职责 |
| --- | --- |
| `lib/api.ts` | 页面 fetch 适配、请求超时、真实认证 Actions 调用 |
| `app/actions/auth.ts` | 登录、注册、退出 |
| `app/api/books` | 公开书库、受限目录、详情、学习快照、访问登记与确认 |
| `app/api/me/progress` | 当前账号汇总与各书进度、按书批量进度 |
| `lib/services/vocabulary-core.ts` | 参数化 PostgreSQL 查询与进度事务 |
| `lib/services/vocabulary.ts` | 绑定真实数据库连接的服务入口 |
| `lib/words/normalize.ts` | 数据库 JSON 归一化为卡片、目录和详情 DTO |
| `lib/validation` | 邮箱、密码、ID、分页、写请求与可信来源校验 |

单词 ID 在数据库读取时转换为十进制字符串，HTTP 和路由不转成 JavaScript Number。账号与进度响应禁用共享缓存。目录滚动位置使用账号隔离的 sessionStorage，仅用于页面恢复，不作为学习进度来源。

## 验证

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:db
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

测试使用 Node.js 22.15+ 的模块钩子。单元与服务测试使用独立 PGlite 数据库执行实际 SQL，覆盖归一化、输入校验、只读查询、顺序确认、重复提交、账号隔离、事务回滚、完成和下一词读取失败。PGlite 测试不替代真实 PostgreSQL 的多连接锁竞争测试；后者仍需独立测试库验证。

浏览器测试从 `/api/books` 动态获取已发布真实书目，检查页面一致性、分页、访客权限和移动布局，不自动创建真实账号或写入生产进度。E2E 默认连接已运行的 `http://127.0.0.1:3001`，可通过 `PLAYWRIGHT_BASE_URL` 修改；已有 Chrome 可通过 `PLAYWRIGHT_CHROME_PATH` 指定可执行文件。

发音交互测试使用隔离的会话、接口响应和可控制的 Audio 替身，覆盖英美音映射、连续切换、系统暂停、切词清理、失败重试和加载超时；不会写真实数据库，也不依赖外部音频服务的实时可用性。

生产部署还需配置共享限流、应用数据库最小权限，并在隔离环境验证真实注册登录及多窗口并发学习。
