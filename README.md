# dsh-context-ring

DeepSeek Harness 上下文圆环增强插件 —— 让输入框旁的上下文占用圆环（ContextMeter）**按北京时间高峰/空闲时段变色**，并在悬浮提示与展开面板中显示**当前时段**和 **DeepSeek 账户余额**。

## 功能一览

| 位置 | 效果 |
| --- | --- |
| 圆环颜色 | 🟢 空闲时段（绿）；🟡 高峰时段（黄） |
| 悬浮提示（hover） | `空闲时段 上下文已使用 45% 9.01CNY` |
| 展开面板底部 | 左下角 `当前时段：高峰时段/空闲时段`；右下角右对齐 `余额：9.01 CNY`|

**高峰时段定义（北京时间 Asia/Shanghai）**：`09:00 – 12:00` 与 `14:00 – 18:00`（半开区间），其余时间为空闲时段。每 10 秒重新计算，到达边界（12:00 / 14:00 / 18:00）时圆环与文案自动切换。

## 为什么做这个插件

- **一眼掌握可用时段**：在高峰时段把圆环标黄，提醒用户当前为高负载时段；空闲时段标绿。
- **余额常驻可见**：无需打开 DeepSeek 控制台，悬浮或点击圆环即可看到账户余额。
- **随 WebUI 配置自适应**：余额查询读取 WebUI 当前模型路由与 `llm-deepseek` 设置，换机器、换 Key、换端点都能显示**正确账户**的余额。

## 架构

插件为 Cordis 双端动态插件（Host + Client）：

```
┌─────────────────────────────── Client（浏览器）──────────────────────────────┐
│ • styles.insert 注入作用域 CSS（圆环变色 + 面板伪元素布局）                      │
│ • MutationObserver + 10s interval 驱动 applyState                             │
│ • 改写悬浮气泡 textContent（文本节点更新，不增删 DOM）                          │
│ • host.call('balance') 获取余额                                                │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   │ RPC（仅 JSON）
┌──────────────────────────────────▼────────────────── Host（Node 进程）────────┐
│ harness.handle('balance')：                                                   │
│ 1. agentDefaultModel.currentSelection() → 当前 provider                       │
│ 2. settings['llm-deepseek'] → apiKeyEnv / baseURL（可移植）                   │
│ 3. credentials.resolve(apiKeyEnv) → API Key（凭据缝，不出进程）                │
│ 4. node -e 脚本（undici fetch）请求 <baseURL>/user/balance                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 为什么用 Node fetch 而不是 curl

部分 Windows 机器上 `curl.exe` 的 schannel TLS 栈会握手失败（`HTTP 000` / `exit 1`），而 Host 进程自身的 Node（undici）网络栈正常（模型调用一直走它）。因此余额请求通过 `ctx.shell` 执行一段 `node -e` 脚本完成，密钥经环境变量 `DSBALKEY` 传入（非保留前缀、不进 argv/日志）。

## 安装与运行

本插件为 DeepSeek Harness 的 Cordis 动态插件，通过 `cordis_define` / `cordis_run` 工具激活：

1. 定义插件（`kind: "new"`，idPrefix 建议 `ring`）；
2. 将 `code.host` / `code.client` 两份代码粘贴到对应字段；
3. `cordis_run` 首次运行（Client 部分需要用户批准，授权一次即可）；
4. 后续修改用 `kind: "existing"` 追加新 Package，再 `cordis_run mode: "update"`。

> 动态插件定义仅存在于当前进程，进程重启后需重新定义。如需持久化部署，可将本插件转为 Harness 预设/插件文件（见下文「转成可分享文件」）。

## 依赖与配置

插件不写任何配置，全部读取 WebUI 现有配置：

| 配置项 | 来源 | 默认值 |
| --- | --- | --- |
| 当前 provider | `agentDefaultModel.currentSelection()` | —（非 `deepseek-official` 时返回 `not-deepseek:<provider>`） |
| Key 引用 | `llm-deepseek.apiKeyEnv` | `DEEPSEEK_API_KEY` |
| API 端点 | `llm-deepseek.baseURL` | `https://api.deepseek.com` |
| Key 值 | `credentials.resolve(apiKeyEnv)`（环境变量 / .credentials.yaml 等凭据层） | — |

余额接口为 `<baseURL>/user/balance`，与 DeepSeek 适配器同源：适配器连哪台服务器，余额就查哪台服务器。

## 错误码

面板 / 悬浮提示中的失败原因含义：

| 显示 | 含义 | 处理 |
| --- | --- | --- |
| `not-deepseek:<provider>` | 当前模型路由不是 DeepSeek | 切换模型到 DeepSeek 路由 |
| `no-key:<ref>` | 凭据缝中该引用无有效 Key | 配置 `DEEPSEEK_API_KEY` 或 `llm-deepseek.apiKeyEnv` |
| `http-401 / http-403` | Key 无效或无权访问余额接口 | 检查/更换 Key |
| `fetch:<msg>` | Node fetch 网络/超时错误 | 检查网络与 baseURL |
| `curl-…`（旧版本） | curl schannel TLS 失败（历史版本） | 升级到使用 Node fetch 的版本 |
| `timeout` / `sandbox-denied` | 命令超时或被沙箱拒绝 | 检查执行环境 |
| `bad-body` / `bad-json` | 接口响应结构异常 | 检查 baseURL 是否为 DeepSeek 兼容端点 |

## 可移植性说明

- 余额**始终属于当前 WebUI 配置的账户**：Key 引用与端点都来自运行时配置，不做任何硬编码假设；
- 若别人部署在非 DeepSeek 路由上，插件会明确提示 `not-deepseek`，不会拿错误 Key 去查询；
- 圆环颜色与时段逻辑纯 Client 侧，按 `Intl.DateTimeFormat('Asia/Shanghai')` 计算，与浏览器/机器时区无关。

## 转成可分享文件

若需把插件分发给他人，可将 `code.host` / `code.client` 两段源码连同本 README 存入一个目录（例如 `dsh-context-ring/`），对方在自己的 Harness 会话中通过 Cordis 工具粘贴定义即可。如需打包为 Harness 预设/插件包，请参考 Harness 的 agent preset 与 plugin 打包规范。

## 版本历史

| 版本 | 变更 |
| --- | --- |
| v1.0.0 | 首个正式版本：圆环按北京时间高峰/空闲变色；悬浮提示显示时段与上下文占用；展开面板显示时段与右对齐余额（样式同 `~244K` 数字）；余额随 WebUI 配置（provider / apiKeyEnv / baseURL）动态解析，可移植。 |


## 许可证

随使用方项目。
